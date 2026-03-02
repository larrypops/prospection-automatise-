#!/bin/bash
# ═══════════════════════════════════════════════════════════
# LUMORA — Test rapide d'un spider spécifique
# Usage : ./test_spider.sh [google_maps|pagesjaunes|meta_ads] [query] [location]
# Ex    : ./test_spider.sh google_maps "coiffeur" "Douala"
# ═══════════════════════════════════════════════════════════

[ -f .env ] && export $(grep -v '^#' .env | grep -v '^$' | xargs)

SPIDER="${1:-google_maps}"
QUERY="${2:-restaurant}"
LOCATION="${3:-Yaoundé, Cameroun}"
API_KEY="${SCRAPER_API_KEY:-scraper_secret_change_me}"
BASE="http://localhost:5000"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

echo -e "\n${BLUE}▶ Test spider: ${SPIDER} | query=\"${QUERY}\" | location=\"${LOCATION}\"${NC}\n"

# Construire le payload selon le spider
case "$SPIDER" in
  google_maps)
    ENDPOINT="${BASE}/api/scrape/google-maps"
    PAYLOAD="{\"query\":\"${QUERY}\",\"location\":\"${LOCATION}\",\"max_results\":5}"
    ;;
  pagesjaunes)
    ENDPOINT="${BASE}/api/scrape/pagesjaunes"
    PAYLOAD="{\"query\":\"${QUERY}\",\"location\":\"$(echo ${LOCATION} | tr '[:upper:]' '[:lower:]' | tr ' ' '-')\",\"max_results\":20}"
    ;;
  meta_ads)
    ENDPOINT="${BASE}/api/scrape/meta-ads"
    PAYLOAD="{\"query\":\"${QUERY}\",\"location\":\"${LOCATION}\",\"country_code\":\"CM\",\"max_results\":10}"
    ;;
  *)
    echo -e "${RED}Spider inconnu: ${SPIDER}${NC}"
    echo "Disponibles: google_maps, pagesjaunes, meta_ads"
    exit 1
    ;;
esac

# Lancer le job
echo -e "${BLUE}POST ${ENDPOINT}${NC}"
echo -e "${BLUE}Payload: ${PAYLOAD}${NC}\n"

RESPONSE=$(curl -s -X POST "$ENDPOINT" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

echo "Réponse API: $RESPONSE"

JOB_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('job_id',''))" 2>/dev/null)

if [ -z "$JOB_ID" ]; then
  echo -e "\n${RED}Pas de job_id — vérifier que le container scraper tourne:${NC}"
  echo "  docker ps | grep scraper"
  echo "  docker logs prospection-scraper --tail 20"
  exit 1
fi

echo -e "\n${GREEN}Job lancé: ${JOB_ID}${NC}"
echo -e "Logs en direct: ${YELLOW}docker logs prospection-scraper -f${NC}\n"

# Polling status toutes les 10s
echo "Polling status..."
for i in $(seq 1 18); do  # max 3 minutes
  sleep 10
  STATUS=$(curl -s -H "X-API-Key: ${API_KEY}" "${BASE}/api/scrape/status/${JOB_ID}")
  JOB_STATUS=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
  LEADS=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('leads_found',0))" 2>/dev/null)
  
  printf "[%ds] status=%-10s leads=%s\n" "$((i*10))" "$JOB_STATUS" "$LEADS"
  
  case "$JOB_STATUS" in
    done)
      echo -e "\n${GREEN}✓ Spider terminé ! ${LEADS} leads collectés${NC}"
      # Afficher les derniers leads en DB
      echo -e "\nDerniers leads insérés:"
      docker exec pg-db-1 psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
        -c "SELECT name, phone_whatsapp, city FROM companies ORDER BY created_at DESC LIMIT 5;" 2>/dev/null || true
      exit 0
      ;;
    failed)
      echo -e "\n${RED}✗ Spider échoué !${NC}"
      ERROR=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error_message',''))" 2>/dev/null)
      echo -e "${RED}Erreur: ${ERROR}${NC}"
      echo -e "\nLogs complets:"
      docker logs prospection-scraper --tail 50 2>&1
      exit 1
      ;;
  esac
done

echo -e "\n${YELLOW}⚠ Timeout — spider toujours en cours après 3min${NC}"
echo "Continuer à surveiller avec: docker logs prospection-scraper -f"
