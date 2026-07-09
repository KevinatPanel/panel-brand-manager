-- Phase 4: accept / reject the people+companies review queue.
--
-- Mirrors accept_email_suggestion_as_deal (0007): atomic, security invoker so
-- the caller's RLS applies — a rep can only resolve their own suggestions
-- (company_suggestions / contact_suggestions are auth.uid()-scoped).
--
-- accept_company_suggestion resolves the company (an existing matched lead, or a
-- brand-new one) and inserts the selected people under it, re-checking the
-- email dedup at insert time so a race / concurrent scan can't create a
-- duplicate contact.

create or replace function public.accept_company_suggestion(
  p_company_suggestion_id bigint,
  p_contact_ids           bigint[] default null
) returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cs       public.company_suggestions%rowtype;
  v_lead_id  bigint;
  v_name     text;
  v_now      timestamptz := now();
  v_contact  public.contact_suggestions%rowtype;
  v_existing bigint;
begin
  select * into v_cs from public.company_suggestions where id = p_company_suggestion_id;
  if not found then
    raise exception 'Company suggestion % not found', p_company_suggestion_id;
  end if;
  if v_cs.status = 'dismissed' then
    raise exception 'Company suggestion already dismissed';
  end if;

  -- Resolve the company: reuse the matched lead, else create one.
  if v_cs.matched_lead_id is not null then
    v_lead_id := v_cs.matched_lead_id;
  else
    v_name := coalesce(
      nullif(btrim(v_cs.proposed_company_name), ''),
      initcap(nullif(split_part(coalesce(v_cs.domain, ''), '.', 1), '')),
      'New company'
    );
    insert into public.leads
      (company_name, domain, website, score, score_updated_at, in_pipeline, created_at, updated_at)
    values
      (v_name, v_cs.domain, v_cs.domain, 0, v_now, false, v_now, v_now)
    returning id into v_lead_id;
  end if;

  -- Insert the selected people (or all pending children when none specified).
  for v_contact in
    select * from public.contact_suggestions
     where company_suggestion_id = p_company_suggestion_id
       and status = 'pending'
       and (p_contact_ids is null or id = any(p_contact_ids))
  loop
    -- Re-check email dedup against the whole CRM at insert time.
    v_existing := null;
    if v_contact.email is not null and btrim(v_contact.email) <> '' then
      select id into v_existing
        from public.lead_contacts
       where lower(email) = lower(v_contact.email)
       limit 1;
    end if;

    if v_existing is null then
      insert into public.lead_contacts
        (lead_id, name, email, title, phone, linkedin, location, seniority, created_at)
      values
        (v_lead_id, coalesce(v_contact.name, v_contact.email, 'Unknown'),
         v_contact.email, v_contact.title, v_contact.phone, v_contact.linkedin,
         v_contact.location, v_contact.seniority, v_now)
      returning id into v_existing;
    end if;

    update public.contact_suggestions
       set status = 'accepted', resolved_at = v_now, matched_contact_id = v_existing
     where id = v_contact.id;
  end loop;

  update public.company_suggestions
     set status = 'accepted', resolved_at = v_now, matched_lead_id = v_lead_id
   where id = p_company_suggestion_id;

  return v_lead_id;
end;
$$;

grant execute on function public.accept_company_suggestion(bigint, bigint[]) to authenticated;

-- Reject a whole company suggestion (and its still-pending people).
create or replace function public.reject_company_suggestion(
  p_company_suggestion_id bigint
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  update public.contact_suggestions
     set status = 'dismissed', resolved_at = v_now
   where company_suggestion_id = p_company_suggestion_id and status = 'pending';
  update public.company_suggestions
     set status = 'dismissed', resolved_at = v_now
   where id = p_company_suggestion_id;
end;
$$;

grant execute on function public.reject_company_suggestion(bigint) to authenticated;

-- Reject a single proposed person (leaves the company + siblings untouched).
create or replace function public.reject_contact_suggestion(
  p_contact_suggestion_id bigint
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.contact_suggestions
     set status = 'dismissed', resolved_at = now()
   where id = p_contact_suggestion_id;
end;
$$;

grant execute on function public.reject_contact_suggestion(bigint) to authenticated;
