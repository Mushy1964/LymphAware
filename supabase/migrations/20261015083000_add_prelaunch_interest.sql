-- Separate pre-launch interest capture: no member/profile relationships or public database access.
create table if not exists public.prelaunch_interest_config (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.prelaunch_interest_config(id, enabled) values (true, false)
on conflict (id) do nothing;
create table if not exists public.prelaunch_interest (
  id uuid primary key default gen_random_uuid(),
  first_name text not null default '' check (char_length(first_name) <= 80),
  email text not null unique check (char_length(email) <= 254),
  interest_level text not null default '' check (interest_level in ('','yes','possibly','unsure')),
  suggestion text not null default '' check (char_length(suggestion) <= 1200),
  source text not null default 'website' check (source in ('website','forum','social','other')),
  consent_at timestamptz not null default now(),
  consent_version text not null default 'prelaunch-email-v1',
  confirmation_hash text unique,
  confirmation_expires_at timestamptz,
  confirmed_at timestamptz,
  unsubscribe_hash text unique not null,
  unsubscribed_at timestamptz,
  review_status text not null default 'new' check (review_status in ('new','reviewed','follow_up','archived')),
  admin_notes text not null default '' check (char_length(admin_notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists prelaunch_interest_created_idx on public.prelaunch_interest(created_at desc);
create index if not exists prelaunch_interest_confirmed_idx on public.prelaunch_interest(confirmed_at) where confirmed_at is not null;
alter table public.prelaunch_interest enable row level security;
alter table public.prelaunch_interest_config enable row level security;
revoke all on table public.prelaunch_interest from public, anon, authenticated;
revoke all on table public.prelaunch_interest_config from public, anon, authenticated;
grant select, insert, update, delete on table public.prelaunch_interest to service_role;
grant select, insert, update on table public.prelaunch_interest_config to service_role;
comment on table public.prelaunch_interest is 'Standalone pre-launch marketing consent and non-medical feedback. Service-only access. Do not join to patient profiles.';
