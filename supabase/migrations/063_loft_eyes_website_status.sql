-- "Loft eyes - website" gets status = 'sell'.
--
-- It was added on 2026-10-05 through a modal that had no Status field, so it
-- landed with status NULL under Specialty partners — a sub-category that DOES
-- group by status. The tree therefore rendered it as a sibling of
-- sell / use / closed rather than inside one of them. The modal gap is fixed
-- separately; this corrects the one row it produced.
--
-- WHY 'sell' AND NOT NULL-AS-MISSING-DATA. It is a consignment on Loft eyes'
-- own website at 35% that has never billed. That is a selling door which has
-- not yet sold, not an unknown: 'sell' is the honest value, and the absence of
-- revenue is a fact about the door's trading, not about our records.
--
-- NOT 'closed', which would mean a door that traded and shut, and would stop
-- it being given a budget for a year it never traded in.
--
-- The three other NULL-status channels under Specialty partners — Another
-- story, Siplor, LOFT EYES - Tong lor — are DELIBERATELY NOT TOUCHED here.
-- All three are inactive, and where each belongs is a decision to take
-- deliberately rather than fold into a migration about a different channel.
--
-- ROLLBACK:
--   update revenue_channels c set status = s.status_original
--     from revenue_channels_status_063 s where c.id = s.channel_id;
--   delete from audit_log where action = 'REVENUE_CHANNEL_UPDATED'
--     and detail_json ->> 'migration' = '063_loft_eyes_website_status';

create table if not exists revenue_channels_status_063 (
  channel_id uuid primary key,
  channel text,
  status_original text,
  snapshot_at timestamptz not null default now()
);

comment on table revenue_channels_status_063 is
  'Pre-change status for the channel corrected by migration 063. Rollback source.';

do $$
declare
  v_id uuid;
  v_updated integer;
begin
  select id into v_id from revenue_channels
   where bu = 'ONEST' and category = 'Physical store'
     and sub_category = 'Specialty partners'
     and channel = 'Loft eyes - website';

  if v_id is null then
    raise exception 'ABORT: no channel "Loft eyes - website" under ONEST / Physical store / Specialty partners. Check the exact spelling before re-running.';
  end if;

  insert into revenue_channels_status_063 (channel_id, channel, status_original)
  select id, channel, status from revenue_channels where id = v_id
  on conflict (channel_id) do nothing;

  update revenue_channels set status = 'sell' where id = v_id;
  get diagnostics v_updated = row_count;

  insert into audit_log (actor_email, request_id, action, detail_json)
  select 'system@migration', null, 'REVENUE_CHANNEL_UPDATED',
    jsonb_build_object(
      'channel_id', s.channel_id, 'channel', s.channel,
      'from', jsonb_build_object('status', s.status_original),
      'to',   jsonb_build_object('status', 'sell'),
      'reason', 'Added through a modal that had no Status field, so it landed NULL under a sub-category that groups by status and rendered beside sell/use/closed. It is a consignment on Loft eyes'' own website at 35% that has not yet billed — a selling door that has not sold, not missing data.',
      'migration', '063_loft_eyes_website_status',
      'rollback_source', 'revenue_channels_status_063'
    )
  from revenue_channels_status_063 s where s.channel_id = v_id;

  if v_updated <> 1 then
    raise exception 'ABORT: updated % rows, expected exactly 1.', v_updated;
  end if;

  -- The optional level must stay optional: nothing outside a status-using
  -- sub-category may have gained one.
  if exists (
    select 1 from revenue_channels c
     where c.status is not null
       and not exists (
         select 1 from revenue_channels o
          where o.bu = c.bu and o.category = c.category
            and o.sub_category = c.sub_category and o.id <> c.id and o.status is not null
       )
  ) then
    raise exception 'ABORT: a channel carries a status in a sub-category where no other does.';
  end if;

  raise notice '063: Loft eyes - website set to sell.';
end $$;
