-- Mimetta Expense Portal — collapse the four Packaging Materials spellings
-- onto one canonical name.
--
-- Same snapshot + audit + verify-or-abort pattern as 019/020/043.
--
-- THE SAME BUG AS COG › RAW MATERIALS (migration 043). The categories CSV
-- import comma-split a quoted field, so one name became several. Verified
-- byte by byte before writing:
--
--   'Packaging Materials (Shipping boxes, tape)'   42 chars, ends ')'
--       CANONICAL. The only complete form. 16 request headers + 16 items_json
--       entries, ฿160,193 of FY2026 spend, BOTH companies — but NO categories
--       row, so none of it can be budgeted against.
--
--   '"Packaging Materials (Shipping boxes'         36 chars, LEADING 0x22
--       The raw split artifact. 2 ONEST requests (PAID), ฿1,480. No categories
--       row either.
--
--   'Packaging Materials (Shipping boxes'          35 chars, unclosed '('
--       SV categories row + 12 budget lines. The split artifact, de-quoted.
--
--   'Packaging Materials (Shipping boxes)'         36 chars, ends ')'
--       ONEST categories row + 12 budget lines. Someone repaired the paren BY
--       HAND and lost ', tape' doing it — which is why a syntactic check
--       cannot find this one, and why hand-repair is the hazard here.
--
-- WHAT THIS DOES. Points everything at the canonical name: both categories
-- rows, the 24 budget lines that hang off them, and the 2 requests carrying
-- the quoted artifact (header AND items_json, because v_request_spend reads
-- the item and only falls back to the header — migration 023).
--
-- The 16 requests already on the canonical name are NOT touched. They become
-- budgetable simply because the categories rows now match them.
--
-- NO MONEY MOVES. Only the label changes; FY2026 totals are unchanged to the
-- satang for ONEST, SV and All.
--
-- ROLLBACK (independent of every other migration):
--
--   update categories c set cat_l2 = s.cat_l2_original
--     from categories_packaging_2026_09 s where c.id = s.id;
--
--   update budget_lines b set cat_l2 = s.cat_l2_original
--     from budget_lines_packaging_2026_09 s
--    where b.revision_id = s.revision_id and b.bu = s.bu
--      and b.department = s.department and b.cat_l1 = s.cat_l1
--      and b.month = s.month and b.cat_l2 = s.cat_l2_new;
--
--   update requests r set cat_l2 = s.cat_l2_original, items_json = s.items_json_original
--     from requests_packaging_2026_09 s where r.request_id = s.request_id;
--
--   delete from audit_log where detail_json ->> 'migration' = '047_packaging_materials_canonical';
--
-- ---------------------------------------------------------------------------

create table if not exists categories_packaging_2026_09 (
  id uuid primary key, bu text not null, department text not null,
  cat_l1 text not null, cat_l2_original text not null, cat_l2_new text not null,
  snapshot_at timestamptz not null default now()
);
create table if not exists budget_lines_packaging_2026_09 (
  id bigserial primary key, revision_id uuid not null, bu text not null,
  department text not null, cat_l1 text not null, cat_l2_original text not null,
  cat_l2_new text not null, month int not null, amount numeric not null,
  snapshot_at timestamptz not null default now()
);
create table if not exists requests_packaging_2026_09 (
  request_id text primary key, cat_l2_original text, items_json_original jsonb,
  items_changed integer not null, snapshot_at timestamptz not null default now()
);

do $$
declare
  k_canon  constant text := 'Packaging Materials (Shipping boxes, tape)';
  k_quoted constant text := '"Packaging Materials (Shipping boxes';
  k_open   constant text := 'Packaging Materials (Shipping boxes';
  k_paren  constant text := 'Packaging Materials (Shipping boxes)';
  v_cats int; v_lines int; v_reqs int; v_items int; v_audit int; v_left int;
