create table if not exists public.discount_code_controls (
  code text primary key,
  code_type text not null check (code_type in ('PUBLIC','TRIAL')),
  enabled boolean not null default false,
  valid_from timestamp with time zone,
  valid_until timestamp with time zone,
  stripe_promotion_code_id text unique,
  created_via_admin boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint discount_code_controls_code_format check (code = upper(code) and code ~ '^[A-Z0-9-]+$'),
  constraint discount_code_controls_valid_window check (valid_until is null or valid_from is null or valid_until > valid_from)
);

alter table public.discount_code_controls enable row level security;

comment on table public.discount_code_controls is
  'Admin-managed website availability windows for LymphAware ID trial and public Stripe promotion codes. No client-side access is permitted; Netlify functions use the service role.';

insert into public.discount_code_controls (code, code_type, enabled, created_via_admin)
values
  ('LYMPHAWAREIDTRIAL', 'TRIAL', true, false),
  ('WELCOME10', 'PUBLIC', false, false)
on conflict (code) do nothing;
