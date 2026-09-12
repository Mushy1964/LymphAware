alter table public.memberships
  add column if not exists auto_renew_requested boolean not null default false,
  add column if not exists subscription_terms_version text,
  add column if not exists precontract_accepted_at timestamptz,
  add column if not exists auto_renew_consent_at timestamptz,
  add column if not exists auto_renew_cancelled_at timestamptz,
  add column if not exists renewal_reminder_first_sent_at timestamptz,
  add column if not exists renewal_reminder_final_sent_at timestamptz,
  add column if not exists latest_renewal_paid_at timestamptz,
  add column if not exists renewal_cooling_off_ends_at timestamptz,
  add column if not exists renewal_cooling_notice_sent_at timestamptz,
  add column if not exists cooling_off_cancellation_requested_at timestamptz;

create index if not exists memberships_auto_renewal_reminder_idx
  on public.memberships (next_renewal_at)
  where membership_status = 'ACTIVE'
    and payment_status = 'PAID'
    and auto_renew_enabled = true;

create table if not exists public.membership_contract_events (
  id bigint generated always as identity primary key,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in (
    'PRECONTRACT_ACCEPTED',
    'AUTO_RENEW_CONSENT',
    'RENEWAL_REMINDER_FIRST',
    'RENEWAL_REMINDER_FINAL',
    'RENEWAL_COOLING_NOTICE',
    'AUTO_RENEW_CANCELLED',
    'RENEWAL_COOLING_CANCELLATION_REQUESTED'
  )),
  version text not null,
  details jsonb not null default '{}'::jsonb,
  stripe_reference text,
  created_at timestamptz not null default now()
);

create index if not exists membership_contract_events_membership_created_idx
  on public.membership_contract_events (membership_id, created_at desc);

create index if not exists membership_contract_events_user_id_idx
  on public.membership_contract_events (user_id);

create unique index if not exists membership_contract_events_stripe_type_key
  on public.membership_contract_events (stripe_reference, event_type)
  where stripe_reference is not null;

alter table public.membership_contract_events enable row level security;

drop policy if exists "Members can read their own contract events" on public.membership_contract_events;
create policy "Members can read their own contract events"
  on public.membership_contract_events
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.membership_contract_events from anon;
grant select on table public.membership_contract_events to authenticated;
grant all on table public.membership_contract_events to service_role;
grant usage, select on sequence public.membership_contract_events_id_seq to service_role;

comment on table public.membership_contract_events is
  'Durable audit trail of membership pre-contract information, automatic-renewal consent, reminders and cancellations.';
