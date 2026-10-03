
with demo as (
  select id as source_profile_id, user_id, updated_at
  from public.profiles
  where is_demo = true
  limit 1
),
demo_languages(id, language_code, language_name, qr_token, translated_content) as (
  values
  (
    '5d1a61e0-acbd-4a2e-96a6-06d2df5981f1'::uuid,
    'FR',
    'French',
    '1babe83a-9ad9-4999-a7c4-658b1400b045'::uuid,
    jsonb_build_object(
      'lymphoedema_type', 'Lymphœdème secondaire',
      'lymphoedema_location', 'Partie inférieure de la jambe gauche et cheville. Le gonflement est généralement le plus visible autour de ma cheville et peut augmenter au cours de la journée.',
      'compression_information', 'Je porte habituellement un vêtement de compression sur la partie inférieure de ma jambe gauche pendant la journée afin d’aider à contrôler le gonflement. Merci de veiller à ne pas l’enrouler, le tordre ou le retirer inutilement, et d’éviter tout ce qui pourrait comprimer fortement la jambe affectée.',
      'treatment_considerations', 'J’ai un lymphœdème qui affecte ma jambe gauche. Merci de tenir compte du gonflement pendant l’examen, le traitement ou l’assistance et d’éviter toute pression ou blessure inutile sur la zone affectée. Si je deviens malade avec une rougeur, une chaleur, une douleur ou un gonflement croissants, veuillez envisager qu’une cellulite infectieuse puisse nécessiter une évaluation médicale rapide.',
      'assistance_needs', 'Le gonflement peut rendre inconfortables la marche, la station debout prolongée ou le fait de rester assis dans un espace étroit. Je peux avoir besoin d’un peu plus de temps pour me déplacer, d’un endroit où m’asseoir ou de plus d’espace autour de ma jambe gauche afin de pouvoir ajuster ma position confortablement.',
      'emergency_contact_relationship', 'Partenaire',
      'additional_statement', 'Le lymphœdème est une affection de longue durée dans laquelle le système lymphatique ne draine pas efficacement les liquides, ce qui provoque un gonflement pouvant varier. Je gère habituellement mon état de manière autonome, mais si je suis malade ou en détresse, ce profil peut aider à expliquer pourquoi je porte une compression et pourquoi je peux avoir besoin de plus de temps, d’espace ou d’attention.'
    )
  ),
  (
    '5d1a61e0-acbd-4a2e-96a6-06d2df5981f2'::uuid,
    'ES',
    'Spanish',
    '1babe83a-9ad9-4999-a7c4-658b1400b046'::uuid,
    jsonb_build_object(
      'lymphoedema_type', 'Linfedema secundario',
      'lymphoedema_location', 'Parte inferior de la pierna izquierda y tobillo. La hinchazón suele ser más visible alrededor del tobillo y puede aumentar a lo largo del día.',
      'compression_information', 'Normalmente llevo una prenda de compresión en la parte inferior de la pierna izquierda durante el día para ayudar a controlar la hinchazón. Procure no enrollarla, retorcerla ni retirarla innecesariamente y evite cualquier cosa que pueda comprimir demasiado la pierna afectada.',
      'treatment_considerations', 'Tengo linfedema en la pierna izquierda. Tenga en cuenta la hinchazón durante cualquier exploración, tratamiento o ayuda y evite presiones o lesiones innecesarias en la zona afectada. Si me encuentro mal con un aumento del enrojecimiento, calor, dolor o hinchazón, considere que una celulitis puede requerir una valoración médica rápida.',
      'assistance_needs', 'La hinchazón puede hacer incómodo caminar, permanecer de pie durante mucho tiempo o sentarme en un espacio reducido. Puedo necesitar un poco más de tiempo para moverme, un lugar donde sentarme o más espacio alrededor de la pierna izquierda para poder cambiar de postura con comodidad.',
      'emergency_contact_relationship', 'Pareja',
      'additional_statement', 'El linfedema es una afección de larga duración en la que el sistema linfático no drena los líquidos de forma eficaz, lo que provoca una hinchazón que puede variar. Normalmente gestiono mi afección de manera independiente, pero si me encuentro mal o angustiado, este perfil puede ayudar a explicar por qué llevo compresión y por qué puedo necesitar más tiempo, espacio o consideración.'
    )
  ),
  (
    '5d1a61e0-acbd-4a2e-96a6-06d2df5981f3'::uuid,
    'DE',
    'German',
    '1babe83a-9ad9-4999-a7c4-658b1400b047'::uuid,
    jsonb_build_object(
      'lymphoedema_type', 'Sekundäres Lymphödem',
      'lymphoedema_location', 'Linker Unterschenkel und Knöchel. Die Schwellung ist normalerweise rund um meinen Knöchel am deutlichsten und kann im Laufe des Tages zunehmen.',
      'compression_information', 'Tagsüber trage ich normalerweise Kompressionskleidung am linken Unterschenkel, um die Schwellung zu kontrollieren. Bitte achten Sie darauf, sie nicht aufzurollen, zu verdrehen oder unnötig zu entfernen, und vermeiden Sie alles, was das betroffene Bein stark einschnüren könnte.',
      'treatment_considerations', 'Ich habe ein Lymphödem am linken Bein. Bitte berücksichtigen Sie die Schwellung bei Untersuchung, Behandlung oder Unterstützung und vermeiden Sie unnötigen Druck oder Verletzungen im betroffenen Bereich. Wenn es mir mit zunehmender Rötung, Wärme, Schmerzen oder Schwellung schlechter geht, sollte bedacht werden, dass eine Cellulitis eine rasche medizinische Beurteilung erfordern kann.',
      'assistance_needs', 'Die Schwellung kann das Gehen, langes Stehen oder Sitzen auf engem Raum unangenehm machen. Ich brauche möglicherweise etwas mehr Zeit, um mich zu bewegen, einen Sitzplatz oder zusätzlichen Raum um mein linkes Bein, damit ich meine Position bequem verändern kann.',
      'emergency_contact_relationship', 'Partner/in',
      'additional_statement', 'Ein Lymphödem ist eine langfristige Erkrankung, bei der das Lymphsystem Flüssigkeit nicht wirksam ableitet und dadurch eine Schwellung entsteht, die unterschiedlich stark sein kann. Normalerweise komme ich selbstständig mit meiner Erkrankung zurecht. Wenn ich mich jedoch unwohl oder belastet fühle, kann dieses Profil erklären, warum ich Kompression trage und warum ich möglicherweise mehr Zeit, Platz oder Rücksicht brauche.'
    )
  )
)
insert into public.language_profiles (
  id, user_id, source_profile_id, language_code, language_name, qr_token,
  setup_status, qr_profile_active, translated_content, card_production_status,
  translation_consent_at, translation_provider, translation_model,
  translation_generated_at, translation_source_updated_at,
  first_ready_notification_status, first_ready_notification_sent_at
)
select
  dl.id, d.user_id, d.source_profile_id, dl.language_code, dl.language_name, dl.qr_token,
  'APPROVED', true, dl.translated_content, 'PRINTED',
  now(), 'manual-demo', 'fixed-demo-2026-10-03',
  now(), d.updated_at,
  'SENT', now()
from demo d
cross join demo_languages dl
on conflict (id) do update set
  language_code = excluded.language_code,
  language_name = excluded.language_name,
  qr_token = excluded.qr_token,
  setup_status = 'APPROVED',
  qr_profile_active = true,
  translated_content = excluded.translated_content,
  card_production_status = 'PRINTED',
  translation_provider = 'manual-demo',
  translation_model = 'fixed-demo-2026-10-03',
  translation_generated_at = excluded.translation_generated_at,
  translation_source_updated_at = excluded.translation_source_updated_at,
  updated_at = now();

comment on column public.language_profiles.translation_provider is
  'Translation provider or fixed source identifier. Demo language profiles use manual-demo.';

