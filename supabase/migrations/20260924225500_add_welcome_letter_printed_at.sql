alter table public.orders
  add column if not exists welcome_letter_printed_at timestamptz;
