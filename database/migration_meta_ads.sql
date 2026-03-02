-- ═══════════════════════════════════════════════════════════
-- Migration: Ajout source 'meta_ads' dans l'enum scrape_source
-- À exécuter UNE FOIS sur pg-db-1
-- Commande: docker exec pg-db-1 psql -U prospection_user -d prospection -f /tmp/migration_meta_ads.sql
-- ═══════════════════════════════════════════════════════════

-- Ajouter 'meta_ads' à l'enum si pas déjà présent
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'meta_ads'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'scrape_source')
    ) THEN
        ALTER TYPE scrape_source ADD VALUE 'meta_ads';
        RAISE NOTICE 'Valeur meta_ads ajoutée à scrape_source';
    ELSE
        RAISE NOTICE 'meta_ads existe déjà dans scrape_source, rien à faire';
    END IF;
END $$;

-- Vérifier le résultat
SELECT enumlabel FROM pg_enum
WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'scrape_source')
ORDER BY enumsortorder;