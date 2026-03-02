"""
PagesJaunes Cameroun Spider — Scrapy + Playwright
Source: pagesjaunes.cm
Secteurs: restaurants, hôtels, écoles, commerce, services
Capacité: 1000+ leads par run
"""
import re
import scrapy
import logging
from scrapy_playwright.page import PageMethod
from items import CompanyItem

logger = logging.getLogger(__name__)

# ── Secteurs à scraper avec leurs slugs PagesJaunes ──────────
CATEGORIES = {
    "restaurants":   "restaurants",
    "hotels":        "hotels",
    "ecoles":        "ecoles-et-instituts",
    "universites":   "universites-et-grandes-ecoles",
    "supermarches":  "supermarches-et-hypermarches",
    "boutiques":     "boutiques-et-magasins",
    "pharmacies":    "pharmacies",
    "salons":        "salons-de-coiffure",
    "garages":       "garages-et-ateliers",
    "banques":       "banques",
    "assurances":    "assurances",
    "cliniques":     "cliniques-et-hopitaux",
    "agences_immo":  "agences-immobilieres",
    "btp":           "construction-et-btp",
    "informatique":  "informatique-et-internet",
}

# ── Villes principales du Cameroun ───────────────────────────
CITIES = [
    "yaounde", "douala", "bafoussam", "bamenda",
    "garoua", "maroua", "ngaoundere", "bertoua",
    "ebolowa", "limbe", "kribi", "edea",
]


