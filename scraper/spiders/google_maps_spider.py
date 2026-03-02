"""
Google Maps Spider — Scrapy + Playwright v4
Fix: locale fr-FR + wait_for_navigation apres consentement
"""
import re
import scrapy
import logging
from urllib.parse import quote_plus
from scrapy_playwright.page import PageMethod
from items import CompanyItem

logger = logging.getLogger(__name__)


class GoogleMapsSpider(scrapy.Spider):
    name = "google_maps"
    custom_settings = {
        "PLAYWRIGHT_DEFAULT_NAVIGATION_TIMEOUT": 90000,
        "DOWNLOAD_DELAY": 3,
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

    def __init__(self, query="restaurant", location="Yaoundé, Cameroun",
                 max_results=50, job_id=None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.query = query
        self.location = location
        self.max_results = int(max_results)
        self.job_id = job_id
        self.count = 0
        encoded = quote_plus(f"{query} {location}")
        self.start_url = f"https://www.google.com/maps/search/{encoded}/"
        logger.info(f"Spider démarré | query={query} | location={location} | max={max_results}")

    def start_requests(self):
        yield scrapy.Request(
            url=self.start_url,
            callback=self.parse_list,
            meta={
                "playwright": True,
                "playwright_include_page": True,
                "playwright_context": "default",
                "playwright_page_methods": [
                    PageMethod("wait_for_load_state", "domcontentloaded"),
                    PageMethod("wait_for_timeout", 4000),
                ],
                "errback": self.errback,
            }
        )

    async def parse_list(self, response):
        page = response.meta["playwright_page"]
        try:
            # 1. Accepter consentement + attendre la navigation vers Maps
            buttons = await page.query_selector_all("button")
            for btn in buttons:
                try:
                    txt = (await btn.inner_text()).strip().lower()
                    if any(k in txt for k in ["accept", "akzeptier", "tout accept", "agree"]):
                        logger.info(f"Consentement cliqué: {txt}")
                        # Attendre la navigation APRES le clic (redirection consent -> maps)
                        async with page.expect_navigation(timeout=15000):
                            await btn.click()
                        logger.info(f"Navigation post-consent OK | URL: {page.url[:60]}")
                        await page.wait_for_timeout(3000)
                        break
                except Exception as e:
                    logger.warning(f"Erreur clic consent: {e}")
                    pass

            # 2. Attendre le feed Maps
            logger.info("Attente du feed Maps...")
            try:
                await page.wait_for_selector("[role='feed']", timeout=20000)
                logger.info("Feed détecté !")
            except:
                logger.warning("Feed non détecté, on continue quand même")

            # 3. Scroll
            for _ in range(8):
                feed = await page.query_selector("[role='feed']")
                if feed:
                    await feed.evaluate("el => el.scrollBy(0, 1500)")
                else:
                    await page.evaluate("window.scrollBy(0, 800)")
                await page.wait_for_timeout(1200)

            # 4. Collecter les liens
            links = await page.query_selector_all("a[href*='/maps/place/']")
            hrefs = set()
            for l in links:
                href = await l.get_attribute("href")
                if href:
                    hrefs.add(href)

            logger.info(f"{len(hrefs)} places trouvées")

            for href in list(hrefs)[:self.max_results]:
                yield scrapy.Request(
                    url=href,
                    callback=self.parse_place,
                    meta={
                        "playwright": True,
                        "playwright_include_page": True,
                        "playwright_context": "default",
                        "playwright_page_methods": [
                            PageMethod("wait_for_load_state", "domcontentloaded"),
                            PageMethod("wait_for_timeout", 2000),
                        ],
                        "errback": self.errback,
                    }
                )
        except Exception as e:
            logger.error(f"Erreur parse_list: {e}")
        finally:
            if not page.is_closed():
                await page.close()

    async def parse_place(self, response):
        page = response.meta["playwright_page"]
        try:
            try:
                await page.wait_for_selector("h1", timeout=10000)
            except:
                pass

            item = CompanyItem()
            item["source"] = "google_maps"
            item["source_url"] = response.url
            item["job_id"] = self.job_id
            item["city"] = self.location.split(",")[0].strip()

            m = re.search(r"0x[0-9a-f]+:0x[0-9a-f]+", response.url)
            if m:
                item["google_place_id"] = m.group(0)

            el = await page.query_selector("h1")
            if el:
                item["name"] = (await el.inner_text()).strip()

            el = await page.query_selector("button[jsaction*='category']")
            if el:
                item["category"] = (await el.inner_text()).strip()

            el = await page.query_selector("[data-item-id='address'] .fontBodyMedium")
            if el:
                item["address"] = (await el.inner_text()).strip()

            for sel in [
                "[data-item-id*='phone'] .fontBodyMedium",
                "a[href^='tel:']",
                "[data-tooltip*='phone'] .fontBodyMedium",
            ]:
                el = await page.query_selector(sel)
                if el:
                    txt = (await el.inner_text()).strip()
                    if txt:
                        item["phone"] = txt
                        break

            el = await page.query_selector("div.F7nice span[aria-hidden='true']")
            if el:
                try:
                    item["rating"] = float((await el.inner_text()).replace(",", "."))
                except:
                    pass

            el = await page.query_selector("a[data-item-id='authority']")
            if el:
                item["website"] = await el.get_attribute("href")

            m = re.search(r"@(-?\d+\.\d+),(-?\d+\.\d+)", response.url)
            if m:
                item["latitude"] = float(m.group(1))
                item["longitude"] = float(m.group(2))

            if item.get("name"):
                self.count += 1
                logger.info(f"[{self.count}] {item['name']} | {item.get('phone', '—')}")
                yield item

        except Exception as e:
            logger.error(f"Erreur parse_place: {e}")
        finally:
            if not page.is_closed():
                await page.close()

    def errback(self, failure):
        logger.error(f"Requête échouée: {failure.request.url} — {failure.value}")