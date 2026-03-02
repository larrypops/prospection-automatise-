"""
Scraper API Flask — Déclenchement des spiders depuis n8n
Port 5000 (interne seulement)
"""
import os, uuid, threading, subprocess, logging
import psycopg2, psycopg2.extras
from flask import Flask, request, jsonify
from functools import wraps

app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

DATABASE_URL    = os.getenv("DATABASE_URL", "")
SCRAPER_API_KEY = os.getenv("SCRAPER_API_KEY", "scraper_secret_change_me")
REDIS_URL       = os.getenv("REDIS_URL", "")


def get_db():
    return psycopg2.connect(DATABASE_URL)


def require_key(f):
    @wraps(f)
    def dec(*args, **kwargs):
        key = request.headers.get("X-API-Key") or request.args.get("api_key")
        if key != SCRAPER_API_KEY:
            return jsonify({"error": "Unauthorized"}), 401
        return f(*args, **kwargs)
    return dec


def run_spider(spider_name: str, params: dict, job_id: str):
    """Lance un spider Scrapy en arrière-plan et met à jour scrape_jobs."""
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("UPDATE scrape_jobs SET status='running', started_at=NOW() WHERE id=%s", (job_id,))
        conn.commit(); cur.close(); conn.close()

        cmd = [
            "scrapy", "crawl", spider_name,
            "-s", f"DATABASE_URL={DATABASE_URL}",
            "-s", f"REDIS_URL={REDIS_URL}",
            "-a", f"job_id={job_id}",
        ]
        for k, v in params.items():
            if k not in ("api_key",):
                cmd += ["-a", f"{k}={v}"]

        logger.info(f"Lancement spider {spider_name} | job_id={job_id}")
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=3600, cwd="/app")
        status = "done" if result.returncode == 0 else "failed"
        error  = result.stderr[-2000:] if result.returncode != 0 else None

        conn = get_db(); cur = conn.cursor()
        cur.execute("""
            UPDATE scrape_jobs SET
                status=%s, completed_at=NOW(),
                duration_sec=EXTRACT(EPOCH FROM NOW()-started_at)::INTEGER,
                error_message=%s
            WHERE id=%s
        """, (status, error, job_id))
        conn.commit(); cur.close(); conn.close()
        logger.info(f"Spider {spider_name} terminé: {status}")

    except Exception as e:
        logger.error(f"Erreur spider: {e}")
        try:
            conn = get_db(); cur = conn.cursor()
            cur.execute("UPDATE scrape_jobs SET status='failed', error_message=%s, completed_at=NOW() WHERE id=%s",
                        (str(e)[:500], job_id))
            conn.commit(); cur.close(); conn.close()
        except:
            pass


def create_job(source: str, query: str, location: str, params: dict) -> str:
    job_id = str(uuid.uuid4())
    conn = get_db(); cur = conn.cursor()
    cur.execute("""
        INSERT INTO scrape_jobs (id, source, query, location, params, status)
        VALUES (%s, %s, %s, %s, %s, 'pending')
    """, (job_id, source, query, location, psycopg2.extras.Json(params)))
    conn.commit(); cur.close(); conn.close()
    return job_id


# ── Routes ───────────────────────────────────────────────

@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "scraper"})


# ── Google Maps ──────────────────────────────────────────
@app.post("/api/scrape/google-maps")
@require_key
def scrape_google_maps():
    d = request.json or {}
    query    = d.get("query", "restaurant")
    location = d.get("location", "Yaoundé, Cameroun")
    max_r    = int(d.get("max_results", 50))

    job_id = create_job("google_maps", query, location, d)
    threading.Thread(
        target=run_spider,
        args=("google_maps", {"query": query, "location": location, "max_results": max_r}, job_id),
        daemon=True
    ).start()

    return jsonify({
        "success": True, "job_id": job_id, "spider": "google_maps",
        "query": query, "location": location, "max_results": max_r
    }), 202


# ── Facebook Pages (utilise meta_ads pour scraper Facebook) ───────────────────────────────────────
@app.post("/api/scrape/facebook")
@require_key
def scrape_facebook():
    d = request.json or {}
    query        = d.get("query", "restaurant")
    location     = d.get("location", "Yaoundé")
    country_code = d.get("country_code", "CM")
    max_r        = int(d.get("max_results", 30))

    job_id = create_job("facebook", query, location, d)
    threading.Thread(
        target=run_spider,
        args=("meta_ads", {
            "query":        query,
            "location":     location,
            "country_code": country_code,
            "max_results":  max_r,
        }, job_id),
        daemon=True
    ).start()

    return jsonify({
        "success":      True,
        "job_id":       job_id,
        "spider":       "meta_ads",
        "note":         "Utilise Meta Ads Library pour trouver des entreprises sur Facebook",
        "query":        query,
        "location":     location,
        "country_code": country_code,
        "max_results":  max_r,
    }), 202


# ── Meta Ads Library ─────────────────────────────────────
@app.post("/api/scrape/meta-ads")
@require_key
def scrape_meta_ads():
    d            = request.json or {}
    query        = d.get("query", "restaurant")
    location     = d.get("location", "Cameroun")
    country_code = d.get("country_code", "CM")
    max_r        = int(d.get("max_results", 50))

    job_id = create_job("meta_ads", query, location, d)
    threading.Thread(
        target=run_spider,
        args=("meta_ads", {
            "query":        query,
            "location":     location,
            "country_code": country_code,
            "max_results":  max_r,
        }, job_id),
        daemon=True
    ).start()

    return jsonify({
        "success":      True,
        "job_id":       job_id,
        "spider":       "meta_ads",
        "query":        query,
        "location":     location,
        "country_code": country_code,
        "max_results":  max_r,
    }), 202


# ── PagesJaunes Cameroun ─────────────────────────────────
@app.post("/api/scrape/pagesjaunes")
@require_key
def scrape_pagesjaunes():
    d        = request.json or {}
    query    = d.get("query", "restaurant")
    location = d.get("location", "yaounde")
    category = d.get("category", None)   # optionnel: restaurants, hotels, ecoles...
    max_r    = int(d.get("max_results", 1000))

    job_id = create_job("pagesjaunes_cm", query, location, d)
    threading.Thread(
        target=run_spider,
        args=("pagesjaunes_cm", {
            "query":       query,
            "location":    location,
            "category":    category or "",
            "max_results": max_r,
        }, job_id),
        daemon=True
    ).start()

    return jsonify({
        "success":     True,
        "job_id":      job_id,
        "spider":      "pagesjaunes_cm",
        "query":       query,
        "location":    location,
        "category":    category,
        "max_results": max_r,
    }), 202


# ── Statut d'un job ──────────────────────────────────────
@app.get("/api/scrape/status/<job_id>")
@require_key
def scrape_status(job_id):
    conn = get_db(); cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT * FROM scrape_jobs WHERE id=%s", (job_id,))
    job = cur.fetchone(); cur.close(); conn.close()
    if not job:
        return jsonify({"error": "Job non trouvé"}), 404
    return jsonify(dict(job))


# ── Liste des jobs ───────────────────────────────────────
@app.get("/api/scrape/jobs")
@require_key
def list_jobs():
    conn = get_db(); cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT * FROM scrape_jobs ORDER BY created_at DESC LIMIT 50")
    jobs = cur.fetchall(); cur.close(); conn.close()
    return jsonify({"jobs": [dict(j) for j in jobs]})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)