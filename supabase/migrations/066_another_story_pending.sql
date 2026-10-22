-- Declare which inactive channels are NOT YET OPEN, as opposed to retired.
--
-- ===========================================================================
-- NOTHING IN THE DATA DISTINGUISHED THE TWO. That is why this is declared.
-- ===========================================================================
-- All three inactive ONEST channels — Another story, Siplor and
-- LOFT EYES - Tong lor — were identically `active = false, status = null`.
-- There was no field, flag or date separating "signed, being fitted out" from
-- "cancelled" or "closed down".
--
-- An inference was available and is deliberately NOT used: Another story is
-- the only one carrying a revenue goal (฿40,000 FY2026), so "inactive but
-- budgeted for" would have picked it out today. It would also have been wrong
-- the first time somebody set a goal on a site that was later cancelled, and
-- the cost of being wrong is a cancelled store appearing in a spend picker.
--
-- So it is stated, reusing the status level that already exists rather than
-- adding a column:
--
--   pending  signed / fitting out / has never traded   -> offered to New Store
--                                                         Investment only
--   (null)   retired, cancelled, or a misspelling      -> offered nowhere
--
-- Siplor (cancelled) and LOFT EYES - Tong lor (a misspelling of a live
-- channel, created and closed 34 seconds apart on 1 October) are deliberately
-- left null. Neither should ever be selectable.
--
-- WHY NEW STORE INVESTMENT ONLY. Fitting out happens before trading, so NSI
-- must be able to name a door that has not opened. Retail keeps the stricter
-- rule — active, or closed in a year it traded — because spending Retail
-- operating cost against a store that has never opened is a mistake, not a
-- case to support.
--
-- ROLLBACK:
--   update revenue_channels set status = null
--     where bu = 'ONEST' and channel = 'Another story';

do $$
declare v_updated integer;
begin
  update public.revenue_channels
     set status = 'pending'
   where bu = 'ONEST' and category = 'Physical store'
     and channel = 'Another story' and not active;
  get diagnostics v_updated = row_count;

  if v_updated <> 1 then
    raise exception 'ABORT: expected exactly 1 "Another story" row to update, got %.', v_updated;
  end if;

  -- The other two must stay unmarked: this migration grants selectability, and
  -- granting it to a cancelled site is the failure it is written to avoid.
  if exists (
    select 1 from public.revenue_channels
     where bu = 'ONEST' and not active
       and channel in ('Siplor', 'LOFT EYES - Tong lor')
       and status is not null
  ) then
    raise exception 'ABORT: a retired channel was marked with a status.';
  end if;

  -- An ACTIVE channel must never be pending — pending means "has not opened".
  if exists (select 1 from public.revenue_channels where active and status = 'pending') then
    raise exception 'ABORT: an active channel is marked pending.';
  end if;

  raise notice '066: Another story marked pending; Siplor and LOFT EYES - Tong lor left retired.';
end $$;
