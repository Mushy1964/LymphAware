create or replace function public.registration_email_exists(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users
    where email = lower(btrim(p_email))
  );
$$;

revoke all on function public.registration_email_exists(text) from public;
revoke all on function public.registration_email_exists(text) from anon;
revoke all on function public.registration_email_exists(text) from authenticated;
grant execute on function public.registration_email_exists(text) to service_role;

comment on function public.registration_email_exists(text)
is 'Server-only duplicate email check used before the LymphAware registration review stage.';
