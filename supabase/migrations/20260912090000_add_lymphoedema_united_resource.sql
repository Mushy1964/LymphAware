insert into public.information_resources
  (slug, organisation, title, description, url, category, language_code, active, sort_order)
values
  (
    'lymphoedema-united-what-is-lymphoedema',
    'Lymphoedema United',
    'What is lymphoedema?',
    'Information about primary and secondary lymphoedema, including causes, diagnosis and management.',
    'https://lymphoedemaunited.com/information/what-is-lymphoedema/',
    'UNDERSTANDING_LYMPHOEDEMA',
    'EN',
    true,
    60
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
