-- Protect `categories` from silently orphaning the rows that point at it by
-- name.
--
-- The problem this closes: budget_lines and requests store department /
-- cat_l1 / cat_l2 as PLAIN TEXT with no foreign key, so a rename or a delete
-- in Settings detached history with no warning and no record. 204 budget_lines
-- already carry names `categories` no longer has.
--
-- THIS DOES NOT ADD SURROGATE KEYS OR A REAL FOREIGN KEY. That is a separate
-- decision. What it adds is: the ability to COUNT what depends on a category,
-- an ATOMIC rename that can carry the dependants with it, and a soft delete so
-- retiring a category stops offering it without detaching its past.

-- ---------------------------------------------------------------------------
-- 1. SOFT DELETE
-- ---------------------------------------------------------------------------
-- Deactivating removes a category from the submit dropdown, the BO scope
-- picker and future createDraft dims. It changes NOTHING about history: the
-- spend report reads budget_lines and v_request_spend, never `categories`, so
-- past spend and past budget lines keep rendering exactly as before.
alter table public.categories
  add column if not exists active boolean not null default true;

create index if not exists categories_active on public.categories (active);

comment on column public.categories.active is
  'False = retired. Hidden from the submit form, the BO scope picker and new budget drafts; history is untouched and still shows in the spend report. Hard delete stays available only for a category with zero dependencies.';

-- ---------------------------------------------------------------------------
-- 2. DEPENDENCY COUNT
-- ---------------------------------------------------------------------------
-- SCOPED BY (department, cat_l1[, cat_l2]) AND DELIBERATELY NOT BY BU.
--
-- `categories` holds one row per (bu, department, cat_l1, cat_l2), so a single
-- cat_l1 name spans up to 32 rows across both companies. Renaming it for one
-- company only would SPLIT the category in two — which is the exact failure
-- this migration exists to prevent. So a cat_l1 is treated as one name across
-- companies, and the counts below match that.
--
-- p_cat_l2 null  -> the whole cat_l1
-- p_cat_l2 given -> that sub-category only
create or replace function public.category_dependencies(
  p_department text,
  p_cat_l1 text,
  p_cat_l2 text default null
) returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'category_rows', (
      select count(*) from public.categories c
      where c.department = p_department and c.cat_l1 = p_cat_l1
        and (p_cat_l2 is null or c.cat_l2 = p_cat_l2)
    ),
    'budget_lines', (
      select count(*) from public.budget_lines b
      where b.department = p_department and b.cat_l1 = p_cat_l1
        and (p_cat_l2 is null or b.cat_l2 = p_cat_l2)
    ),
    'request_headers', (
      select count(*) from public.requests r
      where r.department = p_department and r.cat_l1 = p_cat_l1
        and (p_cat_l2 is null or r.cat_l2 = p_cat_l2)
    ),
    'request_items', (
      select count(*) from public.requests r,
        lateral jsonb_array_elements(r.items_json) as it
      where jsonb_typeof(r.items_json) = 'array'
        and r.department = p_department
        and it ->> 'cat_l1' = p_cat_l1
        and (p_cat_l2 is null or it ->> 'cat_l2' = p_cat_l2)
    )
  );
$$;

comment on function public.category_dependencies(text, text, text) is
  'Rows that point at a category by NAME: budget_lines, requests headers, and items_json entries. Scoped by (department, cat_l1[, cat_l2]) across both companies — see migration 042.';

-- ---------------------------------------------------------------------------
-- 3. ATOMIC RENAME
-- ---------------------------------------------------------------------------
-- ONE STATEMENT BLOCK, NOT A ROW AT A TIME. A cat_l1 rename touches up to 32
-- `categories` rows; doing them one PATCH at a time leaves the category
-- existing under BOTH names in between — visible in the submit dropdown, the
-- scope picker and createDraft. A function is the only way PostgREST can give
-- this a single transaction.
--
-- p_cascade = true also rewrites budget_lines, requests headers and the
-- matching items_json entries, inside the SAME transaction. false renames only
-- `categories` and leaves the dependants pointing at the old name — allowed,
-- but the caller is told the number and it is recorded in the audit row.
create or replace function public.rename_category(
  p_department text,
  p_old_cat_l1 text,
  p_new_cat_l1 text,
  p_old_cat_l2 text default null,
  p_new_cat_l2 text default null,
  p_cascade boolean default false
) returns jsonb
language plpgsql
as $$
declare
  v_cats int := 0; v_lines int := 0; v_headers int := 0; v_items int := 0;
  v_l2_mode boolean := p_old_cat_l2 is not null;
