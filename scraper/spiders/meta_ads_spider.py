"""
Meta Ads Library Spider — Scrapy + Playwright
Scrape les annonceurs actifs depuis la bibliothèque publique de Meta
URL: https://www.facebook.com/ads/library/
"""
import re
import scrapy
import logging
from urllib.parse import urlencode, unquote
from scrapy_playwright.page import PageMethod
from items import CompanyItem

logger = logging.getLogger(__name__)


class MetaAdsSpider(scrapy.Spider):
    name = "meta_ads"
    # CRITIQUE : autoriser 403 sinon Scrapy ignore la réponse avant le callback
    handle_httpstatus_list = [403, 429, 500]

    custom_settings = {
        "PLAYWRIGHT_DEFAULT_NAVIGATION_TIMEOUT": 90000,
        "DOWNLOAD_DELAY": 4,
        "CONCURRENT_REQUESTS": 1,
        "PLAYWRIGHT_PROCESS_REQUEST_HEADERS": None,
        "PLAYWRIGHT_CONTEXTS": {
            "meta": {
                "locale": "fr-FR",
                "timezone_id": "Africa/Douala",
                "user_agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/122.0.0.0 Safari/537.36"
                ),
                "viewport": {"width": 1280, "height": 800},
            }
        },
    }

    def __init__(self, query="restaurant", location="Cameroun",
                 country_code="CM", max_results=50, job_id=None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.query        = query
        self.location     = location
        self.country_code = country_code.upper()
        self.max_results  = int(max_results)
        self.job_id       = job_id
        self.count        = 0

        params = urlencode({
            "active_status": "active",
            "ad_type":       "all",
            "country":       self.country_code,
            "q":             query,
            "search_type":   "keyword_unordered",
            "media_type":    "all",
        })
        self.start_url = f"https://www.facebook.com/ads/library/?{params}"
        logger.info(f"MetaAds spider | query={query} | country={country_code} | max={max_results}")

    def start_requests(self):
        yield scrapy.Request(
            url=self.start_url,
            callback=self.parse_list,
            errback=self.errback,
            meta={
                "playwright": True,
                "playwright_include_page": True,
                "playwright_context": "meta",
                "playwright_page_methods": [
                    PageMethod("wait_for_load_state", "domcontentloaded"),
                    PageMethod("wait_for_timeout", 5000),
                ],
            }
        )

    async def parse_list(self, response):
        page = response.meta["playwright_page"]
        try:
            logger.info(f"Page chargee — status HTTP: {response.status} | URL: {response.url}")
            title = await page.title()
            logger.info(f"Titre: {title}")

            await self._accept_cookies(page)
            await page.wait_for_timeout(3000)

            current_url = page.url
            if "login" in current_url or "checkpoint" in current_url:
                logger.warning("Redirige vers login — Meta bloque sans compte")
                return

            logger.info("Attente resultats...")
            try:
                await page.wait_for_selector(
                    "[data-testid='ad-library-preview'], ._7jyr, .x1dr75xp",
                    timeout=20000
                )
                logger.info("Resultats detectes !")
            except Exception as e:
                logger.warning(f"Selecteur non trouve: {e}")

            # Collecter uniquement les slugs textuels (pas les IDs numeriques)
            # Les IDs comme /100084684231347 redirigent vers login
            # Les slugs comme /PeponlandCM fonctionnent sans compte
            seen_pages = set()
            scroll_attempts = 0
            max_scrolls = max(15, self.max_results // 5)

            SYSTEM_SLUGS = [
                'marketplace', 'watch', 'groups', 'events', 'pages',
                'profile.php', 'people', 'stories', 'gaming', 'fundraisers',
                'ads', 'business', 'help', 'policies', 'settings', 'login',
                'sharer', 'share', 'permalink', 'photo', 'video', 'reel',
            ]

            while len(seen_pages) < self.max_results and scroll_attempts < max_scrolls:
                links = await page.evaluate("""
                    (systemSlugs) => {
                        const results = [];
                        document.querySelectorAll('a[href]').forEach(a => {
                            const href = a.href || '';
                            if (!href.includes('facebook.com/')) return;
                            if (href.includes('/ads/library')) return;
                            if (href.includes('/login')) return;
                            if (href.includes('/help/')) return;

                            const clean = href.split('?')[0].replace(/\\/$/, '');
                            const match = clean.match(/facebook\\.com\\/([^/?#]+)/);
                            if (!match) return;

                            const slug = match[1];
                            // Rejeter IDs purement numeriques -> redirigent vers login
                            if (/^\\d+$/.test(slug)) return;
                            // Rejeter pages systeme Facebook
                            if (systemSlugs.includes(slug.toLowerCase())) return;

                            if (clean.length > 25) results.push(clean);
                        });
                        return [...new Set(results)];
                    }
                """, SYSTEM_SLUGS)

                for href in links:
                    seen_pages.add(href)

                logger.info(f"Scroll {scroll_attempts+1}/{max_scrolls} — {len(seen_pages)} slugs valides")

                scroll_attempts += 1
                await page.evaluate("window.scrollBy(0, 3000)")
                await page.wait_for_timeout(2500)

                for btn_text in ["Voir plus", "See more", "Load more"]:
                    try:
                        btn = await page.query_selector(
                            f"div[role='button']:has-text('{btn_text}'), "
                            f"button:has-text('{btn_text}')"
                        )
                        if btn:
                            await btn.click()
                            await page.wait_for_timeout(3000)
                            logger.info(f"Clique '{btn_text}'")
                            break
                    except:
                        pass

            logger.info(f"Total: {len(seen_pages)} slugs — visite des pages...")

            for page_url in list(seen_pages)[:self.max_results]:
                yield scrapy.Request(
                    url=page_url,
                    callback=self.parse_advertiser,
                    errback=self.errback,
                    meta={
                        "playwright": True,
                        "playwright_include_page": True,
                        "playwright_context": "meta",
                        "playwright_page_methods": [
                            PageMethod("wait_for_load_state", "domcontentloaded"),
                            PageMethod("wait_for_timeout", 4000),
                        ],
                    }
                )

        except Exception as e:
            logger.error(f"Erreur parse_list: {e}", exc_info=True)
        finally:
            if not page.is_closed():
                await page.close()

    async def parse_advertiser(self, response):
        page = response.meta["playwright_page"]
        try:
            # Si redirige vers login, ignorer
            if "login" in page.url or "checkpoint" in page.url:
                logger.warning(f"Login redirect pour: {response.url}")
                return

            item = CompanyItem()
            item["source"]     = "meta_ads"
            item["source_url"] = response.url
            item["job_id"]     = self.job_id
            item["city"]       = self.location.split(",")[0].strip()
            item["scrape_query"] = self.query 

            try:
                await page.wait_for_selector("h1, [data-key='page-name']", timeout=10000)
            except:
                pass

            # Nom
            for sel in ["h1", "[data-key='page-name']", "._8-yf span"]:
                el = await page.query_selector(sel)
                if el:
                    txt = (await el.inner_text()).strip()
                    if txt and len(txt) > 1:
                        item["name"] = txt
                        break

            # Onglet "A propos"
            about_url = response.url.rstrip("/") + "/about"
            await page.goto(about_url, timeout=30000)
            await page.wait_for_timeout(3000)

            if "login" in page.url:
                logger.warning(f"Login apres about: {response.url}")
                return

            page_text = await page.inner_text("body")

            # Telephone depuis Facebook
            for pattern in [r"\+237[\s\d]{9,12}", r"6\d{8}", r"2\d{8}"]:
                m = re.search(pattern, page_text)
                if m:
                    item["phone"] = m.group(0).strip()
                    break

            # Email depuis Facebook
            email_el = await page.query_selector("a[href^='mailto:']")
            if email_el:
                href = await email_el.get_attribute("href")
                item["email"] = href.replace("mailto:", "").strip()

            # Site web depuis Facebook
            web_el = await page.query_selector("a[href*='l.facebook.com/l.php']")
            if web_el:
                href = await web_el.get_attribute("href")
                m = re.search(r"u=([^&]+)", href)
                if m:
                    item["website"] = unquote(m.group(1))

            # FALLBACK : si pas de téléphone ET site web connu → scraper le site
            if not item.get("phone") and item.get("website"):
                try:
                    logger.info(f"Pas de tel FB → tentative sur site web: {item['website']}")
                    await page.goto(item["website"], timeout=20000, wait_until="domcontentloaded")
                    await page.wait_for_timeout(3000)
                    site_text = await page.inner_text("body")

                    # Téléphones internationaux larges + camerounais
                    phone_patterns = [
                        r"\+237[\s\.\-]?\d[\s\.\-]?\d{2}[\s\.\-]?\d{2}[\s\.\-]?\d{2}[\s\.\-]?\d{2}",
                        r"\+237\d{9}",
                        r"6\d{2}[\s\.\-]?\d{2}[\s\.\-]?\d{2}[\s\.\-]?\d{2}",
                        r"\+\d{1,3}[\s\.\-]?\(?\d{1,4}\)?[\s\.\-]?\d{2,4}[\s\.\-]?\d{2,4}[\s\.\-]?\d{2,4}",
                        r"tel:[\+\d\s\-\(\)]{7,20}",
                    ]
                    for pattern in phone_patterns:
                        m = re.search(pattern, site_text)
                        if m:
                            raw = m.group(0).replace("tel:", "").strip()
                            item["phone"] = raw
                            logger.info(f"Tel trouvé sur site web: {raw}")
                            break

                    # Email depuis site web
                    if not item.get("email"):
                        email_el = await page.query_selector("a[href^='mailto:']")
                        if email_el:
                            href = await email_el.get_attribute("href")
                            item["email"] = href.replace("mailto:", "").strip()
                            logger.info(f"Email trouvé sur site web: {item['email']}")

                except Exception as e:
                    logger.warning(f"Echec scraping site web {item.get('website')}: {e}")

            # Categorie
            cat_el = await page.query_selector("._4bl9, [data-key='page-category']")
            if cat_el:
                item["category"] = (await cat_el.inner_text()).strip()

            # Adresse
            addr_el = await page.query_selector("[data-key='address'] span, ._8-yg")
            if addr_el:
                item["address"] = (await addr_el.inner_text()).strip()

            if item.get("name"):
                self.count += 1
                logger.info(f"[{self.count}] {item['name']} | {item.get('phone', '—')} | {item.get('website', '—')}")
                yield item
            else:
                logger.warning(f"Pas de nom: {response.url}")

        except Exception as e:
            logger.error(f"Erreur parse_advertiser {response.url}: {e}")
        finally:
            if not page.is_closed():
                await page.close()

    async def _accept_cookies(self, page):
        selectors = [
            "button[data-cookiebanner='accept_only_essential_button']",
            "button[data-cookiebanner='accept_button']",
            "[data-testid='cookie-policy-dialog-accept-button']",
            "button:has-text('Tout accepter')",
            "button:has-text('Allow all cookies')",
            "button:has-text('Accepter')",
        ]
        for sel in selectors:
            try:
                btn = await page.query_selector(sel)
                if btn:
                    await btn.click()
                    await page.wait_for_timeout(2000)
                    logger.info(f"Cookies acceptes: {sel}")
                    return
            except:
                pass
        buttons = await page.query_selector_all("button")
        for btn in buttons:
            try:
                txt = (await btn.inner_text()).strip().lower()
                if any(k in txt for k in ["accept", "accepter", "allow", "tout accepter"]):
                    await btn.click()
                    await page.wait_for_timeout(2000)
                    return
            except:
                pass

    def errback(self, failure):
        logger.error(f"Requete echouee: {failure.request.url} — {failure.value}")