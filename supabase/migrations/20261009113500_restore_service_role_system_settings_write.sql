-- Restore the write privileges required by protected Netlify Admin functions
-- to update public.system_settings. Direct browser roles remain governed by RLS
-- and do not receive these write privileges.
grant insert, update on table public.system_settings to service_role;
