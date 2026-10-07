alter table public.profiles
  add column if not exists profile_last_reviewed_at timestamptz,
  add column if not exists profile_next_review_due_at timestamptz not null default (now() + interval '6 months'),
  add column if not exists profile_review_reminder_sent_at timestamptz,
  add column if not exists profile_review_followup_sent_at timestamptz;

update public.profiles
set profile_next_review_due_at = created_at + interval '6 months'
where profile_last_reviewed_at is null
  and profile_review_reminder_sent_at is null
  and profile_review_followup_sent_at is null;

create index if not exists profiles_profile_review_due_idx
  on public.profiles (profile_next_review_due_at)
  where is_demo = false and is_archived = false;

create table if not exists public.profile_review_events (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reviewed_at timestamptz not null default now(),
  source text not null default 'PORTAL_CONFIRMATION',
  created_at timestamptz not null default now()
);

create index if not exists profile_review_events_user_reviewed_idx
  on public.profile_review_events (user_id, reviewed_at desc);

alter table public.profile_review_events enable row level security;

revoke all on table public.profile_review_events from anon, authenticated;
grant select on table public.profile_review_events to authenticated;
grant all on table public.profile_review_events to service_role;
grant usage, select on sequence public.profile_review_events_id_seq to service_role;

drop policy if exists "Members can read own profile review events" on public.profile_review_events;
create policy "Members can read own profile review events"
  on public.profile_review_events
  for select
  to authenticated
  using ((select auth.uid()) = user_id);