class PagesJaunesCmSpider(scrapy.Spider):
    name = "pagesjaunes_cm"
    allowed_domains = ["pagesjaunes.cm"]
    base_url = "https://www.pagesjaunes.cm"

    custom_settings = {
        "PLAYWRIGHT_DEFAULT_NAVIGATION_TIMEOUT": 60000,
        "DOWNLOAD_DELAY": 2,
        "CONCURRENT_REQUESTS": 1,
        "PLAYWRIGHT_PROCESS_REQUEST_HEADERS": None,
        "PLAYWRIGHT_CONTEXTS": {
            "default": {
                "locale": "fr-FR",
                "timezone_id": "Africa/Douala",
                "user_agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/122.0.0.0 Safari/537.36"
                ),
            }
        },
    }

    def __init__(self, query=None, location=None, category=None,
                 max_results=1000, job_id=None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.job_id      = job_id
        self.max_results = int(max_results)
        self.count       = 0

        # Si une catégorie spécifique est demandée
        if category and category in CATEGORIES:
            self.categories = {category: CATEGORIES[category]}
        else:
            self.categories = CATEGORIES

        # Si une ville spécifique est demandée
        if location:
            self.cities = [location.lower().replace(" ", "-")]
        else:
            self.cities = CITIES

        logger.info(
            f"PagesJaunes spider | catégories={list(self.categories.keys())} "
            f"| villes={self.cities} | max={max_results}"
        )

    def start_requests(self):
        """Génère une URL par combinaison catégorie × ville."""
        for city in self.cities:
            for cat_name, cat_slug in self.categories.items():
                if self.count >= self.max_results:
                    return
                url = f"{self.base_url}/search?q={cat_slug}&where={city}"
                yield scrapy.Request(
                    url=url,
                    callback=self.parse_list,
                    meta={
                        "playwright": True,
                        "playwright_include_page": True,
                        "playwright_context": "default",
                        "playwright_page_methods": [
                            PageMethod("wait_for_load_state", "domcontentloaded"),
                            PageMethod("wait_for_timeout", 3000),
                        ],
                        "errback": self.errback,
                        "cat_name": cat_name,
                        "city": city,
                    }
                )

    async def parse_list(self, response):
        """Parse la page liste des résultats PagesJaunes."""
        page     = response.meta["playwright_page"]
        cat_name = response.meta["cat_name"]
        city     = response.meta["city"]

        try:
            await page.wait_for_timeout(2000)

            # Extraire les liens vers les fiches détail
            # PagesJaunes CM utilise des liens /annonce/ ou /entreprise/
            detail_links = await page.query_selector_all(
                "a[href*='/annonce/'], a[href*='/entreprise/'], "
                "a[href*='/listing/'], .listing-title a, .result-title a, "
                "h2 a, h3 a, .company-name a"
            )

            hrefs = set()
            for link in detail_links:
                href = await link.get_attribute("href")
                if href:
                    if href.startswith("/"):
                        href = self.base_url + href
                    if "pagesjaunes.cm" in href:
                        hrefs.add(href)

            logger.info(f"[{cat_name}/{city}] {len(hrefs)} fiches trouvées")

            # Si pas de liens détail, extraire directement depuis la liste
            if not hrefs:
                items = await self._extract_from_list(page, cat_name, city)
                for item in items:
                    yield item
            else:
                for href in hrefs:
                    if self.count >= self.max_results:
                        break
                    yield scrapy.Request(
                        url=href,
                        callback=self.parse_detail,
                        meta={
                            "playwright": True,
                            "playwright_include_page": True,
                            "playwright_context": "default",
                            "playwright_page_methods": [
                                PageMethod("wait_for_load_state", "domcontentloaded"),
                                PageMethod("wait_for_timeout", 2000),
                            ],
                            "errback": self.errback,
                            "cat_name": cat_name,
                            "city": city,
                        }
                    )

            # Pagination — chercher "Suivant" ou numéros de pages
            next_page = await page.query_selector(
                "a[aria-label='Suivant'], a:has-text('Suivant'), "
                "a.next, .pagination-next a, a[rel='next']"
            )
            if next_page and self.count < self.max_results:
                next_url = await next_page.get_attribute("href")
                if next_url:
                    if next_url.startswith("/"):
                        next_url = self.base_url + next_url
                    yield scrapy.Request(
                        url=next_url,
                        callback=self.parse_list,
                        meta={
                            "playwright": True,
                            "playwright_include_page": True,
                            "playwright_context": "default",
                            "playwright_page_methods": [
                                PageMethod("wait_for_load_state", "domcontentloaded"),
                                PageMethod("wait_for_timeout", 2000),
                            ],
                            "errback": self.errback,
                            "cat_name": cat_name,
                            "city": city,
                        }
                    )

        except Exception as e:
            logger.error(f"Erreur parse_list [{cat_name}/{city}]: {e}")
        finally:
            if not page.is_closed():
                await page.close()

    async def _extract_from_list(self, page, cat_name, city):
        """Extrait les données directement depuis la page liste (fallback)."""
        items = []
        try:
            # Chercher les blocs de résultats
            cards = await page.query_selector_all(
                ".result-item, .listing-item, .company-card, "
                "[class*='result'], [class*='listing'], [class*='card']"
            )

            for card in cards:
                if self.count >= self.max_results:
                    break
                try:
                    item = CompanyItem()
                    item["source"]   = "pagesjaunes_cm"
                    item["job_id"]   = self.job_id
                    item["city"]     = city.replace("-", " ").title()
                    item["country"]  = "Cameroun"
                    item["category"] = cat_name.replace("_", " ").title()

                    # Nom
                    name_el = await card.query_selector("h2, h3, .name, .title, [class*='name']")
                    if name_el:
                        item["name"] = (await name_el.inner_text()).strip()

                    # Téléphone
                    phone_el = await card.query_selector(
                        "a[href^='tel:'], .phone, [class*='phone'], [class*='tel']"
                    )
                    if phone_el:
                        phone = await phone_el.get_attribute("href") or await phone_el.inner_text()
                        item["phone"] = phone.replace("tel:", "").strip()

                    # Adresse
                    addr_el = await card.query_selector(".address, [class*='address'], [class*='adresse']")
                    if addr_el:
                        item["address"] = (await addr_el.inner_text()).strip()

                    # URL source
                    link_el = await card.query_selector("a")
                    if link_el:
                        href = await link_el.get_attribute("href")
                        if href:
                            item["source_url"] = self.base_url + href if href.startswith("/") else href

                    if item.get("name"):
                        self.count += 1
                        logger.info(f"[{self.count}] {item['name']} | {item.get('phone', '—')}")
                        items.append(item)

                except Exception as e:
                    logger.warning(f"Erreur extraction card: {e}")

        except Exception as e:
            logger.error(f"Erreur _extract_from_list: {e}")

        return items

    async def parse_detail(self, response):
        """Parse une fiche détail entreprise."""
        page     = response.meta["playwright_page"]
        cat_name = response.meta["cat_name"]
        city     = response.meta["city"]

        try:
            item = CompanyItem()
            item["source"]     = "pagesjaunes_cm"
            item["source_url"] = response.url
            item["job_id"]     = self.job_id
            item["city"]       = city.replace("-", " ").title()
            item["country"]    = "Cameroun"
            item["category"]   = cat_name.replace("_", " ").title()

            # Nom — plusieurs sélecteurs possibles
            for sel in ["h1", ".company-name", ".listing-name", "[class*='company-title']", "[itemprop='name']"]:
                el = await page.query_selector(sel)
                if el:
                    txt = (await el.inner_text()).strip()
                    if txt:
                        item["name"] = txt
                        break

            # Téléphone
            for sel in [
                "a[href^='tel:']",
                "[class*='phone']",
                "[class*='tel']",
                "[itemprop='telephone']",
            ]:
                el = await page.query_selector(sel)
                if el:
                    phone = await el.get_attribute("href") or await el.inner_text()
                    phone = phone.replace("tel:", "").strip()
                    if phone:
                        item["phone"] = phone
                        break

            # Email
            email_el = await page.query_selector("a[href^='mailto:'], [itemprop='email']")
            if email_el:
                email = await email_el.get_attribute("href") or await email_el.inner_text()
                item["email"] = email.replace("mailto:", "").strip()

            # Site web
            web_el = await page.query_selector(
                "a[class*='website'], a[class*='web'], "
                "[itemprop='url'] a, a[rel='nofollow'][target='_blank']"
            )
            if web_el:
                item["website"] = await web_el.get_attribute("href")

            # Adresse
            for sel in ["[itemprop='address']", ".address", "[class*='adresse']", "[class*='address']"]:
                el = await page.query_selector(sel)
                if el:
                    txt = (await el.inner_text()).strip()
                    if txt:
                        item["address"] = txt
                        break

            # Description
            desc_el = await page.query_selector(
                "[itemprop='description'], .description, [class*='description']"
            )
            if desc_el:
                item["description"] = (await desc_el.inner_text()).strip()[:500]

            if item.get("name"):
                self.count += 1
                logger.info(f"[{self.count}] {item['name']} | {item.get('phone', '—')} | {city}")
                yield item

        except Exception as e:
            logger.error(f"Erreur parse_detail: {e}")
        finally:
            if not page.is_closed():
                await page.close()

    def errback(self, failure):
        logger.error(f"Requête échouée: {failure.request.url} — {failure.value}")