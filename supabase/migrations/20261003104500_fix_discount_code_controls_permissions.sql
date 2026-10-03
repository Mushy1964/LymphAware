revoke all on table public.discount_code_controls from anon, authenticated;

grant select, insert, update on table public.discount_code_controls to service_role;

comment on table public.discount_code_controls is
  'Admin-managed website availability windows for LymphAware ID trial and public Stripe promotion codes. Direct anon/authenticated access is revoked; Netlify admin functions use the service role.';
