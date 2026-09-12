alter table public.memberships
  add column if not exists package_type text,
  add column if not exists membership_term_years integer,
  add column if not exists auto_renew_enabled boolean not null default false,
  add column if not exists renewal_price_pence integer,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_subscription_item_id text,
  add column if not exists stripe_subscription_status text,
  add column if not exists next_renewal_at timestamptz;

alter table public.memberships
  drop constraint if exists memberships_package_type_check,
  add constraint memberships_package_type_check
    check (package_type is null or package_type in ('STANDARD', 'PLUS', 'MULTILINGUAL')),
  drop constraint if exists memberships_membership_term_years_check,
  add constraint memberships_membership_term_years_check
    check (membership_term_years is null or membership_term_years in (1, 2, 3, 5)),
  drop constraint if exists memberships_renewal_price_pence_check,
  add constraint memberships_renewal_price_pence_check
    check (renewal_price_pence is null or renewal_price_pence >= 0);

create unique index if not exists memberships_stripe_subscription_id_key
  on public.memberships (stripe_subscription_id)
  where stripe_subscription_id is not null;
