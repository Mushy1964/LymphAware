alter table public.memberships
  add column if not exists initial_cooling_off_refund_type text,
  add column if not exists initial_cooling_off_refund_amount_pence integer,
  add column if not exists initial_cooling_off_refund_reference text,
  add column if not exists initial_cooling_off_admin_note text,
  add column if not exists initial_cooling_off_completed_by text;
