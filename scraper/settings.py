import os

BOT_NAME = "prospection"
SPIDER_MODULES = ["spiders"]
NEWSPIDER_MODULE = "spiders"

DOWNLOAD_HANDLERS = {
    "http":  "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler",
    "https": "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler",
}
TWISTED_REACTOR = "twisted.internet.asyncioreactor.AsyncioSelectorReactor"
PLAYWRIGHT_BROWSER_TYPE = "chromium"
PLAYWRIGHT_LAUNCH_OPTIONS = {
    "headless": True,
    "args": [
        "--no-sandbox", "--disable-setuid-sandbox",
        "--disable-dev-shm-usage", "--disable-gpu",
        "--no-first-run", "--no-zygote",
    ]
}
PLAYWRIGHT_DEFAULT_NAVIGATION_TIMEOUT = 30000

ROBOTSTXT_OBEY    = False
COOKIES_ENABLED   = True
DOWNLOAD_DELAY    = 3
RANDOMIZE_DOWNLOAD_DELAY = True
CONCURRENT_REQUESTS      = 2
CONCURRENT_REQUESTS_PER_DOMAIN = 1
AUTOTHROTTLE_ENABLED     = True
AUTOTHROTTLE_START_DELAY = 2
AUTOTHROTTLE_MAX_DELAY   = 10
AUTOTHROTTLE_TARGET_CONCURRENCY = 1.5

DOWNLOADER_MIDDLEWARES = {
    "middlewares.user_agent.RandomUserAgentMiddleware": 400,
    "middlewares.retry.CustomRetryMiddleware":          550,
}

ITEM_PIPELINES = {
    "pipelines.dedup.DedupPipeline":       100,
    "pipelines.postgres.PostgresPipeline": 300,
}

DATABASE_URL = os.getenv("DATABASE_URL", "")
REDIS_URL    = os.getenv("REDIS_URL", "")

LOG_LEVEL        = "INFO"
LOG_FILE         = "logs/scrapy.log"
FEED_EXPORT_ENCODING = "utf-8"

RETRY_ENABLED    = True
RETRY_TIMES      = 3
RETRY_HTTP_CODES = [500, 502, 503, 504, 408, 429]