begin
  -- 0. The canonical name must not already exist as a categories row, or the
  --    rename would create a duplicate coordinate.
  if exists (
    select 1 from categories
     where department = 'Operations/Fulfillment'
       and cat_l1 = 'Logistics & Shipping' and cat_l2 = k_canon
  ) then
    raise exception 'ABORT: a categories row already carries the canonical name.';
  end if;

  -- 1. Snapshot all three surfaces before any write.
  insert into categories_packaging_2026_09 (id, bu, department, cat_l1, cat_l2_original, cat_l2_new)
  select id, bu, department, cat_l1, cat_l2, k_canon
    from categories where cat_l2 in (k_open, k_paren)
  on conflict (id) do nothing;
  get diagnostics v_cats = row_count;

  insert into budget_lines_packaging_2026_09
    (revision_id, bu, department, cat_l1, cat_l2_original, cat_l2_new, month, amount)
  select revision_id, bu, department, cat_l1, cat_l2, k_canon, month, amount
    from budget_lines where cat_l2 in (k_open, k_paren);
  get diagnostics v_lines = row_count;

  insert into requests_packaging_2026_09 (request_id, cat_l2_original, items_json_original, items_changed)
  select r.request_id, r.cat_l2, r.items_json,
         coalesce((select count(*) from jsonb_array_elements(r.items_json) x
                    where jsonb_typeof(r.items_json) = 'array' and x ->> 'cat_l2' = k_quoted), 0)
    from requests r
   where r.cat_l2 = k_quoted
      or (jsonb_typeof(r.items_json) = 'array'
          and exists (select 1 from jsonb_array_elements(r.items_json) x where x ->> 'cat_l2' = k_quoted))
  on conflict (request_id) do nothing;
  get diagnostics v_reqs = row_count;

  if v_cats <> 2 then raise exception 'ABORT: expected 2 categories rows, found %.', v_cats; end if;
  if v_lines <> 24 then raise exception 'ABORT: expected 24 budget lines, found %.', v_lines; end if;
  if exists (select 1 from budget_lines_packaging_2026_09 where amount <> 0) then
    raise exception 'ABORT: a budget line carries a non-zero figure.';
  end if;
  if exists (
    select 1 from budget_lines_packaging_2026_09 s join budget_revisions r on r.id = s.revision_id
     where r.status <> 'DRAFT'
  ) then raise exception 'ABORT: a non-DRAFT revision is in scope.'; end if;

  -- 2. Audit: one row per categories row, per budget-line group, per request.
  insert into audit_log (actor_email, request_id, action, detail_json)
  select 'system@migration', null, 'CATEGORY_RENAMED',
    jsonb_build_object('id', s.id, 'bu', s.bu, 'department', s.department, 'cat_l1', s.cat_l1,
      'before', jsonb_build_object('cat_l2', s.cat_l2_original),
      'after',  jsonb_build_object('cat_l2', s.cat_l2_new),
      'reason', 'CSV comma-split artifact; canonical name restored from the complete form used by live spend',
      'migration', '047_packaging_materials_canonical',
      'rollback_source', 'categories_packaging_2026_09')
  from categories_packaging_2026_09 s;

  insert into audit_log (actor_email, request_id, action, detail_json)
  select 'system@migration', null, 'BUDGET_LINE_MERGED',
    jsonb_build_object('revision_id', s.revision_id, 'owner_email', r.owner_email,
      'bu', s.bu, 'department', s.department, 'cat_l1', s.cat_l1,
      'from_cat_l2', s.cat_l2_original, 'to_cat_l2', s.cat_l2_new,
      'lines', count(*), 'amount_total', sum(s.amount),
      'migration', '047_packaging_materials_canonical',
      'rollback_source', 'budget_lines_packaging_2026_09')
  from budget_lines_packaging_2026_09 s join budget_revisions r on r.id = s.revision_id
  group by s.revision_id, r.owner_email, s.bu, s.department, s.cat_l1, s.cat_l2_original, s.cat_l2_new;

  insert into audit_log (actor_email, request_id, action, detail_json)
  select 'system@migration', s.request_id, 'REQUEST_RECATEGORISED',
    jsonb_build_object('field', 'cat_l2 (header and items_json)',
      'from', s.cat_l2_original, 'to', k_canon, 'items_changed', s.items_changed,
      'reason', 'CSV comma-split artifact carrying a leading double-quote; no categories row matched it',
      'amount_unchanged', true,
      'migration', '047_packaging_materials_canonical',
      'rollback_source', 'requests_packaging_2026_09')
  from requests_packaging_2026_09 s;

  select count(*) into v_audit from audit_log
   where detail_json ->> 'migration' = '047_packaging_materials_canonical';

  -- 3. Write.
  update categories c set cat_l2 = k_canon
    from categories_packaging_2026_09 s where c.id = s.id;

  update budget_lines b set cat_l2 = k_canon
    from budget_lines_packaging_2026_09 s
   where b.revision_id = s.revision_id and b.bu = s.bu and b.department = s.department
     and b.cat_l1 = s.cat_l1 and b.month = s.month and b.cat_l2 = s.cat_l2_original;

  update requests r set cat_l2 = k_canon, updated_at = now()
    from requests_packaging_2026_09 s
   where r.request_id = s.request_id and r.cat_l2 = k_quoted;

  update requests r
     set items_json = (
           select jsonb_agg(
                    case when t.it ->> 'cat_l2' = k_quoted
                         then jsonb_set(t.it, '{cat_l2}', to_jsonb(k_canon)) else t.it end
                    order by t.ord)
             from jsonb_array_elements(r.items_json) with ordinality as t(it, ord)),
         updated_at = now()
    from requests_packaging_2026_09 s
   where r.request_id = s.request_id and s.items_changed > 0
     and jsonb_typeof(r.items_json) = 'array';
  get diagnostics v_items = row_count;

  -- 4. Verify or abort: no damaged spelling may survive anywhere.
  select count(*) into v_left from (
    select 1 from categories where cat_l2 in (k_open, k_paren, k_quoted)
    union all select 1 from budget_lines where cat_l2 in (k_open, k_paren, k_quoted)
    union all select 1 from requests where cat_l2 in (k_open, k_paren, k_quoted)
    union all select 1 from requests r, jsonb_array_elements(r.items_json) x
               where jsonb_typeof(r.items_json) = 'array'
                 and x ->> 'cat_l2' in (k_open, k_paren, k_quoted)
  ) z;
  if v_left <> 0 then
    raise exception 'ABORT: % damaged spelling(s) survive.', v_left;
  end if;

  raise notice '047: categories % | budget_lines % | requests % (items %) | audit %',
    v_cats, v_lines, v_reqs, v_items, v_audit;
end $$;
