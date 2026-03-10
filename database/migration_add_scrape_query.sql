-- ═══════════════════════════════════════════════════════════
-- MIGRATION: Ajout colonne scrape_query pour tracking des mots-clés
-- ═══════════════════════════════════════════════════════════

ALTER TABLE companies ADD COLUMN IF NOT EXISTS scrape_query VARCHAR(500);

CREATE INDEX IF NOT EXISTS idx_companies_scrape_query ON companies(scrape_query);
CREATE INDEX IF NOT EXISTS idx_companies_scrape_query_trgm ON companies USING gin(scrape_query gin_trgm_ops);