alter table public.memberships
  add column if not exists latest_renewal_mode text,
  add column if not exists latest_renewal_payment_intent_id text,
  add column if not exists latest_renewal_checkout_session_id text,
  add column if not exists renewal_previous_membership_end timestamptz;

alter table public.memberships
  drop constraint if exists memberships_latest_renewal_mode_check;

alter table public.memberships
  add constraint memberships_latest_renewal_mode_check
  check (latest_renewal_mode is null or latest_renewal_mode in ('AUTO','MANUAL'));
