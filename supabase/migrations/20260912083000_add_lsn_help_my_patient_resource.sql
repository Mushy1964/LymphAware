insert into public.information_resources
  (slug, organisation, title, description, url, category, language_code, active, sort_order)
values
  (
    'lsn-help-my-patient',
    'Lymphoedema Support Network',
    'What can I do to help my patient?',
    'Practical information for healthcare professionals about referral, treatment and supporting patients with lymphoedema.',
    'https://www.lymphoedema.org/healthcare-professionals/what-can-i-do-to-help-my-patient/',
    'PROFESSIONAL',
    'EN',
    true,
    50
  )
on conflict (slug) do update set
  organisation = excluded.organisation,
  title = excluded.title,
  description = excluded.description,
  url = excluded.url,
  category = excluded.category,
  language_code = excluded.language_code,
  active = excluded.active,
  sort_order = excluded.sort_order,
  updated_at = now();
