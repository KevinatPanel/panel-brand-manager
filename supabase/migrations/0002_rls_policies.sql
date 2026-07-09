-- Shared internal workspace: any authenticated (allowlisted) team member has
-- full CRUD on all tables. The anon role gets no policy, so logged-out requests
-- return nothing — the app is effectively gated behind login.
do $$
declare t text;
begin
  foreach t in array array[
    'deals','stage_history','touch_log','verticals',
    'leads','lead_signals','lead_contacts','scoring_config'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format(
      'create policy "authenticated full access" on public.%I for all to authenticated using (true) with check (true);',
      t
    );
  end loop;
end $$;
