alter table public.orders
  drop constraint orders_order_status_check;

alter table public.orders
  add constraint orders_order_status_check
  check (
    order_status = any (
      array[
        'PAYMENT_PENDING'::text,
        'PAID_AWAITING_PROFILE'::text,
        'ADDRESS_REVIEW_REQUIRED'::text,
        'READY_TO_PRINT'::text,
        'IN_PRODUCTION'::text,
        'PRINTED'::text,
        'COMPLETED'::text,
        'CANCELLED'::text,
        'REFUNDED'::text
      ]
    )
  );
