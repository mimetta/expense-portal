-- Restructure the ONEST revenue channel hierarchy.
--
-- Same snapshot + audit + verify-or-abort pattern as migrations 019, 020, 043.
--
-- ===========================================================================
-- EVERY CHANGE IS AN UPDATE IN PLACE. NOTHING IS DELETED AND RECREATED.
-- ===========================================================================
-- revenue_goals.channel_id is a FK with ON DELETE CASCADE (migration 033), so
-- delete-then-insert would silently destroy a channel's entire goal and actual
-- history and change last year's comparison. A rename or a move is therefore
-- an UPDATE of the same row, and the figures follow the id without being
-- touched at all. The verify block below asserts exactly that.
--
-- THE SHAPE
--
--   Physical store
--     Owned store                     -> Song Wat, Talat Noi
--     Specialty partners (was Modern Trade)
--         sell   -> Siam Discovery, Vanich House, Loft eyes,
--                   Loft eyes-Thong Lor, Ecotopia, Gaysorn,
--                   Unusual & Friend, Tudi
--         use    -> Momo Tennis
--         closed -> DCP            (moved from Pop-up)
--     Event              (was Pop-up) -> Central Chidlom, Emporium, Loopers, LOQA
--   Online
--     E-commerce                      -> Shopee, Lazada, TikTok
--     DTC-Thailand                    -> Line Shop, Line OA
--
-- THE FOURTH LEVEL IS OPTIONAL AND THE COLUMN IS NULLABLE. Only Specialty
-- partners uses it; Owned store, Event, E-commerce and DTC-Thailand keep
-- status NULL. The model must not assume a status everywhere -- a NOT NULL
-- column with a '' or 'none' sentinel would force every consumer to special-
-- case the sentinel, and the tree builder would grow a level nobody wanted.
--
-- ONLY TWO CHANNELS ARE CREATED: Tudi and Momo Tennis.
-- Loft eyes-Thong Lor, Central Chidlom, Emporium and LOQA were described as
-- new but ALREADY EXIST, carrying FY2026 goals of 45,000 / 150,000 / 150,000 /
-- 30,000. Creating them would have produced duplicate rows and orphaned those
-- figures behind a channel nobody was looking at. Verified live before writing
-- this, and asserted below: the channel count rises by exactly 2.
--
-- 'Unusual & Friend' is NOT renamed here. The sheet calls it "Unusual&Friends"
-- (plural), which norm() cannot reconcile -- that is handled by an explicit
-- alias in lib/revenue-sheet.ts, so the portal's display name is not dictated
-- by how a spreadsheet heading was typed.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK (one statement, against the pre-image)
--
--   update revenue_channels c
--      set category = s.category_original,
--          sub_category = s.sub_category_original,
--          channel = s.channel_original,
--          status = s.status_original,
--          active = s.active_original
--     from revenue_channels_hierarchy_053 s
--    where c.id = s.channel_id;
--
--   delete from revenue_channels
--    where id in (select channel_id from revenue_channels_created_053);
--
--   delete from audit_log where action in ('REVENUE_CHANNEL_UPDATED', 'REVENUE_CHANNEL_CREATED')
--     and detail_json ->> 'migration' = '053_revenue_channel_hierarchy';
--
--   alter table revenue_channels drop column status;   -- only if reverting the model too
--
-- Deleting the two created channels is safe ONLY because they are new and have
-- no goals yet. If goals have since been entered against them, drop that
-- statement -- the cascade would take the figures with it.
-- ---------------------------------------------------------------------------

alter table public.revenue_channels
  add column if not exists status text;

comment on column public.revenue_channels.status is
  'Optional FOURTH hierarchy level, below sub_category. NULL for sub-categories that do not use it (Owned store, Event, E-commerce, DTC-Thailand). Currently sell | use | closed, under Specialty partners. No CHECK constraint: validated in the application layer, the same convention calendar_events.event_type uses.';

create table if not exists revenue_channels_hierarchy_053 (
  channel_id uuid primary key,
  category_original text,
  sub_category_original text,
  channel_original text,
  status_original text,
  active_original boolean,
  snapshot_at timestamptz not null default now()
);

comment on table revenue_channels_hierarchy_053 is
  'Pre-change hierarchy for every ONEST revenue channel touched by migration 053. Rollback source.';

