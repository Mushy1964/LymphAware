-- The public-profile Edge Function uses the server-only service role to verify
-- health-data consent and the current emergency-contact privacy notice.
-- Without SELECT on the append-only privacy event log, both verification RPCs
-- fail closed and every non-demo public QR profile appears unavailable.
grant select on table public.profile_privacy_events to service_role;
