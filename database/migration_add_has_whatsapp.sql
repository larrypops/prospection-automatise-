-- ═══════════════════════════════════════════════════════════
-- MIGRATION: Ajout colonne has_whatsapp + trigger vérification
-- ═══════════════════════════════════════════════════════════

-- 1. Vider la table companies
TRUNCATE TABLE companies CASCADE;

-- 2. Ajouter la colonne has_whatsapp (BOOLEAN)
ALTER TABLE companies 
ADD COLUMN IF NOT EXISTS has_whatsapp BOOLEAN DEFAULT NULL;

-- 3. Créer index pour optimiser les requêtes
CREATE INDEX IF NOT EXISTS idx_companies_has_whatsapp ON companies(has_whatsapp) WHERE has_whatsapp IS NOT NULL;

-- 4. Fonction pour vérifier WhatsApp via WAHA API (appelée par le backend)
-- Cette fonction sera appelée par le backend Node.js
CREATE OR REPLACE FUNCTION notify_new_company()
RETURNS TRIGGER AS $$
BEGIN
    -- Notifier le backend qu'une nouvelle entreprise a été ajoutée
    -- Le backend écoutera cette notification et vérifiera WhatsApp
    PERFORM pg_notify('new_company', json_build_object(
        'id', NEW.id,
        'phone', NEW.phone,
        'phone_whatsapp', NEW.phone_whatsapp
    )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Trigger qui se déclenche après insertion
DROP TRIGGER IF EXISTS trg_new_company_notify ON companies;
CREATE TRIGGER trg_new_company_notify
    AFTER INSERT ON companies
    FOR EACH ROW
    EXECUTE FUNCTION notify_new_company();

-- 6. Commentaire sur la colonne
COMMENT ON COLUMN companies.has_whatsapp IS 'Indique si le numéro a WhatsApp (true/false/null si non vérifié)';

-- Message de confirmation
SELECT 'Migration terminée: colonne has_whatsapp ajoutée, table vidée, trigger créé' as status;
