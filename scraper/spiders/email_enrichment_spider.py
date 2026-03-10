"""
email_enrichment_spider.py
--------------------------
Visite les sites web des companies sans email et extrait les adresses email.
Met à jour directement la DB PostgreSQL.

Usage:
  scrapy crawl email_enrichment -s DATABASE_URL="..." -s LOG_FILE="" -L INFO
  scrapy crawl email_enrichment -a batch_size=50 -s DATABASE_URL="..." -s LOG_FILE="" -L INFO
"""

import re
import logging
import psycopg2
import psycopg2.extras
import scrapy
from scrapy_playwright.page import PageMethod
from urllib.parse import urljoin, urlparse

logger = logging.getLogger(__name__)

# Regex email — exclut les faux positifs courants
EMAIL_REGEX = re.compile(
    r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}",
    re.IGNORECASE
)

# Domaines à ignorer (pas des vrais emails)
EMAIL_BLACKLIST = {
    "example.com", "sentry.io", "wix.com", "wordpress.com",
    "googletagmanager.com", "schema.org", "w3.org", "googleapis.com",
    "facebook.com", "instagram.com", "twitter.com", "linkedin.com",
}

# Pages de contact à visiter en priorité
CONTACT_PATHS = [
    "/contact", "/contact-us", "/contactez-nous", "/nous-contacter",
    "/about", "/a-propos", "/apropos",
]


