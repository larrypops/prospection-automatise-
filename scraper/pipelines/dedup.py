import hashlib, logging
import redis as redis_lib
from itemadapter import ItemAdapter
from scrapy.exceptions import DropItem

logger = logging.getLogger(__name__)

class DedupPipeline:
    def __init__(self, redis_url):
        self.redis_url = redis_url
        self.r = None
        self.dupes = 0

    @classmethod
    def from_crawler(cls, crawler):
        return cls(redis_url=crawler.settings.get("REDIS_URL"))

    def open_spider(self, spider):
        try:
            self.r = redis_lib.from_url(self.redis_url)
            self.r.ping()
        except Exception as e:
            logger.warning(f"Redis non disponible : {e}")
            self.r = None

    def process_item(self, item, spider):
        if not self.r:
            return item
        a = ItemAdapter(item)
        place_id = a.get("google_place_id")
        if place_id:
            fp = f"place:{place_id}"
        else:
            s = f"{(a.get('name') or '').lower()}:{(a.get('city') or '').lower()}:{a.get('phone') or ''}"
            fp = hashlib.md5(s.encode()).hexdigest()
        key = f"scrapy:seen:{fp}"
        if self.r.exists(key):
            self.dupes += 1
            raise DropItem(f"Doublon: {a.get('name')}")
        self.r.setex(key, 86400 * 7, 1)
        return item

    def close_spider(self, spider):
        logger.info(f"Dedup: {self.dupes} doublons filtrés")
