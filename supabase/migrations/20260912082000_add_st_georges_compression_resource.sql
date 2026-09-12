insert into public.information_resources
  (slug, organisation, title, description, url, category, language_code, active, sort_order)
values
  (
    'st-georges-compression-garments',
    'St George''s University Hospitals NHS Foundation Trust',
    'Lymphoedema compression garments',
    'Practical NHS guidance on how to put on, remove and care for compression garments.',
    'https://www.stgeorges.nhs.uk/wp-content/uploads/2025/07/DER_LGAR.pdf',
    'COMPRESSION',
    'EN',
    true,
    40
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
