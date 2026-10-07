alter table public.memberships
  add column if not exists pending_renewal_price_pence integer,
  add column if not exists pending_renewal_price_effective_after timestamptz,
  add column if not exists pending_renewal_price_notice_sent_at timestamptz;

alter table public.memberships
  drop constraint if exists memberships_pending_renewal_price_pence_check;

alter table public.memberships
  add constraint memberships_pending_renewal_price_pence_check
  check (pending_renewal_price_pence is null or pending_renewal_price_pence > 0);
