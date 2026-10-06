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
      and (m.membership_end is null or m.membership_end > now())
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
      and (m.membership_end is null or m.membership_end > now())
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
      and (m.membership_end is null or m.membership_end > now())
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
      and (m.membership_end is null or m.membership_end > now())
  )
);

alter policy "Members can view own language profiles"
on public.language_profiles
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
      and (m.membership_end is null or m.membership_end > now())
  )
);
