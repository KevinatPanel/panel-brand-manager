-- Fix accept_company_suggestion (0010): company_suggestions.matched_lead_id is
-- only ever set at row-creation time (see suggest.ts). If a leads row for that
-- domain shows up afterward through any other path — manual "+ Add Company",
-- Apollo backfilling domain onto an existing lead, or a sibling suggestion for
-- the same domain being accepted first — matched_lead_id stays stale/null and
-- this function used to blindly insert a second leads row for the same
-- domain. suggest.ts now refreshes matched_lead_id opportunistically when it
-- reuses a pending suggestion, but that only covers the Gmail-scan path; this
-- re-check is the actual backstop, right at the point a new lead would be
-- created.

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

  -- Resolve the company: reuse the matched lead if we have one, otherwise
  -- re-check by domain (matched_lead_id can be stale — see header comment)
  -- before deciding a new company is actually needed.
  v_lead_id := v_cs.matched_lead_id;
  if v_lead_id is null and v_cs.domain is not null and btrim(v_cs.domain) <> '' then
    select id into v_lead_id from public.leads where domain = v_cs.domain limit 1;
  end if;

  if v_lead_id is null then
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
