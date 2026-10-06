alter table public.membership_contract_events
  drop constraint if exists membership_contract_events_event_type_check;

alter table public.membership_contract_events
  add constraint membership_contract_events_event_type_check
  check (event_type in (
    'PRECONTRACT_ACCEPTED',
    'AUTO_RENEW_CONSENT',
    'RENEWAL_REMINDER_FIRST',
    'RENEWAL_REMINDER_FINAL',
    'EXPIRY_REMINDER_FIRST',
    'EXPIRY_REMINDER_FINAL',
    'RENEWAL_COOLING_NOTICE',
    'AUTO_RENEW_CANCELLED',
    'RENEWAL_COOLING_CANCELLATION_REQUESTED',
    'MANUAL_RENEWAL_CHECKOUT_STARTED',
    'MANUAL_RENEWAL_PAID'
  ));
