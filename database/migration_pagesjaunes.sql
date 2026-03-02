-- Migration: Ajout source 'pagesjaunes_cm' dans l'enum scrape_source
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'pagesjaunes_cm'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'scrape_source')
    ) THEN
        ALTER TYPE scrape_source ADD VALUE 'pagesjaunes_cm';
        RAISE NOTICE 'pagesjaunes_cm ajouté à scrape_source';
    ELSE
        RAISE NOTICE 'pagesjaunes_cm existe déjà';
    END IF;
END $$;

SELECT enumlabel FROM pg_enum
WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'scrape_source')
ORDER BY enumsortorder;