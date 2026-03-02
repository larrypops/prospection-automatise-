#!/bin/bash
# ═══════════════════════════════════════════════════════════
# Script de test du webhook WhatsApp WAHA
# ═══════════════════════════════════════════════════════════

set -e

BACKEND_URL="${BACKEND_URL:-http://localhost:4000}"
WAHA_URL="${WAHA_URL:-http://localhost:3005}"

echo "═══════════════════════════════════════════════════════════"
echo "  🔍 TEST DU WEBHOOK WHATSAPP WAHA"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Backend URL: $BACKEND_URL"
echo "WAHA URL: $WAHA_URL"
echo ""

# ── Test 1: Vérifier que le backend répond ─────────────────
echo "1️⃣  Test de connectivité du backend..."
if curl -s "$BACKEND_URL/api/whatsapp/numbers" > /dev/null 2>&1; then
    echo "   ✅ Backend accessible"
else
    echo "   ❌ Backend inaccessible sur $BACKEND_URL"
    echo "   💡 Essayez: docker logs prospection-backend --tail 20"
    exit 1
fi
echo ""

# ── Test 2: Simuler un événement message.ack ───────────────
echo "2️⃣  Test webhook - message.ack (statut delivered)..."
ACK_RESPONSE=$(curl -s -X POST "$BACKEND_URL/api/whatsapp/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "message.ack",
    "payload": {
      "id": "test_message_12345",
      "ack": 2,
      "chatId": "237696719651@c.us"
    }
  }')
echo "   Réponse: $ACK_RESPONSE"
if echo "$ACK_RESPONSE" | grep -q '"ok":true'; then
    echo "   ✅ Webhook message.ack OK"
else
    echo "   ❌ Webhook message.ack a échoué"
fi
echo ""

# ── Test 3: Simuler un message entrant ────────────────────
echo "3️⃣  Test webhook - message entrant (réponse prospect)..."
MSG_RESPONSE=$(curl -s -X POST "$BACKEND_URL/api/whatsapp/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "message",
    "payload": {
      "id": "incoming_12345",
      "from": "237696719651@c.us",
      "fromMe": false,
      "body": "Bonjour, je suis intéressé par votre offre !",
      "timestamp": '$(date +%s)'
    }
  }')
echo "   Réponse: $MSG_RESPONSE"
if echo "$MSG_RESPONSE" | grep -q '"ok":true'; then
    echo "   ✅ Webhook message entrant OK"
else
    echo "   ❌ Webhook message entrant a échoué"
fi
echo ""

# ── Test 4: Simuler un changement de statut session ───────
echo "4️⃣  Test webhook - session.status..."
SESSION_RESPONSE=$(curl -s -X POST "$BACKEND_URL/api/whatsapp/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "session.status",
    "payload": {
      "session": "default",
      "status": "WORKING"
    }
  }')
echo "   Réponse: $SESSION_RESPONSE"
if echo "$SESSION_RESPONSE" | grep -q '"ok":true'; then
    echo "   ✅ Webhook session.status OK"
else
    echo "   ❌ Webhook session.status a échoué"
fi
echo ""

# ── Test 5: Vérifier les logs du backend ──────────────────
echo "5️⃣  Vérification des logs récents..."
echo "   Logs du backend (10 dernières lignes):"
docker logs prospection-backend --tail 10 2>/dev/null | grep -E "(webhook|WAHA|📥|📨|📩)" || echo "   (pas de logs webhook récents)"
echo ""

# ── Test 6: Vérifier la configuration WAHA ────────────────
echo "6️⃣  Vérification de la configuration WAHA..."
if curl -s "$WAHA_URL/api/sessions" > /dev/null 2>&1; then
    echo "   ✅ WAHA accessible"
    echo ""
    echo "   Sessions actives:"
    curl -s "$WAHA_URL/api/sessions" | jq -r '.[] | "   - \(.name): \(.status)"' 2>/dev/null || echo "   (pas de sessions)"
    echo ""
    
    # Vérifier le webhook configuré dans WAHA
    echo "   Webhook configuré (global):"
    curl -s "$WAHA_URL/api/server/webhooks" | jq '.' 2>/dev/null || echo "   (pas d'info webhook disponible)"
else
    echo "   ❌ WAHA inaccessible sur $WAHA_URL"
    echo "   💡 Vérifiez que le container est démarré: docker ps | grep waha"
fi
echo ""

# ── Résumé ─────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════"
echo "  📊 RÉSUMÉ"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Pour voir les logs en temps réel:"
echo "  docker logs -f prospection-backend | grep -i webhook"
echo ""
echo "Pour tester avec un vrai message WAHA:"
echo "  1. Envoyez un message depuis votre téléphone vers le numéro WA"
echo "  2. Vérifiez les logs: docker logs -f prospection-backend"
echo ""
echo "Pour redémarrer WAHA avec la config webhook:"
echo "  docker restart prospection-waha"
echo ""
