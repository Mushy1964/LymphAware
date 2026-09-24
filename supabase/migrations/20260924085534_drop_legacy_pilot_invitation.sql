-- Remove the unused legacy pilot-registration trigger function from the pre-LymphAware ID signup flow.
-- The active registration trigger uses public.enforce_lymphaware_registration_mode().
drop function if exists public.redeem_pilot_invitation();
