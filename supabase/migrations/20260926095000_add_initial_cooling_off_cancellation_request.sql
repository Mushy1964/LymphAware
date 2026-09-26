alter table public.memberships
  add column if not exists initial_cooling_off_cancellation_requested_at timestamptz,
  add column if not exists initial_cooling_off_cancellation_status text,
  add column if not exists initial_cooling_off_cancellation_completed_at timestamptz;
