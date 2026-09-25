alter table public.orders
  add column if not exists welcome_envelope_printed_at timestamptz;
