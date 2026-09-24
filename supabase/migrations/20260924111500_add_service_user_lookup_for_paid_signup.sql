create or replace function public.lookup_auth_user_by_email(p_email text)
returns table(user_id uuid, email text, email_confirmed_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select u.id, u.email::text, u.email_confirmed_at
  from auth.users u
  where lower(u.email) = lower(btrim(p_email))
  limit 1;
$$;

revoke all on function public.lookup_auth_user_by_email(text) from public;
revoke all on function public.lookup_auth_user_by_email(text) from anon;
revoke all on function public.lookup_auth_user_by_email(text) from authenticated;
grant execute on function public.lookup_auth_user_by_email(text) to service_role;
