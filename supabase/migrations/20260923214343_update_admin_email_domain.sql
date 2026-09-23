-- Keep invite-only registration aligned with the LymphAware ID administrator email.
-- Applied to production on 23 September 2026.

create or replace function public.enforce_lymphaware_registration_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  registration_mode_value text;
  supplied_trial_code text;
  matching_invite_id uuid;
begin
  if lower(coalesce(new.email, '')) = 'admin@lymphawareid.com' then
    return new;
  end if;

  select upper(setting_value)
    into registration_mode_value
  from public.system_settings
  where setting_key = 'registration_mode'
  limit 1;

  if coalesce(registration_mode_value, 'CLOSED') = 'OPEN' then
    return new;
  end if;

  if registration_mode_value = 'INVITE_ONLY' then
    supplied_trial_code := upper(btrim(coalesce(new.raw_user_meta_data ->> 'registration_invite_code', '')));

    select id
      into matching_invite_id
    from public.pilot_invites
    where upper(invite_code) = supplied_trial_code
      and active = true
      and (email is null or lower(email) = lower(coalesce(new.email, '')))
    for update
    limit 1;

    if matching_invite_id is null then
      raise exception 'A valid LymphAware trial code is required.';
    end if;

    update public.pilot_invites
      set used_at = now()
    where id = matching_invite_id;

    return new;
  end if;

  raise exception 'New LymphAware account registration is currently closed.';
end;
$function$;

revoke all on function public.enforce_lymphaware_registration_mode() from public, anon, authenticated;
grant execute on function public.enforce_lymphaware_registration_mode() to supabase_auth_admin;
