import time, logging
from scrapy.downloadermiddlewares.retry import RetryMiddleware

logger = logging.getLogger(__name__)

class CustomRetryMiddleware(RetryMiddleware):
    def process_response(self, request, response, spider):
        if response.status in [429, 503]:
            n = request.meta.get("retry_times", 0)
            wait = min(2 ** n * 10, 120)
            logger.warning(f"Rate limited ({response.status}) — attente {wait}s")
            time.sleep(wait)
        return super().process_response(request, response, spider)
