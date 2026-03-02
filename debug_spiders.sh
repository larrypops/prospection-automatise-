#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# LUMORA — Script de debug complet des spiders
# Usage : chmod +x debug_spiders.sh && ./debug_spiders.sh
# À lancer depuis le dossier : prospection-lumora/
# ═══════════════════════════════════════════════════════════════

set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[⚠]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; }
info() { echo -e "${BLUE}[→]${NC} $1"; }
sep()  { echo -e "\n${BLUE}══════════════════════════════════════${NC}"; }

echo -e "\n${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   LUMORA — Spider Debug Suite             ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}\n"

# ── Charger les vars d'env ──────────────────────────────────
if [ -f .env ]; then
  export $(grep -v '^#' .env | grep -v '^$' | xargs)
  ok ".env chargé"
else
  err ".env introuvable ! Lance ce script depuis prospection-lumora/"
  exit 1
fi

API_KEY="${SCRAPER_API_KEY:-scraper_secret_change_me}"
SCRAPER_URL="http://localhost:5000"

# ═══════════════════════════════════════════════════════════
# ÉTAPE 1 — VÉRIFICATION CONTAINERS
# ═══════════════════════════════════════════════════════════
sep
echo "ÉTAPE 1 — Containers Docker"
sep

info "Containers actifs :"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E "NAME|prospection|pg-db|redis|n8n|waha" || true

echo ""
for container in prospection-scraper prospection-redis prospection-backend prospection-waha; do
  if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
    ok "$container — running"
  else
    err "$container — NOT RUNNING"
  fi
done

# ═══════════════════════════════════════════════════════════
# ÉTAPE 2 — HEALTH CHECK API FLASK
# ═══════════════════════════════════════════════════════════
sep
echo "ÉTAPE 2 — Health Check API Scraper (:5000)"
sep

HEALTH=$(curl -sf "${SCRAPER_URL}/health" 2>&1) && ok "Health: $HEALTH" || {
  err "API Flask inaccessible sur :5000"
  info "Logs du container scraper :"
  docker logs prospection-scraper --tail 30 2>&1 || true
  exit 1
}

# ═══════════════════════════════════════════════════════════
# ÉTAPE 3 — TEST AUTH API
# ═══════════════════════════════════════════════════════════
sep
echo "ÉTAPE 3 — Test authentification API"
sep

# Sans clé → doit retourner 401
CODE=$(curl -s -o /dev/null -w "%{http_code}" "${SCRAPER_URL}/api/scrape/jobs")
[ "$CODE" = "401" ] && ok "Auth sans clé → 401 (correct)" || warn "Auth sans clé → $CODE (attendu 401)"

# Avec bonne clé → doit retourner 200
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "X-API-Key: ${API_KEY}" "${SCRAPER_URL}/api/scrape/jobs")
[ "$CODE" = "200" ] && ok "Auth avec clé → 200 (correct)" || err "Auth avec clé → $CODE (attendu 200)"

# ═══════════════════════════════════════════════════════════
# ÉTAPE 4 — TEST CONNECTIVITÉ REDIS
# ═══════════════════════════════════════════════════════════
sep
echo "ÉTAPE 4 — Redis (dédup pipeline)"
sep

REDIS_PING=$(docker exec prospection-redis redis-cli -a "${REDIS_PASSWORD}" ping 2>/dev/null) || REDIS_PING="FAIL"
[ "$REDIS_PING" = "PONG" ] && ok "Redis répond: PONG" || err "Redis inaccessible: $REDIS_PING"

info "Clés scrapy:seen dans Redis (doublons connus) :"
COUNT=$(docker exec prospection-redis redis-cli -a "${REDIS_PASSWORD}" keys "scrapy:seen:*" 2>/dev/null | wc -l)
ok "$COUNT entrées dedup en cache"

# ═══════════════════════════════════════════════════════════
# ÉTAPE 5 — TEST CONNECTIVITÉ POSTGRESQL
# ═══════════════════════════════════════════════════════════
sep
echo "ÉTAPE 5 — PostgreSQL (pipeline stockage)"
sep

PG_TEST=$(docker exec pg-db-1 psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -c "SELECT COUNT(*) FROM companies;" -t 2>&1) || PG_TEST="FAIL"
if echo "$PG_TEST" | grep -qE "^[[:space:]]*[0-9]"; then
  COUNT=$(echo "$PG_TEST" | tr -d ' ')
  ok "Table companies accessible — $COUNT leads stockés"
else
  err "Erreur PostgreSQL: $PG_TEST"
  info "Vérif tables :"
  docker exec pg-db-1 psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -c "\dt" 2>&1 || true
fi

# Vérif table scrape_jobs
JOBS_TEST=$(docker exec pg-db-1 psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -c "SELECT COUNT(*) FROM scrape_jobs;" -t 2>&1) || JOBS_TEST="FAIL"
if echo "$JOBS_TEST" | grep -qE "^[[:space:]]*[0-9]"; then
  COUNT=$(echo "$JOBS_TEST" | tr -d ' ')
  ok "Table scrape_jobs — $COUNT jobs au total"
else
  err "Table scrape_jobs manquante: $JOBS_TEST"
fi

# ═══════════════════════════════════════════════════════════
# ÉTAPE 6 — LANCER UN JOB GOOGLE MAPS (test réel)
# ═══════════════════════════════════════════════════════════
sep
echo "ÉTAPE 6 — Lancer spider Google Maps (5 résultats max)"
sep

