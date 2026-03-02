-- ═══════════════════════════════════════════
-- SEED — Configuration initiale système
-- ═══════════════════════════════════════════

-- Config système
INSERT INTO system_config (key, value, description) VALUES
('wa_daily_limit',     '20',    'Limite journalière par numéro WhatsApp'),
('wa_min_delay',       '30',    'Délai minimum entre messages (sec)'),
('wa_max_delay',       '120',   'Délai maximum entre messages (sec)'),
('wa_warmup_enabled',  'true',  'Warmup progressif activé'),
('qualification_min_score', '30', 'Score minimum pour qualifier'),
('scraper_enabled',    'true',  'Scrapers automatiques actifs')
ON CONFLICT (key) DO NOTHING;

-- Templates WhatsApp
INSERT INTO message_templates (name, channel, type, body, variables) VALUES
(
    'Premier contact — Commerce',
    'whatsapp', 'first_contact',
    'Bonjour {{contact_name}} 👋

Je suis {{sender_name}}{{#sender_company}}, de {{sender_company}}{{/sender_company}}.

J''ai découvert votre établissement *{{company_name}}* à {{city}} et je pense pouvoir vous aider à développer votre clientèle grâce au marketing digital ciblé.

Est-ce que vous auriez 5 minutes pour en discuter cette semaine ?

Bonne journée 🙏',
    ARRAY['contact_name','sender_name','sender_company','company_name','city']
),
(
    'Premier contact — Restaurant',
    'whatsapp', 'first_contact',
    'Bonjour {{contact_name}} 👋

Je m''appelle {{sender_name}} et j''aide les restaurants à attirer plus de clients via WhatsApp et les réseaux sociaux.

J''ai vu *{{company_name}}* sur Google Maps — belle note ! 🌟

Seriez-vous disponible pour un rapide échange cette semaine ?

Merci 🙏',
    ARRAY['contact_name','sender_name','company_name']
),
(
    'Follow-up 1 — Relance douce',
    'whatsapp', 'followup_1',
    'Bonjour {{contact_name}} 😊

Je reviens vers vous concernant *{{company_name}}*.

Mon message précédent s''est peut-être perdu. Je serais ravi d''échanger 5 minutes sur comment booster votre activité.

Dites-moi si vous êtes disponible 🙏',
    ARRAY['contact_name','company_name']
),
(
    'Follow-up 2 — Valeur + preuve',
    'whatsapp', 'followup_2',
    'Bonjour {{contact_name}},

Une dernière tentative 😊

Nous accompagnons actuellement plusieurs commerces à {{city}} qui ont augmenté leurs ventes de +30% en 3 mois via le digital.

Si vous souhaitez en savoir plus, je suis disponible. Sinon, bonne continuation à *{{company_name}}* 👍',
    ARRAY['contact_name','city','company_name']
),
(
    'Follow-up 3 — Dernier message',
    'whatsapp', 'followup_3',
    'Bonjour {{contact_name}},

Je ne vous importunerai plus après ce message 😊

Si un jour vous souhaitez développer l''activité de *{{company_name}}* en ligne, n''hésitez pas à revenir vers moi.

Très bonne continuation 🙏',
    ARRAY['contact_name','company_name']
)
ON CONFLICT DO NOTHING;

-- Campagne initiale de test
INSERT INTO campaigns (name, description, target_city, channel, daily_limit, min_delay_sec, max_delay_sec)
VALUES (
    'Test — Restaurants Yaoundé',
    'Campagne test initiale',
    'Yaoundé', 'whatsapp', 20, 30, 120
) ON CONFLICT DO NOTHING;

-- Stats du jour
INSERT INTO daily_stats (date) VALUES (CURRENT_DATE) ON CONFLICT (date) DO NOTHING;