def clean_email(email):
    """Nettoie et valide un email."""
    email = email.strip().lower()
    domain = email.split("@")[-1] if "@" in email else ""
    if domain in EMAIL_BLACKLIST:
        return None
    if len(email) > 100 or len(email) < 6:
        return None
    if not re.match(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$", email):
        return None
    return email


def extract_emails(text):
    """Extrait tous les emails valides d'un texte."""
    found = EMAIL_REGEX.findall(text)
    emails = []
    for e in found:
        clean = clean_email(e)
        if clean and clean not in emails:
            emails.append(clean)
    return emails


class EmailEnrichmentSpider(scrapy.Spider):
    name = "email_enrichment"
    custom_settings = {
        "DOWNLOAD_HANDLERS": {
            "http":  "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler",
            "https": "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler",
        },
        "TWISTED_REACTOR": "twisted.internet.asyncioreactor.AsyncioSelectorReactor",
        "PLAYWRIGHT_BROWSER_TYPE": "chromium",
        "PLAYWRIGHT_LAUNCH_OPTIONS": {
            "headless": True,
            "args": ["--no-sandbox", "--disable-setuid-sandbox",
                     "--disable-dev-shm-usage", "--disable-gpu"],
        },
        "PLAYWRIGHT_DEFAULT_NAVIGATION_TIMEOUT": 20000,
        "CONCURRENT_REQUESTS": 3,
        "CONCURRENT_REQUESTS_PER_DOMAIN": 1,
        "DOWNLOAD_DELAY": 2,
        "RANDOMIZE_DOWNLOAD_DELAY": True,
        "AUTOTHROTTLE_ENABLED": True,
        "ROBOTSTXT_OBEY": False,
        "ITEM_PIPELINES": {},  # On gère la DB directement ici
        "LOG_LEVEL": "INFO",
    }

    def __init__(self, batch_size=100, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.batch_size  = int(batch_size)
        self.conn        = None
        self.cur         = None
        self.updated     = 0
        self.failed      = 0
        self.no_email    = 0

    # ── DB ────────────────────────────────────────────────────────────────────

    def _connect_db(self):
        db_url = self.settings.get("DATABASE_URL")
        self.conn = psycopg2.connect(db_url)
        self.conn.autocommit = False
        self.cur  = self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        logger.info("PostgreSQL connecté")

    def _get_companies(self):
        self.cur.execute("""
            SELECT id, name, website
            FROM companies
            WHERE website IS NOT NULL
              AND website != ''
              AND (email IS NULL OR email = '')
            ORDER BY created_at DESC
            LIMIT %s
        """, (self.batch_size,))
        return self.cur.fetchall()

    def _save_email(self, company_id, email):
        self.cur.execute("""
            UPDATE companies
            SET email      = %s,
                updated_at = NOW()
            WHERE id = %s
              AND (email IS NULL OR email = '')
        """, (email, company_id))
        self.conn.commit()

    # ── Spider lifecycle ──────────────────────────────────────────────────────

    def start_requests(self):
        self._connect_db()
        companies = self._get_companies()

        if not companies:
            logger.info("Aucune company sans email avec website trouvée")
            return

        logger.info(f"═══════════════════════════════════════════════")
        logger.info(f"  EMAIL ENRICHMENT — {len(companies)} companies à traiter")
        logger.info(f"═══════════════════════════════════════════════")

        for company in companies:
            url = company["website"]
            if not url.startswith("http"):
                url = "https://" + url

            yield scrapy.Request(
                url=url,
                callback=self.parse_homepage,
                errback=self.errback,
                meta={
                    "company_id":   company["id"],
                    "company_name": company["name"],
                    "base_url":     url,
                    "playwright":   True,
                    "playwright_include_page": True,
                    "playwright_page_methods": [
                        PageMethod("wait_for_load_state", "domcontentloaded"),
                    ],
                },
                dont_filter=True,
            )

    def parse_homepage(self, response):
        company_id   = response.meta["company_id"]
        company_name = response.meta["company_name"]
        base_url     = response.meta["base_url"]

        # Fermer la page Playwright
        page = response.meta.get("playwright_page")
        if page:
            self.crawler.engine.slot.nextcall.schedule()

        # 1. Chercher emails dans le HTML de la homepage
        text   = response.text
        emails = extract_emails(text)

        if emails:
            self._save_email(company_id, emails[0])
            self.updated += 1
            logger.info(f"✅ [{self.updated}] {company_name} → {emails[0]}")
            return

        # 2. Chercher liens mailto:
        mailto_links = response.css("a[href^='mailto:']::attr(href)").getall()
        for link in mailto_links:
            email = clean_email(link.replace("mailto:", "").split("?")[0])
            if email:
                self._save_email(company_id, email)
                self.updated += 1
                logger.info(f"✅ [{self.updated}] {company_name} → {email} (mailto)")
                return

        # 3. Essayer la page /contact
        parsed  = urlparse(base_url)
        contact_url = f"{parsed.scheme}://{parsed.netloc}/contact"

        yield scrapy.Request(
            url=contact_url,
            callback=self.parse_contact,
            errback=self.errback,
            meta={
                "company_id":   company_id,
                "company_name": company_name,
                "playwright":   True,
                "playwright_include_page": True,
                "playwright_page_methods": [
                    PageMethod("wait_for_load_state", "domcontentloaded"),
                ],
            },
            dont_filter=True,
        )

    def parse_contact(self, response):
        company_id   = response.meta["company_id"]
        company_name = response.meta["company_name"]

        # Fermer la page Playwright
        page = response.meta.get("playwright_page")
        if page:
            self.crawler.engine.slot.nextcall.schedule()

        text   = response.text
        emails = extract_emails(text)

        if emails:
            self._save_email(company_id, emails[0])
            self.updated += 1
            logger.info(f"✅ [{self.updated}] {company_name} → {emails[0]} (contact page)")
            return

        # Chercher liens mailto:
        mailto_links = response.css("a[href^='mailto:']::attr(href)").getall()
        for link in mailto_links:
            email = clean_email(link.replace("mailto:", "").split("?")[0])
            if email:
                self._save_email(company_id, email)
                self.updated += 1
                logger.info(f"✅ [{self.updated}] {company_name} → {email} (contact mailto)")
                return

        self.no_email += 1
        logger.info(f"⚠️  {company_name} — aucun email trouvé")

    def errback(self, failure):
        company_name = failure.request.meta.get("company_name", "?")
        self.failed += 1
        logger.warning(f"❌ Erreur {company_name}: {failure.value}")

    def closed(self, reason):
        if self.conn:
            self.conn.close()
        logger.info("═══════════════════════════════════════════════")
        logger.info(f"  RÉSULTATS ENRICHISSEMENT EMAIL")
        logger.info(f"  ✅ Emails trouvés  : {self.updated}")
        logger.info(f"  ⚠️  Aucun email     : {self.no_email}")
        logger.info(f"  ❌ Erreurs site    : {self.failed}")
        logger.info("═══════════════════════════════════════════════")