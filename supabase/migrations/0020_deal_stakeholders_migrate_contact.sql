-- Backfill: every deal that already names a point-of-contact (deals.contact_id)
-- becomes that deal's first, primary stakeholder — copying the linked
-- lead_contacts row's name/email/linkedin as of today. This is a one-time
-- snapshot, not a live link (deal_stakeholders is deliberately free-form, see
-- 0019); if the underlying contact record changes later, the stakeholder row
-- does not follow it.
--
-- deals.contact_id and the slide-out's "Point of Contact" field/ContactSelect
-- are deliberately left untouched here — not dropped, not stopped being
-- written to. Retiring them is a follow-up once the new Stakeholders UI has
-- been verified live; coupling that cleanup into this same migration is
-- exactly the kind of same-migration risk that already broke deal_summaries
-- twice (see 0016/0017).
insert into public.deal_stakeholders
  (deal_id, name, role, email, linkedin, is_primary, source_contact_id, created_at, updated_at)
select
  d.id,
  coalesce(nullif(trim(lc.name), ''), 'Primary Contact'),
  'Other',
  lc.email,
  lc.linkedin,
  true,
  lc.id,
  now(),
  now()
from public.deals d
join public.lead_contacts lc on lc.id = d.contact_id
where d.contact_id is not null;