begin
  if p_new_cat_l1 is null or btrim(p_new_cat_l1) = '' then
    raise exception 'A new category name is required';
  end if;
  if v_l2_mode and (p_new_cat_l2 is null or btrim(p_new_cat_l2) = '') then
    raise exception 'A new sub-category name is required';
  end if;

  -- categories: every row carrying this name, across both companies.
  update public.categories c
     set cat_l1 = p_new_cat_l1,
         cat_l2 = case when v_l2_mode then p_new_cat_l2 else c.cat_l2 end
   where c.department = p_department
     and c.cat_l1 = p_old_cat_l1
     and (not v_l2_mode or c.cat_l2 = p_old_cat_l2);
  get diagnostics v_cats = row_count;

  if p_cascade then
    update public.budget_lines b
       set cat_l1 = p_new_cat_l1,
           cat_l2 = case when v_l2_mode then p_new_cat_l2 else b.cat_l2 end
     where b.department = p_department
       and b.cat_l1 = p_old_cat_l1
       and (not v_l2_mode or b.cat_l2 = p_old_cat_l2);
    get diagnostics v_lines = row_count;

    update public.requests r
       set cat_l1 = p_new_cat_l1,
           cat_l2 = case when v_l2_mode then p_new_cat_l2 else r.cat_l2 end
     where r.department = p_department
       and r.cat_l1 = p_old_cat_l1
       and (not v_l2_mode or r.cat_l2 = p_old_cat_l2);
    get diagnostics v_headers = row_count;

    -- items_json: rewrite only the matching entries, preserving array order
    -- and every other key on each item.
    with touched as (
      select r.request_id,
             jsonb_agg(
               case
                 when it ->> 'cat_l1' = p_old_cat_l1
                  and (not v_l2_mode or it ->> 'cat_l2' = p_old_cat_l2)
                 then it
                      || jsonb_build_object('cat_l1', p_new_cat_l1)
                      || case when v_l2_mode then jsonb_build_object('cat_l2', p_new_cat_l2) else '{}'::jsonb end
                 else it
               end
               order by ord
             ) as new_items,
             count(*) filter (
               where it ->> 'cat_l1' = p_old_cat_l1
                 and (not v_l2_mode or it ->> 'cat_l2' = p_old_cat_l2)
             ) as hits
        from public.requests r,
             lateral jsonb_array_elements(r.items_json) with ordinality as t(it, ord)
       where jsonb_typeof(r.items_json) = 'array'
         and r.department = p_department
       group by r.request_id
    )
    update public.requests r
       set items_json = t.new_items
      from touched t
     where t.request_id = r.request_id and t.hits > 0;
    get diagnostics v_items = row_count;

    -- v_items is REQUESTS touched, not entries. Count the entries too, so the
    -- audit row can say how many individual line items moved.
    select coalesce(sum(t.hits), 0) into v_items
      from (
        select count(*) as hits
          from public.requests r,
               lateral jsonb_array_elements(r.items_json) as it
         where jsonb_typeof(r.items_json) = 'array'
           and r.department = p_department
           and it ->> 'cat_l1' = p_new_cat_l1
           and (not v_l2_mode or it ->> 'cat_l2' = p_new_cat_l2)
      ) t;
  end if;

  return jsonb_build_object(
    'categories', v_cats,
    'budget_lines', v_lines,
    'request_headers', v_headers,
    'request_items', v_items,
    'cascaded', p_cascade
  );
end;
$$;

comment on function public.rename_category(text, text, text, text, text, boolean) is
  'Renames a cat_l1 (or one cat_l2) across every categories row carrying it, in ONE transaction, optionally carrying budget_lines / requests / items_json with it. See migration 042.';

-- ---------------------------------------------------------------------------
-- ROLLBACK (run manually; not part of this migration)
--
--   drop function if exists public.rename_category(text, text, text, text, text, boolean);
--   drop function if exists public.category_dependencies(text, text, text);
--   alter table public.categories drop column if exists active;
--
-- No category data is modified by this migration; `active` defaults to true,
-- so every existing category stays exactly as visible as it was.
-- ---------------------------------------------------------------------------
