-- Point of contact on a deal. A deal can name one person (lead_contacts) as the
-- primary contact you're working with. Nullable and ON DELETE SET NULL so the
-- deal survives if the contact is removed; no required link at deal-create time
-- (a brand-new deal may not have a company/lead yet).
alter table public.deals
  add column contact_id bigint references public.lead_contacts(id) on delete set null;
create index idx_deals_contact on public.deals(contact_id);
