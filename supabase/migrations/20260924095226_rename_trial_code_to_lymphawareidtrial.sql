insert into public.pilot_invites (invite_code, email, active, used_at)
values ('LYMPHAWAREIDTRIAL', null, true, null)
on conflict (invite_code)
do update set email = null, active = true, used_at = null;

update public.pilot_invites
set active = false
where upper(invite_code) <> 'LYMPHAWAREIDTRIAL'
  and active = true;

comment on table public.pilot_invites is
  'Trial access codes used while registration_mode is INVITE_ONLY. The active shared LymphAware ID code is also applied automatically as the Stripe trial promotion code.';
