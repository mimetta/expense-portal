-- Mimetta Expense Portal — clear CSV comma-split debris from
-- categories.product.
--
-- Same snapshot + audit + verify-or-abort pattern as 019/020/043/047.
--
-- WHAT IS WRONG. Three categories rows carry a fragment in `product` that the
-- import's comma-split spilled out of the adjacent quoted field:
--
--   ONEST / General Administrative / TAXES / 'ภงด 1'
--       product = '3'      (byte 0x33 — a bare "3", NOT 'ภงด 3')
--   SV    / General Administrative / TAXES / 'ภงด 1'
--       product = '3'
--   SV    / Operations/Fulfillment / Logistics & Shipping /
--           'Packaging Materials (Shipping boxes, tape)'
--       product = 'tape'
--
-- These are the tails of 'ภงด 1, 3' and '(Shipping boxes, tape)'. They are not
-- products.
--
-- WHY CLEARING IS SAFE — established before writing, not assumed:
--
--   * NO request references either value. requests.product and every
--     items_json[].product were scanned: 0 headers and 0 items for '3' and for
--     'tape'. The 245 requests that do carry a product use 33 real values
--     (Song Wat, Talat Noi, the hand-cream SKUs, …).
--
--   * THE PICKERS DO NOT READ THIS COLUMN. /submit's Retail Branch and R&D
--     Product dropdowns read the `products` table via
--     RequestForm#productOptionsFor — 20 rows, 7 Retail and 13 R&D. And
--     categories.product is empty for EVERY Retail and R&D row, so these three
--     (General Administrative, Operations/Fulfillment) could not reach a
--     picker even if it did read them: neither department has a Branch or
--     Product field at all.
--
--   * The only readers of categories.product anywhere are three lines inside
--     the Settings tab itself — the edit modal prefill, the search predicate,
--     and the Product column of the tree.
--
--   * The unique index from 048 does NOT include `product`, so emptying it
--     cannot collide with another row.
--
-- So the debris is inert: it is visible in Settings and nowhere else.
--
-- ROLLBACK:
--
--   update categories c set product = s.product_original
--     from categories_product_debris_2026_09 s where c.id = s.id;
--   delete from audit_log where detail_json ->> 'migration' = '049_clear_category_product_debris';
--
-- ---------------------------------------------------------------------------

create table if not exists categories_product_debris_2026_09 (
  id uuid primary key,
  bu text not null,
  department text not null,
  cat_l1 text,
  cat_l2 text,
  product_original text not null,
  snapshot_at timestamptz not null default now()
);

comment on table categories_product_debris_2026_09 is
  'Pre-change categories.product for the three rows cleared by migration 049 (CSV comma-split fragments). Rollback source.';

do $$
declare
  v_snapshot int; v_updated int; v_audit int; v_left int;
begin
  -- 1. Snapshot. Targeted by ID-equivalent coordinates and by the exact
  --    fragment values, so a row that has since gained a REAL product is not
  --    swept up.
  insert into categories_product_debris_2026_09 (id, bu, department, cat_l1, cat_l2, product_original)
  select c.id, c.bu, c.department, c.cat_l1, c.cat_l2, c.product
    from categories c
   where c.product is not null
     and btrim(c.product) <> ''
     and (
       (c.department = 'General Administrative' and c.cat_l1 = 'TAXES' and c.product = '3')
       or (c.department = 'Operations/Fulfillment' and c.cat_l1 = 'Logistics & Shipping' and c.product = 'tape')
     )
  on conflict (id) do nothing;
  get diagnostics v_snapshot = row_count;

  if v_snapshot <> 3 then
    raise exception 'ABORT: expected exactly 3 debris rows, found %.', v_snapshot;
  end if;

  -- 2. One audit row per category row.
  insert into audit_log (actor_email, request_id, action, detail_json)
  select 'system@migration', null, 'CATEGORY_PRODUCT_CLEARED',
    jsonb_build_object(
      'id', s.id, 'bu', s.bu, 'department', s.department,
      'cat_l1', s.cat_l1, 'cat_l2', s.cat_l2,
      'before', s.product_original,
      'after', null,
      'reason', 'CSV comma-split fragment spilled from the adjacent quoted field; not a product. No request references it and no picker reads categories.product.',
      'migration', '049_clear_category_product_debris',
      'rollback_source', 'categories_product_debris_2026_09')
  from categories_product_debris_2026_09 s;
  get diagnostics v_audit = row_count;

  -- 3. Clear.
  update categories c set product = null
    from categories_product_debris_2026_09 s
   where c.id = s.id and c.product = s.product_original;
  get diagnostics v_updated = row_count;

  -- 4. Verify or abort.
  if v_updated <> v_snapshot then
    raise exception 'ABORT: updated (%) <> snapshot (%).', v_updated, v_snapshot;
  end if;
  if v_audit <> v_snapshot then
    raise exception 'ABORT: audit (%) <> snapshot (%).', v_audit, v_snapshot;
  end if;

  select count(*) into v_left from categories
   where product in ('3', 'tape');
  if v_left <> 0 then
    raise exception 'ABORT: % debris value(s) survive.', v_left;
  end if;

  raise notice '049: snapshot % | updated % | audit %', v_snapshot, v_updated, v_audit;
end $$;
