-- ═══════════════════════════════════════════════════════════
-- PROSPECTION SYSTEM — Schema PostgreSQL CRM
-- Appliqué sur pg-db-1 dans la base 'prospection'
-- ═══════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- ── Types ENUM ───────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE lead_status AS ENUM (
        'new','enriched','qualified','contacted','replied',
        'interested','meeting_scheduled','converted',
        'not_interested','unsubscribed','invalid','archived'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE contact_channel AS ENUM ('whatsapp','email','sms','call','linkedin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE message_status AS ENUM (
        'pending','queued','sent','delivered','read','replied','failed','blocked'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE scrape_source AS ENUM (
        'google_maps','facebook','website','annuaire','linkedin','manual'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE followup_type AS ENUM (
        'first_contact','followup_1','followup_2','followup_3','reactivation'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── companies ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    name_normalized VARCHAR(255),
    category        VARCHAR(100),
    sub_category    VARCHAR(100),
    description     TEXT,
    phone           VARCHAR(50),
    phone_whatsapp  VARCHAR(50),
    phone_verified  BOOLEAN DEFAULT false,
    email           VARCHAR(255),
    website         VARCHAR(500),
    address         TEXT,
    city            VARCHAR(100),
    region          VARCHAR(100),
    country         VARCHAR(100) DEFAULT 'Cameroun',
    latitude        DECIMAL(10,8),
    longitude       DECIMAL(11,8),
    source          scrape_source NOT NULL DEFAULT 'manual',
    source_url      TEXT,
    google_place_id VARCHAR(255) UNIQUE,
    facebook_page_id VARCHAR(255),
    status          lead_status NOT NULL DEFAULT 'new',
    score           INTEGER DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
    priority        SMALLINT DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
    rating          DECIMAL(3,2),
    reviews_count   INTEGER DEFAULT 0,
    last_contacted_at   TIMESTAMPTZ,
    last_replied_at     TIMESTAMPTZ,
    next_followup_at    TIMESTAMPTZ,
    followup_count      INTEGER DEFAULT 0,
    assigned_wa_number  VARCHAR(50),
    campaign_id         UUID,
    tags            TEXT[] DEFAULT '{}',
    notes           TEXT,
    custom_fields   JSONB DEFAULT '{}',
    scraped_at      TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── campaigns ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaigns (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    target_category VARCHAR(100),
    target_city     VARCHAR(100),
    target_region   VARCHAR(100),
    channel         contact_channel DEFAULT 'whatsapp',
    template_id     UUID,
    daily_limit     INTEGER DEFAULT 20,
    min_delay_sec   INTEGER DEFAULT 30,
    max_delay_sec   INTEGER DEFAULT 120,
    total_leads     INTEGER DEFAULT 0,
    sent_count      INTEGER DEFAULT 0,
    delivered_count INTEGER DEFAULT 0,
    read_count      INTEGER DEFAULT 0,
    replied_count   INTEGER DEFAULT 0,
    converted_count INTEGER DEFAULT 0,
    is_active       BOOLEAN DEFAULT true,
    started_at      TIMESTAMPTZ,
    ended_at        TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── message_templates ────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_templates (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(255) NOT NULL,
    channel     contact_channel DEFAULT 'whatsapp',
    type        followup_type DEFAULT 'first_contact',
    subject     VARCHAR(500),
    body        TEXT NOT NULL,
    variables   TEXT[] DEFAULT '{}',
    is_active   BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── messages ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id      UUID REFERENCES companies(id) ON DELETE CASCADE,
    campaign_id     UUID REFERENCES campaigns(id),
    template_id     UUID REFERENCES message_templates(id),
    channel         contact_channel NOT NULL DEFAULT 'whatsapp',
    from_number     VARCHAR(50),
    to_number       VARCHAR(50),
    body            TEXT NOT NULL,
    type            followup_type DEFAULT 'first_contact',
    status          message_status DEFAULT 'pending',
    waha_message_id VARCHAR(255),
    error_message   TEXT,
    retry_count     INTEGER DEFAULT 0,
    queued_at       TIMESTAMPTZ,
    sent_at         TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ,
    read_at         TIMESTAMPTZ,
    replied_at      TIMESTAMPTZ,
    failed_at       TIMESTAMPTZ,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── whatsapp_numbers ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_numbers (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    number          VARCHAR(50) UNIQUE NOT NULL,
    session_name    VARCHAR(100) UNIQUE NOT NULL,
    is_active       BOOLEAN DEFAULT false,
    is_banned       BOOLEAN DEFAULT false,
    last_status     VARCHAR(50),
    daily_sent      INTEGER DEFAULT 0,
    daily_limit     INTEGER DEFAULT 20,
    total_sent      INTEGER DEFAULT 0,
    last_sent_at    TIMESTAMPTZ,
    daily_reset_at  DATE DEFAULT CURRENT_DATE,
    warmup_day      INTEGER DEFAULT 1,
    warmup_limit    INTEGER DEFAULT 20,
    campaign_ids    UUID[] DEFAULT '{}',
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── scrape_jobs ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scrape_jobs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source          scrape_source NOT NULL,
    query           VARCHAR(500),
    location        VARCHAR(255),
    params          JSONB DEFAULT '{}',
    status          VARCHAR(50) DEFAULT 'pending',
    leads_found     INTEGER DEFAULT 0,
    leads_new       INTEGER DEFAULT 0,
    leads_updated   INTEGER DEFAULT 0,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    duration_sec    INTEGER,
    error_message   TEXT,
    n8n_execution_id VARCHAR(255),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── daily_stats ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_stats (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date                DATE UNIQUE NOT NULL DEFAULT CURRENT_DATE,
    leads_scraped       INTEGER DEFAULT 0,
    leads_qualified     INTEGER DEFAULT 0,
    messages_sent       INTEGER DEFAULT 0,
    messages_delivered  INTEGER DEFAULT 0,
    messages_read       INTEGER DEFAULT 0,
    messages_replied    INTEGER DEFAULT 0,
    messages_failed     INTEGER DEFAULT 0,
    meetings_scheduled  INTEGER DEFAULT 0,
    conversions         INTEGER DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── system_config ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_config (
    key         VARCHAR(255) PRIMARY KEY,
    value       JSONB NOT NULL,
    description TEXT,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Index ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_companies_status        ON companies(status);
CREATE INDEX IF NOT EXISTS idx_companies_source        ON companies(source);
CREATE INDEX IF NOT EXISTS idx_companies_city          ON companies(city);
CREATE INDEX IF NOT EXISTS idx_companies_category      ON companies(category);
CREATE INDEX IF NOT EXISTS idx_companies_phone_wa      ON companies(phone_whatsapp) WHERE phone_whatsapp IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_companies_next_followup ON companies(next_followup_at) WHERE next_followup_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_companies_score         ON companies(score DESC);
CREATE INDEX IF NOT EXISTS idx_companies_campaign      ON companies(campaign_id);
CREATE INDEX IF NOT EXISTS idx_companies_name_trgm     ON companies USING gin(name_normalized gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_messages_company        ON messages(company_id);
CREATE INDEX IF NOT EXISTS idx_messages_status         ON messages(status);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at        ON messages(sent_at);
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_status      ON scrape_jobs(status);
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_created     ON scrape_jobs(created_at DESC);

-- ── Rendre unaccent immutable pour les index ─────────────
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text AS $$
    SELECT unaccent($1);
$$ LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE;

-- ── Trigger name_normalized ──────────────────────────────
CREATE OR REPLACE FUNCTION sync_name_normalized()
RETURNS TRIGGER AS $$
BEGIN
    NEW.name_normalized := lower(immutable_unaccent(NEW.name));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_companies_name_normalized ON companies;
CREATE TRIGGER trg_companies_name_normalized
    BEFORE INSERT OR UPDATE OF name ON companies
    FOR EACH ROW EXECUTE FUNCTION sync_name_normalized();

-- ── Triggers updated_at ──────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_companies_updated_at  ON companies;
DROP TRIGGER IF EXISTS trg_messages_updated_at   ON messages;
DROP TRIGGER IF EXISTS trg_campaigns_updated_at  ON campaigns;
DROP TRIGGER IF EXISTS trg_wa_numbers_updated_at ON whatsapp_numbers;

CREATE TRIGGER trg_companies_updated_at  BEFORE UPDATE ON companies  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_messages_updated_at   BEFORE UPDATE ON messages   FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_campaigns_updated_at  BEFORE UPDATE ON campaigns  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_wa_numbers_updated_at BEFORE UPDATE ON whatsapp_numbers FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Trigger reset compteur WA quotidien ──────────────────
CREATE OR REPLACE FUNCTION reset_daily_wa_counter()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.daily_reset_at < CURRENT_DATE THEN
        NEW.daily_sent     := 0;
        NEW.daily_reset_at := CURRENT_DATE;
        -- Warmup progressif
        NEW.daily_limit := CASE
            WHEN NEW.warmup_day >= 31 THEN 300
            WHEN NEW.warmup_day >= 22 THEN 150
            WHEN NEW.warmup_day >= 15 THEN 80
            WHEN NEW.warmup_day >= 8  THEN 40
            ELSE 20
        END;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reset_daily_wa ON whatsapp_numbers;
CREATE TRIGGER trg_reset_daily_wa
    BEFORE UPDATE ON whatsapp_numbers
    FOR EACH ROW EXECUTE FUNCTION reset_daily_wa_counter();

-- ── Trigger stats journalières ───────────────────────────
CREATE OR REPLACE FUNCTION update_daily_stats_on_message()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO daily_stats (date) VALUES (CURRENT_DATE) ON CONFLICT (date) DO NOTHING;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.status = 'sent'      AND OLD.status != 'sent'      THEN UPDATE daily_stats SET messages_sent      = messages_sent      + 1, updated_at=NOW() WHERE date=CURRENT_DATE; END IF;
        IF NEW.status = 'delivered' AND OLD.status != 'delivered'  THEN UPDATE daily_stats SET messages_delivered = messages_delivered + 1, updated_at=NOW() WHERE date=CURRENT_DATE; END IF;
        IF NEW.status = 'read'      AND OLD.status != 'read'       THEN UPDATE daily_stats SET messages_read      = messages_read      + 1, updated_at=NOW() WHERE date=CURRENT_DATE; END IF;
        IF NEW.status = 'replied'   AND OLD.status != 'replied'    THEN UPDATE daily_stats SET messages_replied   = messages_replied   + 1, updated_at=NOW() WHERE date=CURRENT_DATE; END IF;
        IF NEW.status = 'failed'    AND OLD.status != 'failed'     THEN UPDATE daily_stats SET messages_failed    = messages_failed    + 1, updated_at=NOW() WHERE date=CURRENT_DATE; END IF;
    ELSIF TG_OP = 'INSERT' AND NEW.status = 'sent' THEN
        UPDATE daily_stats SET messages_sent = messages_sent + 1, updated_at=NOW() WHERE date=CURRENT_DATE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_daily_stats ON messages;
CREATE TRIGGER trg_update_daily_stats
    AFTER INSERT OR UPDATE ON messages
    FOR EACH ROW EXECUTE FUNCTION update_daily_stats_on_message();

-- ── Vues dashboard ───────────────────────────────────────
CREATE OR REPLACE VIEW vw_dashboard_stats AS
SELECT
    (SELECT COUNT(*) FROM companies)                                  AS total_companies,
    (SELECT COUNT(*) FROM companies WHERE status='new')               AS new_leads,
    (SELECT COUNT(*) FROM companies WHERE status='qualified')         AS qualified_leads,
    (SELECT COUNT(*) FROM companies WHERE status='contacted')         AS contacted_leads,
    (SELECT COUNT(*) FROM companies WHERE status='replied')           AS replied_leads,
    (SELECT COUNT(*) FROM companies WHERE status='converted')         AS converted_leads,
    (SELECT COUNT(*) FROM companies WHERE phone_whatsapp IS NOT NULL) AS leads_with_wa,
    (SELECT COUNT(*) FROM messages  WHERE DATE(created_at)=CURRENT_DATE) AS messages_today,
    (SELECT COUNT(*) FROM messages  WHERE status='sent' AND DATE(sent_at)=CURRENT_DATE) AS sent_today,
    (SELECT COUNT(*) FROM messages  WHERE status='replied' AND DATE(replied_at)=CURRENT_DATE) AS replies_today;

CREATE OR REPLACE VIEW vw_leads_ready_to_contact AS
SELECT c.id, c.name, c.category, c.city, c.phone_whatsapp,
       c.score, c.status, c.followup_count,
       c.last_contacted_at, c.next_followup_at, c.campaign_id
FROM companies c
WHERE c.status IN ('qualified','contacted')
  AND c.phone_whatsapp IS NOT NULL
  AND (c.last_contacted_at IS NULL OR c.next_followup_at <= NOW())
ORDER BY c.score DESC, c.next_followup_at ASC NULLS FIRST;

CREATE OR REPLACE VIEW vw_campaign_performance AS
SELECT camp.id, camp.name, camp.is_active, camp.daily_limit,
    COUNT(DISTINCT m.company_id) AS contacted,
    COUNT(CASE WHEN m.status='sent'     THEN 1 END) AS sent,
    COUNT(CASE WHEN m.status='delivered'THEN 1 END) AS delivered,
    COUNT(CASE WHEN m.status='read'     THEN 1 END) AS read_count,
    COUNT(CASE WHEN m.status='replied'  THEN 1 END) AS replied,
    ROUND(COUNT(CASE WHEN m.status='replied' THEN 1 END)::numeric /
          NULLIF(COUNT(CASE WHEN m.status='sent' THEN 1 END),0)*100, 2) AS reply_rate_pct
FROM campaigns camp
LEFT JOIN messages m ON m.campaign_id = camp.id
GROUP BY camp.id, camp.name, camp.is_active, camp.daily_limit;
