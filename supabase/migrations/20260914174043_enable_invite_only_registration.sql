-- Keep the live site available for invited trial participants while preventing public sign-up.
-- Invitation codes are single-use and are consumed atomically by the auth.users BEFORE INSERT trigger.

revoke all on table public.invitation_codes from anon, authenticated, public;
grant select, update on table public.invitation_codes to service_role;
grant select, update on table public.invitation_codes to supabase_auth_admin;

create or replace function public.enforce_lymphaware_registration_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  registration_mode_value text;
  supplied_invite_code text;
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
    supplied_invite_code := upper(btrim(coalesce(new.raw_user_meta_data ->> 'registration_invite_code', '')));

    select id
      into matching_invite_id
    from public.invitation_codes
    where upper(code) = supplied_invite_code
      and lower(status) = 'unused'
      and used_by is null
    for update
    limit 1;

    if matching_invite_id is null then
      raise exception 'A valid unused LymphAware trial invitation code is required.';
    end if;

    update public.invitation_codes
      set status = 'used',
          used_by = new.id,
          used_at = now()
    where id = matching_invite_id;

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

comment on table public.invitation_codes is
  'Single-use invitation codes that permit account creation while registration_mode is INVITE_ONLY.';
