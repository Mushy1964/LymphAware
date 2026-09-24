create or replace function public.lymphaware_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  registration_mode_value text;
  supplied_trial_code text;
  signup_email text;
  matching_invite_id uuid;
begin
  signup_email := lower(coalesce(event -> 'user' ->> 'email', ''));

  if signup_email = 'admin@lymphawareid.com' then
    return '{}'::jsonb;
  end if;

  select upper(setting_value)
    into registration_mode_value
  from public.system_settings
  where setting_key = 'registration_mode'
  limit 1;

  if registration_mode_value is null then
    return jsonb_build_object(
      'error',
      jsonb_build_object(
        'http_code', 503,
        'message', 'LymphAware ID registration is temporarily unavailable.'
      )
    );
  end if;

  if registration_mode_value = 'OPEN' then
    return '{}'::jsonb;
  end if;

  if registration_mode_value = 'INVITE_ONLY' then
    supplied_trial_code := upper(
      btrim(
        coalesce(
          event -> 'user' -> 'user_metadata' ->> 'registration_invite_code',
          ''
        )
      )
    );

    if supplied_trial_code = '' then
      return jsonb_build_object(
        'error',
        jsonb_build_object(
          'http_code', 403,
          'message', 'A valid LymphAware ID trial code is required.'
        )
      );
    end if;

    select id
      into matching_invite_id
    from public.pilot_invites
    where upper(invite_code) = supplied_trial_code
      and active = true
      and (email is null or lower(email) = signup_email)
    limit 1;

    if matching_invite_id is null then
      return jsonb_build_object(
        'error',
        jsonb_build_object(
          'http_code', 403,
          'message', 'The LymphAware ID trial code is invalid or unavailable.'
        )
      );
    end if;

    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error',
    jsonb_build_object(
      'http_code', 403,
      'message', 'New LymphAware ID account registration is currently closed.'
    )
  );
end;
$function$;
