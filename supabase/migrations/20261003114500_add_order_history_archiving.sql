alter table public.orders
  add column if not exists is_archived boolean not null default false,
  add column if not exists archived_at timestamp with time zone,
  add column if not exists archive_reason text,
  add column if not exists archived_by text;

create index if not exists orders_admin_archive_created_idx
  on public.orders (is_archived, created_at desc);

comment on column public.orders.is_archived is
  'True when a terminal order is retained in Archived Orders and removed from the normal completed-order list.';
comment on column public.orders.archived_at is
  'Timestamp when an administrator archived the terminal order.';
comment on column public.orders.archive_reason is
  'Administrative reason for moving the terminal order into Archived Orders.';
comment on column public.orders.archived_by is
  'Administrator identifier recorded when the order was archived.';
