begin;

alter table public.profiles
  add column if not exists is_archived boolean not null default false,
  add column if not exists archived_at timestamp with time zone,
  add column if not exists archive_reason text;

comment on column public.profiles.is_archived is
  'True when a legacy or test profile is retained for audit purposes but removed from normal operational use.';
comment on column public.profiles.archived_at is
  'The time at which the retained profile was archived.';
comment on column public.profiles.archive_reason is
  'A short administrative reason for archiving the retained profile.';

create index if not exists profiles_is_archived_idx
  on public.profiles (is_archived);

update public.profiles
set is_archived = true,
    archived_at = coalesce(archived_at, now()),
    archive_reason = 'Legacy test record archived during September 2026 housekeeping',
    qr_profile_active = false,
    updated_at = now()
where lymphaware_id in (
  'LA-TEST-002',
  'LA-000001',
  'LA-000002',
  'LA-000008',
  'LA-000009'
);

update public.language_profiles
set qr_profile_active = false,
    updated_at = now()
where source_profile_id in (
  select id
  from public.profiles
  where is_archived = true
);

commit;