info "POST /api/scrape/google-maps ..."
RESPONSE=$(curl -s -X POST "${SCRAPER_URL}/api/scrape/google-maps" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"query":"restaurant","location":"Yaoundé, Cameroun","max_results":5}')

echo "Réponse: $RESPONSE"
JOB_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('job_id',''))" 2>/dev/null)

if [ -n "$JOB_ID" ]; then
  ok "Job créé: $JOB_ID"
  info "Suivi du job (attente 10s)..."
  sleep 10
  STATUS=$(curl -s -H "X-API-Key: ${API_KEY}" "${SCRAPER_URL}/api/scrape/status/${JOB_ID}")
  echo "Status: $STATUS"
  
  JOB_STATUS=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null)
  case "$JOB_STATUS" in
    running) info "Spider en cours d'exécution..." ;;
    done)    ok "Spider terminé avec succès !" ;;
    failed)  
      err "Spider échoué !"
      ERROR=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error_message',''))" 2>/dev/null)
      err "Erreur: $ERROR"
      ;;
    pending) warn "Job encore en attente (pending)" ;;
    *)       warn "Status inconnu: $JOB_STATUS" ;;
  esac
else
  err "Pas de job_id dans la réponse"
fi

# ═══════════════════════════════════════════════════════════
# ÉTAPE 7 — LANCER UN JOB PAGESJAUNES
# ═══════════════════════════════════════════════════════════
sep
echo "ÉTAPE 7 — Lancer spider PagesJaunes CM (restaurants Yaoundé)"
sep

RESPONSE=$(curl -s -X POST "${SCRAPER_URL}/api/scrape/pagesjaunes" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"query":"restaurant","location":"yaounde","category":"restaurants","max_results":20}')

echo "Réponse: $RESPONSE"
JOB_ID2=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('job_id',''))" 2>/dev/null)
[ -n "$JOB_ID2" ] && ok "Job PagesJaunes créé: $JOB_ID2" || err "Échec création job PagesJaunes"

# ═══════════════════════════════════════════════════════════
# ÉTAPE 8 — LANCER UN JOB META ADS
# ═══════════════════════════════════════════════════════════
sep
echo "ÉTAPE 8 — Lancer spider Meta Ads (test léger)"
sep

RESPONSE=$(curl -s -X POST "${SCRAPER_URL}/api/scrape/meta-ads" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"query":"restaurant","location":"Cameroun","country_code":"CM","max_results":10}')

echo "Réponse: $RESPONSE"
JOB_ID3=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('job_id',''))" 2>/dev/null)
[ -n "$JOB_ID3" ] && ok "Job Meta Ads créé: $JOB_ID3" || err "Échec création job Meta Ads"

# ═══════════════════════════════════════════════════════════
# ÉTAPE 9 — ATTENDRE ET VÉRIFIER RÉSULTATS
# ═══════════════════════════════════════════════════════════
sep
echo "ÉTAPE 9 — Attente résultats (90s)"
sep

info "En attente... (Ctrl+C pour passer)"
sleep 90

info "Statut des jobs lancés :"
for JID in "$JOB_ID" "$JOB_ID2" "$JOB_ID3"; do
  [ -z "$JID" ] && continue
  S=$(curl -s -H "X-API-Key: ${API_KEY}" "${SCRAPER_URL}/api/scrape/status/${JID}")
  echo "$S" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(f\"  Job {d.get('id','?')[:8]}... | source={d.get('source')} | status={d.get('status')} | leads={d.get('leads_found',0)} | duration={d.get('duration_sec','?')}s\")
if d.get('error_message'):
    print(f\"  ERR: {d.get('error_message','')[:200]}\")
" 2>/dev/null
done

# ═══════════════════════════════════════════════════════════
# ÉTAPE 10 — VÉRIFIER LES LEADS EN BASE
# ═══════════════════════════════════════════════════════════
sep
echo "ÉTAPE 10 — Leads collectés en PostgreSQL"
sep

docker exec pg-db-1 psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -c "
  SELECT source, COUNT(*) as total, 
         COUNT(phone_whatsapp) as avec_whatsapp,
         COUNT(email) as avec_email
  FROM companies 
  GROUP BY source 
  ORDER BY total DESC;
" 2>&1 || true

echo ""
info "Derniers leads insérés :"
docker exec pg-db-1 psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -c "
  SELECT name, phone_whatsapp, city, source, created_at::date
  FROM companies 
  ORDER BY created_at DESC 
  LIMIT 10;
" 2>&1 || true

# ═══════════════════════════════════════════════════════════
# ÉTAPE 11 — LOGS SCRAPER (erreurs éventuelles)
# ═══════════════════════════════════════════════════════════
sep
echo "ÉTAPE 11 — Logs du container scraper (dernières 50 lignes)"
sep

docker logs prospection-scraper --tail 50 2>&1

# ═══════════════════════════════════════════════════════════
# RÉSUMÉ
# ═══════════════════════════════════════════════════════════
sep
echo "RÉSUMÉ"
sep

echo ""
echo -e "${GREEN}Script terminé.${NC}"
echo ""
echo "Pour suivre un job en temps réel :"
echo "  docker logs prospection-scraper -f"
echo ""
echo "Pour relancer un spider manuellement :"
echo "  curl -s -X POST http://localhost:5000/api/scrape/google-maps \\"
echo "    -H 'X-API-Key: ${API_KEY}' \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"query\":\"hotel\",\"location\":\"Douala\",\"max_results\":20}'"
echo ""
