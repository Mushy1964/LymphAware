-- Add default scroll speed for the public announcement ticker.
insert into public.system_settings(setting_key,setting_value,updated_at)
values('announcement_scroll_speed','55',now())
on conflict(setting_key) do nothing;
