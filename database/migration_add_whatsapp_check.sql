-- ═══════════════════════════════════════════════════════════
-- Migration: Ajout colonne has_whatsapp + index
-- ═══════════════════════════════════════════════════════════

-- 1. Ajouter la colonne has_whatsapp
ALTER TABLE companies 
ADD COLUMN IF NOT EXISTS has_whatsapp BOOLEAN DEFAULT NULL;

-- 2. Index pour filtrage rapide
CREATE INDEX IF NOT EXISTS idx_companies_has_whatsapp 
ON companies(has_whatsapp) 
WHERE has_whatsapp IS NOT NULL;

-- 3. Index combiné pour les requêtes filtrées
CREATE INDEX IF NOT EXISTS idx_companies_status_has_whatsapp 
ON companies(status, has_whatsapp) 
WHERE has_whatsapp IS NOT NULL;

-- 4. Mettre à jour la vue vw_leads_ready_to_contact
DROP VIEW IF EXISTS vw_leads_ready_to_contact;
CREATE OR REPLACE VIEW vw_leads_ready_to_contact AS
SELECT c.id, c.name, c.category, c.city, c.phone_whatsapp, c.has_whatsapp,
       c.score, c.status, c.followup_count,
       c.last_contacted_at, c.next_followup_at, c.campaign_id
FROM companies c
WHERE c.status IN ('qualified','contacted')
  AND c.phone_whatsapp IS NOT NULL
  AND c.has_whatsapp = true
  AND (c.last_contacted_at IS NULL OR c.next_followup_at <= NOW())
ORDER BY c.score DESC, c.next_followup_at ASC NULLS FIRST;

-- 5. Mettre à jour la vue dashboard
DROP VIEW IF EXISTS vw_dashboard_stats;
CREATE OR REPLACE VIEW vw_dashboard_stats AS
SELECT
    (SELECT COUNT(*) FROM companies)                                  AS total_companies,
    (SELECT COUNT(*) FROM companies WHERE status='new')               AS new_leads,
    (SELECT COUNT(*) FROM companies WHERE status='qualified')         AS qualified_leads,
    (SELECT COUNT(*) FROM companies WHERE status='contacted')         AS contacted_leads,
    (SELECT COUNT(*) FROM companies WHERE status='replied')           AS replied_leads,
    (SELECT COUNT(*) FROM companies WHERE status='converted')         AS converted_leads,
    (SELECT COUNT(*) FROM companies WHERE phone_whatsapp IS NOT NULL) AS leads_with_wa,
    (SELECT COUNT(*) FROM companies WHERE has_whatsapp = true)        AS leads_whatsapp_verified,
    (SELECT COUNT(*) FROM companies WHERE has_whatsapp = false)       AS leads_whatsapp_invalid,
    (SELECT COUNT(*) FROM messages  WHERE DATE(created_at)=CURRENT_DATE) AS messages_today,
    (SELECT COUNT(*) FROM messages  WHERE status='sent' AND DATE(sent_at)=CURRENT_DATE) AS sent_today,
    (SELECT COUNT(*) FROM messages  WHERE status='replied' AND DATE(replied_at)=CURRENT_DATE) AS replies_today;

-- 6. Table pour stocker les vérifications WhatsApp en cours
CREATE TABLE IF NOT EXISTS whatsapp_verification_queue (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id      UUID REFERENCES companies(id) ON DELETE CASCADE,
    phone_number    VARCHAR(50) NOT NULL,
    status          VARCHAR(50) DEFAULT 'pending',
    checked_at      TIMESTAMPTZ,
    result          BOOLEAN,
    error_message   TEXT,
    retry_count     INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_verif_status ON whatsapp_verification_queue(status);
CREATE INDEX IF NOT EXISTS idx_wa_verif_company ON whatsapp_verification_queue(company_id);

SELECT 'Migration has_whatsapp terminée' AS status;