create table if not exists revenue_channels_created_053 (
  channel_id uuid primary key,
  channel text,
  snapshot_at timestamptz not null default now()
);

comment on table revenue_channels_created_053 is
  'The channels migration 053 created (Tudi, Momo Tennis). Rollback source -- safe to delete ONLY while they still carry no goals.';

do $$
declare
  v_snapshot integer;
  v_created integer;
  v_audit integer;
  v_before_channels integer;
  v_after_channels integer;
  v_goal_rows_before integer;
  v_goal_rows_after integer;
  v_orphans integer;
  v_sum_before numeric;
  v_sum_after numeric;
  v_act_before numeric;
  v_act_after numeric;
begin
  select count(*) into v_before_channels from revenue_channels where bu = 'ONEST';
  select count(*), coalesce(sum(amount),0), coalesce(sum(actual_amount),0)
    into v_goal_rows_before, v_sum_before, v_act_before
    from revenue_goals g join revenue_channels c on c.id = g.channel_id
   where c.bu = 'ONEST';

  -- 1. Snapshot every ONEST channel WHOLE, before any write.
  insert into revenue_channels_hierarchy_053
    (channel_id, category_original, sub_category_original, channel_original, status_original, active_original)
  select id, category, sub_category, channel, status, active
    from revenue_channels where bu = 'ONEST'
  on conflict (channel_id) do nothing;
  get diagnostics v_snapshot = row_count;

  -- 2. Rename the two sub-categories. Plain UPDATEs: every channel beneath
  --    keeps its id, so every goal and actual follows untouched.
  update revenue_channels
     set sub_category = 'Specialty partners'
   where bu = 'ONEST' and category = 'Physical store' and sub_category = 'Modern Trade';

  update revenue_channels
     set sub_category = 'Event'
   where bu = 'ONEST' and category = 'Physical store' and sub_category = 'Pop-up';

  -- 3. DCP moves from Event (ex Pop-up) to Specialty partners, status closed.
  --    It carries 462,264.25 of FY2026 actuals and a full 12 months of FY2025
  --    across with it, by virtue of being the same row.
  update revenue_channels
     set sub_category = 'Specialty partners', status = 'closed'
   where bu = 'ONEST' and channel = 'DCP';

  -- 4. Display names, to the spec's casing. Cosmetic and safe for the sheet
  --    match: norm() lowercases and strips non-alphanumerics, so
  --    'LOFT EYES - Thong Lor' and 'Loft eyes-Thong Lor' both normalise to
  --    'lofteyesthonglor' and keep matching the same sheet row.
  update revenue_channels set channel = 'Loft eyes'
   where bu = 'ONEST' and channel = 'Loft Eyes';
  update revenue_channels set channel = 'Loft eyes-Thong Lor'
   where bu = 'ONEST' and channel = 'LOFT EYES - Thong Lor';

  -- 5. The status level, for Specialty partners only.
  update revenue_channels
     set status = 'sell'
   where bu = 'ONEST' and sub_category = 'Specialty partners'
     and active
     and channel in ('Siam Discovery', 'Vanich House', 'Loft eyes',
                     'Loft eyes-Thong Lor', 'Ecotopia', 'Gaysorn',
                     'Unusual & Friend');

  -- 6. The two genuinely new channels. sort_order places them after the
  --    existing members of their status group.
  insert into revenue_channels (bu, category, sub_category, channel, status, sort_order, active)
  select 'ONEST', 'Physical store', 'Specialty partners', v.channel, v.status, v.ord, true
    from (values ('Tudi', 'sell', 80), ('Momo Tennis', 'use', 90)) as v(channel, status, ord)
   where not exists (
     select 1 from revenue_channels c
      where c.bu = 'ONEST' and c.category = 'Physical store'
        and c.sub_category = 'Specialty partners' and c.channel = v.channel
   );
  get diagnostics v_created = row_count;

  insert into revenue_channels_created_053 (channel_id, channel)
  select id, channel from revenue_channels
   where bu = 'ONEST' and sub_category = 'Specialty partners'
     and channel in ('Tudi', 'Momo Tennis')
  on conflict (channel_id) do nothing;

  -- 7. Audit: one row per channel whose hierarchy actually changed, plus one
  --    per creation. Unchanged rows are not logged -- a log of non-events
  --    is how a real change becomes hard to find later.
  insert into audit_log (actor_email, request_id, action, detail_json)
  select 'system@migration', null, 'REVENUE_CHANNEL_UPDATED',
    jsonb_build_object(
      'channel_id', c.id,
      'from', jsonb_build_object('sub_category', s.sub_category_original,
                                 'channel', s.channel_original,
                                 'status', s.status_original),
      'to',   jsonb_build_object('sub_category', c.sub_category,
                                 'channel', c.channel,
                                 'status', c.status),
      'figures_moved_with_it', true,
      'reason', 'ONEST revenue channel hierarchy restructure: Modern Trade -> Specialty partners (with an optional sell/use/closed level), Pop-up -> Event, DCP moved to Specialty partners/closed.',
      'migration', '053_revenue_channel_hierarchy',
      'rollback_source', 'revenue_channels_hierarchy_053'
    )
  from revenue_channels c
  join revenue_channels_hierarchy_053 s on s.channel_id = c.id
  where c.sub_category is distinct from s.sub_category_original
     or c.channel      is distinct from s.channel_original
     or c.status       is distinct from s.status_original;
  get diagnostics v_audit = row_count;

  insert into audit_log (actor_email, request_id, action, detail_json)
  select 'system@migration', null, 'REVENUE_CHANNEL_CREATED',
    jsonb_build_object(
      'channel_id', c.channel_id, 'channel', c.channel,
      'sub_category', 'Specialty partners',
      'reason', 'New channel in the restructured hierarchy; present in the revenue sheet with no portal counterpart.',
      'migration', '053_revenue_channel_hierarchy',
      'rollback_source', 'revenue_channels_created_053'
    )
  from revenue_channels_created_053 c;

  -- =========================================================================
  -- VERIFY OR ABORT. Any RAISE rolls the whole migration back.
  -- =========================================================================
  select count(*) into v_after_channels from revenue_channels where bu = 'ONEST';
  if v_after_channels <> v_before_channels + 2 then
    raise exception 'ABORT: ONEST channel count went % -> %, expected exactly +2 (Tudi, Momo Tennis).',
      v_before_channels, v_after_channels;
  end if;

  -- THE CENTRAL GUARANTEE: not one goal or actual moved, anywhere.
  select count(*), coalesce(sum(amount),0), coalesce(sum(actual_amount),0)
    into v_goal_rows_after, v_sum_after, v_act_after
    from revenue_goals g join revenue_channels c on c.id = g.channel_id
   where c.bu = 'ONEST';

  if v_goal_rows_after <> v_goal_rows_before then
    raise exception 'ABORT: ONEST goal rows went % -> %. A rename orphaned figures.',
      v_goal_rows_before, v_goal_rows_after;
  end if;
  if v_sum_after <> v_sum_before then
    raise exception 'ABORT: goal total moved % -> %.', v_sum_before, v_sum_after;
  end if;
  if v_act_after <> v_act_before then
    raise exception 'ABORT: actual total moved % -> %.', v_act_before, v_act_after;
  end if;

  -- No goal row may point at a channel that no longer exists.
  select count(*) into v_orphans
    from revenue_goals g left join revenue_channels c on c.id = g.channel_id
   where c.id is null;
  if v_orphans > 0 then
    raise exception 'ABORT: % goal row(s) orphaned.', v_orphans;
  end if;

  -- The shape itself.
  if exists (select 1 from revenue_channels
              where bu = 'ONEST' and sub_category in ('Modern Trade', 'Pop-up')) then
    raise exception 'ABORT: Modern Trade / Pop-up still present.';
  end if;
  if not exists (select 1 from revenue_channels
                  where bu = 'ONEST' and channel = 'DCP'
                    and sub_category = 'Specialty partners' and status = 'closed') then
    raise exception 'ABORT: DCP is not under Specialty partners/closed.';
  end if;
  -- The optional level stays optional: nothing outside Specialty partners may
  -- carry a status, or the tree grows a level those sub-categories never asked
  -- for.
  if exists (select 1 from revenue_channels
              where bu = 'ONEST' and sub_category <> 'Specialty partners'
                and status is not null) then
    raise exception 'ABORT: a status was set outside Specialty partners.';
  end if;

  raise notice '053: snapshot=% created=% audited=% | channels %->% | goal rows % (sum % / actual %) unchanged',
    v_snapshot, v_created, v_audit, v_before_channels, v_after_channels,
    v_goal_rows_after, v_sum_after, v_act_after;
end $$;
