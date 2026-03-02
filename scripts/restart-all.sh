#!/bin/bash
# ═══════════════════════════════════════════════════════════
# Script de redémarrage complet avec rechargement .env + config
# ═══════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DOCKER_DIR="$PROJECT_ROOT/docker"

cd "$DOCKER_DIR"

echo "═══════════════════════════════════════════════════════════"
echo "  🔄 REDÉMARRAGE COMPLET DU SYSTÈME"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── 1. Vérifier que .env existe ───────────────────────────
if [ ! -f "$PROJECT_ROOT/.env" ]; then
    echo "❌ Fichier .env manquant !"
    echo "   Copiez: cp $PROJECT_ROOT/.env.example $PROJECT_ROOT/.env"
    exit 1
fi

echo "✅ Fichier .env trouvé"
echo ""

# ── 2. Charger les variables d'environnement ──────────────
echo "📋 Chargement des variables d'environnement..."
export $(grep -v '^#' "$PROJECT_ROOT/.env" | xargs)
echo "   DOMAIN: $DOMAIN"
echo "   WAHA_PORT: $WAHA_PORT"
echo "   BACKEND_PORT: $BACKEND_PORT"
echo "   SCRAPER_PORT: $SCRAPER_PORT"
echo ""

# ── 3. Arrêter les conteneurs ─────────────────────────────
echo "🛑 Arrêt des conteneurs..."
docker-compose down --remove-orphans
echo "   ✅ Conteneurs arrêtés"
echo ""

# ── 4. Supprimer les images pour forcer le rebuild ────────
echo "🗑️  Suppression des images existantes..."
docker rmi prospection-backend:latest prospection-scraper:latest 2>/dev/null || true
echo "   ✅ Images supprimées"
echo ""

# ── 5. Nettoyer le cache de build ─────────────────────────
echo "🧹 Nettoyage du cache Docker..."
docker builder prune -f
echo "   ✅ Cache nettoyé"
echo ""

# ── 6. Rebuild avec --no-cache ────────────────────────────
echo "🔨 Rebuild des images (sans cache)..."
docker-compose build --no-cache
echo "   ✅ Images rebuildées"
echo ""

# ── 7. Démarrer les conteneurs ────────────────────────────
echo "🚀 Démarrage des conteneurs..."
docker-compose up -d
echo "   ✅ Conteneurs démarrés"
echo ""

# ── 8. Attendre que les services soient prêts ─────────────
echo "⏳ Attente du démarrage des services..."
echo ""

# Attendre Redis
echo "   Attente Redis..."
for i in {1..30}; do
    if docker exec prospection-redis redis-cli -a "$REDIS_PASSWORD" ping 2>/dev/null | grep -q PONG; then
        echo "   ✅ Redis prêt"
        break
    fi
    sleep 1
    if [ $i -eq 30 ]; then
        echo "   ⚠️  Redis ne répond pas"
    fi
done

# Attendre WAHA
echo "   Attente WAHA..."
for i in {1..30}; do
    if curl -s http://localhost:$WAHA_PORT/api/health > /dev/null 2>&1; then
        echo "   ✅ WAHA prêt (port $WAHA_PORT)"
        break
    fi
    sleep 1
    if [ $i -eq 30 ]; then
        echo "   ⚠️  WAHA ne répond pas"
    fi
done

# Attendre Backend
echo "   Attente Backend..."
for i in {1..30}; do
    if curl -s http://localhost:$BACKEND_PORT/api/whatsapp/numbers > /dev/null 2>&1; then
        echo "   ✅ Backend prêt (port $BACKEND_PORT)"
        break
    fi
    sleep 1
    if [ $i -eq 30 ]; then
        echo "   ⚠️  Backend ne répond pas"
    fi
done

# Attendre Scraper
echo "   Attente Scraper..."
for i in {1..30}; do
    if curl -s http://localhost:$SCRAPER_PORT/health > /dev/null 2>&1; then
        echo "   ✅ Scraper prêt (port $SCRAPER_PORT)"
        break
    fi
    sleep 1
    if [ $i -eq 30 ]; then
        echo "   ⚠️  Scraper ne répond pas"
    fi
done

echo ""

# ── 9. Vérifier les variables dans les conteneurs ───────
echo "🔍 Vérification des variables d'environnement..."
echo ""
echo "   Backend - WAHA_URL:"
docker exec prospection-backend printenv WAHA_URL 2>/dev/null || echo "   ⚠️  Non défini"
echo ""
echo "   Scraper - DATABASE_URL:"
docker exec prospection-scraper printenv DATABASE_URL 2>/dev/null | cut -d'@' -f2 | cut -d':' -f1 || echo "   ⚠️  Non défini"
echo ""

# ── 10. Afficher le statut ───────────────────────────────
echo "═══════════════════════════════════════════════════════════"
echo "  📊 STATUT DES SERVICES"
echo "═══════════════════════════════════════════════════════════"
echo ""
docker-compose ps
echo ""

# ── 11. Logs initiaux ─────────────────────────────────────
echo "═══════════════════════════════════════════════════════════"
echo "  📜 LOGS RÉCENTS"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "🔴 Backend (5 dernières lignes):"
docker logs --tail 5 prospection-backend 2>&1 | tail -5
echo ""
echo "🔴 Scraper (5 dernières lignes):"
docker logs --tail 5 prospection-scraper 2>&1 | tail -5
echo ""

# ── 12. Résumé ────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════"
echo "  ✅ REDÉMARRAGE TERMINÉ"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "🔗 URLs de test:"
echo "   WAHA:     http://localhost:$WAHA_PORT"
echo "   Backend:  http://localhost:$BACKEND_PORT"
echo "   Scraper:  http://localhost:$SCRAPER_PORT"
echo ""
echo "📋 Commandes utiles:"
echo "   Logs temps réel:  docker-compose logs -f"
echo "   Logs backend:     docker logs -f prospection-backend"
echo "   Test webhook:     ./scripts/test-webhook.sh"
echo "   Redis CLI:        docker exec -it prospection-redis redis-cli -a $REDIS_PASSWORD"
echo ""
