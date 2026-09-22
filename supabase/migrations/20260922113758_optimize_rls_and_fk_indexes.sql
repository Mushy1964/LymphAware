create index if not exists language_profiles_order_id_idx
  on public.language_profiles (order_id);

create index if not exists language_profiles_source_profile_id_idx
  on public.language_profiles (source_profile_id);

create index if not exists orders_membership_id_idx
  on public.orders (membership_id);

create index if not exists profile_assistance_option_id_idx
  on public.profile_assistance (option_id);

alter policy "Members can read own membership"
on public.memberships
using ((select auth.uid()) = user_id);

alter policy "Members can view own language profiles"
on public.language_profiles
using ((select auth.uid()) = user_id);

alter policy "Users can view their own orders"
on public.orders
using ((select auth.uid()) = user_id);

alter policy "Users can view their own order items"
on public.order_items
using (
  exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and o.user_id = (select auth.uid())
  )
);

alter policy "Members can view own privacy events"
on public.profile_privacy_events
using ((select auth.uid()) = user_id);

alter policy "Entitled users can view their own profile"
on public.profiles
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.memberships m
    where m.user_id = (select auth.uid())
      and (
        (m.membership_status = 'ACTIVE' and m.payment_status = 'PAID')
        or m.membership_status in ('PILOT','SPONSORED')
      )
  )
);

alter policy "Entitled users can update their own profile"
on public.profiles
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.memberships m
    where m.user_id = (select auth.uid())
      and (
        (m.membership_status = 'ACTIVE' and m.payment_status = 'PAID')
        or m.membership_status in ('PILOT','SPONSORED')
      )
  )
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.memberships m
    where m.user_id = (select auth.uid())
      and (
        (m.membership_status = 'ACTIVE' and m.payment_status = 'PAID')
        or m.membership_status in ('PILOT','SPONSORED')
      )
  )
);

alter policy "Entitled users can create their own profile"
on public.profiles
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.memberships m
    where m.user_id = (select auth.uid())
      and (
        (m.membership_status = 'ACTIVE' and m.payment_status = 'PAID')
        or m.membership_status in ('PILOT','SPONSORED')
      )
  )
);
