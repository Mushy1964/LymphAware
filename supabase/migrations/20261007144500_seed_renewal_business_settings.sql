insert into public.system_settings (setting_key, setting_value, updated_at)
values
  ('renewal_standard_1y_pence','1899',now()),
  ('renewal_standard_2y_pence','2599',now()),
  ('renewal_standard_3y_pence','3399',now()),
  ('renewal_plus_1y_pence','1899',now()),
  ('renewal_plus_2y_pence','2599',now()),
  ('renewal_plus_3y_pence','3399',now()),
  ('renewal_multilingual_1y_pence','4099',now()),
  ('renewal_multilingual_2y_pence','5299',now()),
  ('renewal_multilingual_3y_pence','6399',now())
on conflict (setting_key) do nothing;
