#!/bin/bash
# ═══════════════════════════════════════════════════════════
# PROSPECTION SYSTEM - Init adapté à lumoradata.com
# Usage : cd /opt/prospection-lumora && bash scripts/init.sh
# ═══════════════════════════════════════════════════════════
set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

log()  { echo -e "${GREEN}[✓] $1${NC}"; }
info() { echo -e "${BLUE}[→] $1${NC}"; }
warn() { echo -e "${YELLOW}[!] $1${NC}"; }
err()  { echo -e "${RED}[✗] $1${NC}"; exit 1; }

echo -e "${GREEN}"
cat << 'EOF'
  ██╗     ██╗   ██╗███╗   ███╗ ██████╗ ██████╗  █████╗
  ██║     ██║   ██║████╗ ████║██╔═══██╗██╔══██╗██╔══██╗
  ██║     ██║   ██║██╔████╔██║██║   ██║██████╔╝███████║
  ██║     ██║   ██║██║╚██╔╝██║██║   ██║██╔══██╗██╔══██║
  ███████╗╚██████╔╝██║ ╚═╝ ██║╚██████╔╝██║  ██║██║  ██║
  PROSPECTION SYSTEM — lumoradata.com
EOF
echo -e "${NC}"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
log "Répertoire : $PROJECT_DIR"

# ── Prérequis ─────────────────────────────────────────────
command -v docker >/dev/null       || err "Docker non installé"
command -v docker-compose >/dev/null 2>&1 || \
  docker compose version >/dev/null 2>&1 || err "Docker Compose non installé"

# Alias compose
COMPOSE="docker compose -f docker/docker-compose.yml --env-file .env"
command -v docker-compose >/dev/null 2>&1 && COMPOSE="docker-compose -f docker/docker-compose.yml --env-file .env"

# ── Fichier .env ───────────────────────────────────────────
if [ ! -f .env ]; then
    cp .env.example .env
    warn "Fichier .env créé — ÉDITEZ-LE MAINTENANT avant de continuer :"
    warn "  nano .env"
    warn "  → POSTGRES_PASSWORD (mot de passe admin PostgreSQL existant)"
    warn "  → POSTGRES_ADMIN_PASS (pour créer la base prospection)"
    warn "  → WAHA_API_KEY, JWT_SECRET, SCRAPER_API_KEY"
    echo ""
    read -rp "Appuyez sur Entrée après avoir configuré .env..."
fi
source .env

# ── Vérification containers existants ─────────────────────
info "Vérification des containers existants..."

if ! docker ps --format '{{.Names}}' | grep -q "^pg-db-1$"; then
    err "Container pg-db-1 (PostgreSQL) introuvable. Vérifiez qu'il tourne : docker ps | grep postgres"
fi
log "pg-db-1 détecté ✓"

if ! docker ps --format '{{.Names}}' | grep -q "^n8n-n8n-1$"; then
    warn "Container n8n-n8n-1 non détecté — les webhooks n8n internes ne fonctionneront pas"
else
    log "n8n-n8n-1 détecté ✓"
fi

# ── Vérification réseaux externes ─────────────────────────
info "Vérification réseaux Docker externes..."

docker network ls | grep -q "pg_default"  || err "Réseau pg_default introuvable"
docker network ls | grep -q "n8n_default" || warn "Réseau n8n_default introuvable (OK si n8n pas encore démarré)"
log "Réseaux externes vérifiés ✓"

# ── Création base PostgreSQL + utilisateur ─────────────────
info "Création base de données 'prospection' sur pg-db-1..."

# Créer l'utilisateur et la base via le container PostgreSQL existant
docker exec pg-db-1 psql -U "${POSTGRES_ADMIN_USER:-postgres}" -tc \
    "SELECT 1 FROM pg_roles WHERE rolname='${POSTGRES_USER:-prospection_user}'" | grep -q 1 || \
docker exec pg-db-1 psql -U "${POSTGRES_ADMIN_USER:-postgres}" -c \
    "CREATE USER ${POSTGRES_USER:-prospection_user} WITH PASSWORD '${POSTGRES_PASSWORD}';" 2>/dev/null && \
log "Utilisateur PostgreSQL créé" || warn "Utilisateur existe déjà"

docker exec pg-db-1 psql -U "${POSTGRES_ADMIN_USER:-postgres}" -tc \
    "SELECT 1 FROM pg_database WHERE datname='${POSTGRES_DB:-prospection}'" | grep -q 1 || \
docker exec pg-db-1 psql -U "${POSTGRES_ADMIN_USER:-postgres}" -c \
    "CREATE DATABASE ${POSTGRES_DB:-prospection} OWNER ${POSTGRES_USER:-prospection_user};" && \
log "Base 'prospection' créée" || warn "Base existe déjà"

# Appliquer le schéma
info "Application du schéma CRM..."
docker exec -i pg-db-1 psql \
    -U "${POSTGRES_USER:-prospection_user}" \
    -d "${POSTGRES_DB:-prospection}" \
    < database/schema.sql && log "Schéma appliqué ✓"

# Données initiales
info "Insertion données initiales..."
docker exec -i pg-db-1 psql \
    -U "${POSTGRES_USER:-prospection_user}" \
    -d "${POSTGRES_DB:-prospection}" \
    < database/seed.sql && log "Seed appliqué ✓"

# ── Build images ───────────────────────────────────────────
info "Build des images Docker..."
$COMPOSE build --no-cache

# ── Démarrage services ─────────────────────────────────────
info "Démarrage Redis + WAHA + Scraper + Backend..."
$COMPOSE up -d

# ── Attendre que tout soit healthy ─────────────────────────
info "Vérification santé des services..."
sleep 10

for service in redis backend; do
    for i in $(seq 1 12); do
        STATUS=$($COMPOSE ps $service --format json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('Health','unknown'))" 2>/dev/null || echo "unknown")
        if [ "$STATUS" = "healthy" ] || [ "$STATUS" = "running" ]; then
            log "$service : OK"
            break
        fi
        [ $i -eq 12 ] && warn "$service pas encore healthy (vérifiez : $COMPOSE logs $service)"
        sleep 5
    done
done

# ── Config Nginx ───────────────────────────────────────────
info "Configuration Nginx pour api.lumoradata.com..."
bash scripts/setup-nginx.sh

echo ""
log "════════════════════════════════════════"
log "  SYSTÈME DÉMARRÉ AVEC SUCCÈS"
log "════════════════════════════════════════"
echo ""
echo -e "  📊 Dashboard  : ${GREEN}https://dashboard.lumoradata.com${NC}"
echo -e "  🔌 API        : ${GREEN}https://api.lumoradata.com${NC}"
echo -e "  🤖 n8n        : ${GREEN}https://n8n.lumoradata.com${NC}"
echo -e "  📱 WAHA API   : ${GREEN}http://127.0.0.1:3005/api${NC} (local)"
echo -e "  🔌 Backend    : ${GREEN}http://127.0.0.1:4000${NC} (local)"
echo ""
warn "Étape suivante : Ajouter un numéro WhatsApp"
warn "  bash scripts/add-whatsapp-number.sh session1 +237XXXXXXXXX"
echo ""
warn "Étape suivante : Importer les workflows dans n8n"
warn "  https://n8n.lumoradata.com → Import from File → n8n/workflows/*.json"
