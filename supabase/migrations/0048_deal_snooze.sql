-- Snooze a deal until a future date: it drops off the Outreach board and, more
-- importantly, out of the weighted pipeline total, so the header figure reads
-- as the true value of the pipeline that can actually be worked right now.
--
-- Two columns only. Whether a deal is *currently* snoozed — and whether its
-- snooze has ended but not yet been cleared — is derived client-side from
-- today's date and never stored, the same rule deal_tasks' "overdue" follows
-- (0021) and days_in_stage before it (0027). There is deliberately no cron or
-- server job waking anything up: the date comparison happens at render, so a
-- deal returns to the board on its own the moment snoozed_until arrives.
--
-- deal_summaries is `select d.*` and Postgres freezes a view's column list at
-- creation time, so the view has to be dropped and recreated here or the new
-- columns never reach the client — same drop/recreate every prior
-- deals-column migration needed (0016/0017/0027/0039/0040/0046). The body
-- below is copied verbatim from 0046, the current definition (0047 adds
-- stage_weights and doesn't touch the view).
--
-- No new RLS policy: the blanket "authenticated full access" policy on
-- public.deals (0002) already covers new columns.

alter table public.deals
  add column if not exists snoozed_until date,
  add column if not exists snooze_note   text;

drop view if exists public.deal_summaries;

create view public.deal_summaries with (security_invoker = true) as
select d.*,
  l.company_name,
  l.domain,
  l.is_client,
  l.vertical_id,
  v.name as vertical_name,
  (select sh.entered_at
     from public.stage_history sh
    where sh.deal_id = d.id and sh.stage = d.current_stage
    order by sh.entered_at desc, sh.id desc
    limit 1) as current_stage_entered_at,
  (select min(sh.entered_at)
     from public.stage_history sh
    where sh.deal_id = d.id) as pipeline_entered_at,
  (select max(t.touch_date)
     from public.touch_log t
    where t.deal_id = d.id
      and t.touch_date >= coalesce(
        (select sh.entered_at
           from public.stage_history sh
          where sh.deal_id = d.id and sh.stage = d.current_stage
          order by sh.entered_at desc, sh.id desc
          limit 1),
        d.created_at
      )
  ) as last_touch_in_stage,
  (select ds.id from public.deal_stakeholders ds
    where ds.deal_id = d.id and ds.is_primary limit 1) as primary_stakeholder_id,
  (select ds.name from public.deal_stakeholders ds
    where ds.deal_id = d.id and ds.is_primary limit 1) as primary_stakeholder_name,
  (select ds.role from public.deal_stakeholders ds
    where ds.deal_id = d.id and ds.is_primary limit 1) as primary_stakeholder_role
from public.deals d
join public.leads l on l.id = d.lead_id
left join public.verticals v on v.id = l.vertical_id;

-- start_outreach() (0046) and accept_email_suggestion_as_deal() (0007, fixed
-- in 0039/0040) don't name these columns in their insert lists and both are
-- nullable with no default, so a new deal is simply never born snoozed — no
-- function change needed.
--
-- No index on snoozed_until: listDeals() fetches every deal and filters
-- client-side (see OutreachView), so nothing ever queries on this column.
