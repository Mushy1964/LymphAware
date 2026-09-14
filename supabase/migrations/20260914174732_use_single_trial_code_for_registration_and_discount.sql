-- Use one tester-facing code for both registration access and the automatic Stripe trial discount.
-- The shared trial code stays active for invited testers; Stripe controls the total redemption limit.

revoke all on table public.pilot_invites from anon, authenticated, public;
grant select, update on table public.pilot_invites to service_role;
grant select, update on table public.pilot_invites to supabase_auth_admin;

insert into public.pilot_invites (invite_code, email, active, used_at)
values ('LYMPHAWARETRIAL', null, true, null)
on conflict (invite_code)
do update set email = null, active = true;

update public.pilot_invites
set active = false
where upper(invite_code) <> 'LYMPHAWARETRIAL'
  and active = true;

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
  if lower(coalesce(new.email, '')) = 'admin@lymphaware.com' then
    return new;
  end if;

  select upper(setting_value) into registration_mode_value
  from public.system_settings
  where setting_key = 'registration_mode'
  limit 1;

  if coalesce(registration_mode_value, 'CLOSED') = 'OPEN' then
    return new;
  end if;

  if registration_mode_value = 'INVITE_ONLY' then
    supplied_trial_code := upper(btrim(coalesce(new.raw_user_meta_data ->> 'registration_invite_code', '')));

    select id into matching_invite_id
    from public.pilot_invites
    where upper(invite_code) = supplied_trial_code
      and active = true
      and (email is null or lower(email) = lower(coalesce(new.email, '')))
    for update
    limit 1;

    if matching_invite_id is null then
      raise exception 'A valid LymphAware trial code is required.';
    end if;

    update public.pilot_invites set used_at = now() where id = matching_invite_id;
    return new;
  end if;

  raise exception 'New LymphAware account registration is currently closed.';
end;
$function$;

revoke all on function public.enforce_lymphaware_registration_mode() from public, anon, authenticated;
grant execute on function public.enforce_lymphaware_registration_mode() to supabase_auth_admin;

insert into public.system_settings (setting_key, setting_value, updated_at)
values ('registration_mode', 'INVITE_ONLY', now())
on conflict (setting_key)
do update set setting_value = excluded.setting_value, updated_at = excluded.updated_at;

comment on table public.pilot_invites is
  'Trial access codes used while registration_mode is INVITE_ONLY. The active shared code is also applied automatically as the Stripe trial promotion code.';

comment on table public.invitation_codes is
  'Legacy development invitation codes. These no longer permit account creation.';
