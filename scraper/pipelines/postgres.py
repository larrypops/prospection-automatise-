"""
Pipeline PostgreSQL — Normalise les téléphones et stocke les leads
"""
import re
import logging
import psycopg2
import psycopg2.extras
import phonenumbers
from itemadapter import ItemAdapter
from scrapy.exceptions import DropItem

logger = logging.getLogger(__name__)


class PostgresPipeline:

    def __init__(self, database_url):
        self.database_url = database_url
        self.conn = None
        self.cur  = None
        self.inserted = self.updated = self.skipped = 0

    @classmethod
    def from_crawler(cls, crawler):
        return cls(database_url=crawler.settings.get("DATABASE_URL"))

    def open_spider(self, spider):
        self.conn = psycopg2.connect(self.database_url)
        self.conn.autocommit = False
        self.cur  = self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        logger.info("PostgreSQL connecté")

    def close_spider(self, spider):
        if self.conn:
            self.conn.commit()
            self.cur.close()
            self.conn.close()
        logger.info(f"Pipeline terminé — insérés={self.inserted} maj={self.updated} ignorés={self.skipped}")

    def process_item(self, item, spider):
        a = ItemAdapter(item)

        phone_raw = a.get("phone") or ""
        phone_wa  = self._to_whatsapp(phone_raw, "CM")

        data = {
            "name":             (a.get("name") or "").strip(),
            "category":         a.get("category"),
            "sub_category":     a.get("sub_category"),
            "description":      a.get("description"),
            "phone":            phone_raw,
            "phone_whatsapp":   phone_wa,
            "email":            a.get("email"),
            "website":          a.get("website"),
            "address":          a.get("address"),
            "city":             a.get("city"),
            "region":           a.get("region"),
            "country":          a.get("country") or "Cameroun",
            "latitude":         a.get("latitude"),
            "longitude":        a.get("longitude"),
            "source":           a.get("source") or "manual",
            "source_url":       a.get("source_url"),
            "google_place_id":  a.get("google_place_id"),
            "facebook_page_id": a.get("facebook_page_id"),
            "rating":           a.get("rating"),
            "reviews_count":    a.get("reviews_count") or 0,
            "tags":             a.get("tags") or [],
        }

        if not data["name"]:
            raise DropItem("Nom vide")

        try:
            if data["google_place_id"]:
                self._upsert_by_place_id(data)
            else:
                self._upsert_by_name_city(data)

            if a.get("job_id"):
                self._update_job(a.get("job_id"))

            self.conn.commit()
        except Exception as e:
            self.conn.rollback()
            logger.error(f"Erreur DB pour '{data['name']}': {e}")

        return item

    def _upsert_by_place_id(self, d):
        self.cur.execute("""
            INSERT INTO companies (
                name, category, sub_category, description,
                phone, phone_whatsapp, email, website,
                address, city, region, country, latitude, longitude,
                source, source_url, google_place_id, facebook_page_id,
                rating, reviews_count, tags
            ) VALUES (
                %(name)s, %(category)s, %(sub_category)s, %(description)s,
                %(phone)s, %(phone_whatsapp)s, %(email)s, %(website)s,
                %(address)s, %(city)s, %(region)s, %(country)s, %(latitude)s, %(longitude)s,
                %(source)s, %(source_url)s, %(google_place_id)s, %(facebook_page_id)s,
                %(rating)s, %(reviews_count)s, %(tags)s
            )
            ON CONFLICT (google_place_id) DO UPDATE SET
                name           = EXCLUDED.name,
                category       = COALESCE(EXCLUDED.category,       companies.category),
                phone          = COALESCE(EXCLUDED.phone,          companies.phone),
                phone_whatsapp = COALESCE(EXCLUDED.phone_whatsapp, companies.phone_whatsapp),
                email          = COALESCE(EXCLUDED.email,          companies.email),
                website        = COALESCE(EXCLUDED.website,        companies.website),
                rating         = COALESCE(EXCLUDED.rating,         companies.rating),
                reviews_count  = COALESCE(EXCLUDED.reviews_count,  companies.reviews_count),
                updated_at     = NOW()
            RETURNING (xmax = 0) AS is_new
        """, d)
        row = self.cur.fetchone()
        if row and row["is_new"]:
            self.inserted += 1
        else:
            self.updated += 1

    def _upsert_by_name_city(self, d):
        self.cur.execute("""
            INSERT INTO companies (
                name, category, sub_category, description,
                phone, phone_whatsapp, email, website,
                address, city, region, country, latitude, longitude,
                source, source_url, google_place_id, facebook_page_id,
                rating, reviews_count, tags
            ) VALUES (
                %(name)s, %(category)s, %(sub_category)s, %(description)s,
                %(phone)s, %(phone_whatsapp)s, %(email)s, %(website)s,
                %(address)s, %(city)s, %(region)s, %(country)s, %(latitude)s, %(longitude)s,
                %(source)s, %(source_url)s, %(google_place_id)s, %(facebook_page_id)s,
                %(rating)s, %(reviews_count)s, %(tags)s
            ) ON CONFLICT DO NOTHING RETURNING id
        """, d)
        if self.cur.fetchone():
            self.inserted += 1
        else:
            self.skipped += 1

    def _update_job(self, job_id):
        self.cur.execute("""
            UPDATE scrape_jobs SET leads_found = leads_found + 1 WHERE id = %s
        """, (job_id,))

    @staticmethod
    def _to_whatsapp(raw, country="CM"):
        """Convertit un numéro brut en format E164 pour WhatsApp (+237XXXXXXXXX)"""
        if not raw:
            return None
        
        # Nettoyage : garder uniquement chiffres et +
        cleaned = re.sub(r'[^\d+]', '', str(raw))
        
        # Supprime les + en trop
        if cleaned.count('+') > 1:
            cleaned = '+' + cleaned.replace('+', '')
        
        # 1. Format international complet déjà présent (+237XXXXXXXX)
        if re.match(r'^\+237[6-9]\d{8}$', cleaned):
            return cleaned
        
        # 2. Format avec 00237 au début → convertir en +237
        if re.match(r'^00237[6-9]\d{8}$', cleaned):
            return '+237' + cleaned[5:]
        
        # 3. Format avec 237 au début mais sans + → ajouter +
        if re.match(r'^237[6-9]\d{8}$', cleaned):
            return '+' + cleaned
        
        # 4. Format local camerounais (commence par 6 ou 2 ou 3 et 9 chiffres)
        if re.match(r'^[623]\d{8}$', cleaned):
            return '+237' + cleaned
        
        # 5. Essayer phonenumbers comme fallback
        try:
            parsed = phonenumbers.parse(cleaned, country)
            if phonenumbers.is_valid_number(parsed):
                return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
        except:
            pass
        
        # 6. Dernier fallback pour les numéros avec indicatif
        digits = re.sub(r'\D', '', cleaned)
        if len(digits) == 9 and digits[0] in ('6', '2', '3'):
            return f"+237{digits}"
        if len(digits) == 12 and digits.startswith('237'):
            return f"+{digits}"
        if len(digits) == 13 and digits.startswith('00237'):
            return f"+237{digits[5:]}"
        
        return None
