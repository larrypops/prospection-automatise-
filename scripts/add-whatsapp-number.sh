#!/bin/bash
# ═══════════════════════════════════════════════════════
# Ajouter un numéro WhatsApp dans WAHA (port 3005)
# Usage : bash scripts/add-whatsapp-number.sh <session_name> <+237XXXXXXXXX>
# ═══════════════════════════════════════════════════════
set -e
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'

SESSION="${1:-session1}"
PHONE="${2:-}"
source "$(dirname "$0")/../.env" 2>/dev/null || true

WAHA_URL="http://127.0.0.1:${WAHA_PORT:-3005}"
API_KEY="${WAHA_API_KEY:-waha_secret_key_change_me}"

[ -z "$PHONE" ] && { echo -e "${RED}Usage : $0 <session_name> <+237XXXXXXXXX>${NC}"; exit 1; }

echo -e "${BLUE}═══ Ajout numéro WhatsApp ═══${NC}"
echo "  Session : $SESSION"
echo "  Numéro  : $PHONE"
echo "  WAHA    : $WAHA_URL"
echo ""

# ── 1. Vérifier WAHA ─────────────────────────────────────
echo -e "${YELLOW}[1/5] Vérification WAHA...${NC}"
curl -sf "$WAHA_URL/api/sessions" -H "X-Api-Key: $API_KEY" > /dev/null || {
    echo -e "${RED}WAHA non accessible sur $WAHA_URL${NC}"
    echo "  Vérifiez : docker ps | grep waha"
    exit 1
}
echo -e "${GREEN}  WAHA OK${NC}"

# ── 2. Créer la session ───────────────────────────────────
echo -e "${YELLOW}[2/5] Création session '$SESSION'...${NC}"
curl -sf -X POST "$WAHA_URL/api/sessions" \
    -H "X-Api-Key: $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{
        \"name\": \"$SESSION\",
        \"config\": {
            \"webhooks\": [{
                \"url\": \"http://prospection-backend:4000/api/whatsapp/webhook\",
                \"events\": [\"message\", \"message.ack\", \"session.status\"]
            }]
        }
    }" | python3 -m json.tool 2>/dev/null || echo "  (session peut déjà exister)"

sleep 2

# ── 3. Démarrer la session ────────────────────────────────
echo -e "${YELLOW}[3/5] Démarrage session...${NC}"
curl -sf -X POST "$WAHA_URL/api/sessions/$SESSION/start" \
    -H "X-Api-Key: $API_KEY" > /dev/null 2>&1 || true
sleep 3

# ── 4. Afficher QR Code ───────────────────────────────────
echo -e "${YELLOW}[4/5] Récupération QR Code...${NC}"
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Scannez le QR Code avec WhatsApp                ║${NC}"
echo -e "${GREEN}║  WhatsApp → ⋮ → Appareils connectés              ║${NC}"
echo -e "${GREEN}║                                                    ║${NC}"
echo -e "${GREEN}║  URL QR : $WAHA_URL/api/$SESSION/auth/qr          ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# Afficher QR en ASCII si qrencode disponible
QR_DATA=$(curl -sf "$WAHA_URL/api/$SESSION/auth/qr" \
    -H "X-Api-Key: $API_KEY" 2>/dev/null | \
    python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('value',''))" 2>/dev/null || echo "")

if [ -n "$QR_DATA" ] && command -v qrencode >/dev/null 2>&1; then
    echo "$QR_DATA" | qrencode -t ANSIUTF8
elif [ -n "$QR_DATA" ]; then
    echo -e "${YELLOW}Installez qrencode pour afficher le QR ici :${NC}"
    echo "  sudo apt install qrencode -y"
    echo ""
    echo "  Ou ouvrez dans le navigateur :"
    echo "  $WAHA_URL/api/$SESSION/auth/qr (image PNG)"
fi

# ── 5. Attendre connexion ─────────────────────────────────
echo -e "${YELLOW}[5/5] Attente connexion WhatsApp (120s max)...${NC}"
CONNECTED=false
for i in $(seq 1 24); do
    sleep 5
    STATUS=$(curl -sf "$WAHA_URL/api/sessions/$SESSION" \
        -H "X-Api-Key: $API_KEY" 2>/dev/null | \
        python3 -c "import sys,json; print(json.load(sys.stdin).get('status','unknown'))" 2>/dev/null || echo "unknown")
    
    echo -n "  [$((i*5))s] Status: $STATUS"
    
    if [ "$STATUS" = "WORKING" ]; then
        echo -e " ${GREEN}✅${NC}"
        CONNECTED=true
        break
    else
        echo ""
    fi
done

if [ "$CONNECTED" = "false" ]; then
    echo -e "${RED}Connexion non confirmée — vérifiez le QR sur : $WAHA_URL/api/$SESSION/auth/qr${NC}"
    exit 1
fi

# ── Enregistrement PostgreSQL ─────────────────────────────
echo ""
echo -e "${YELLOW}Enregistrement en base...${NC}"
docker exec pg-db-1 psql \
    -U "${POSTGRES_USER:-prospection_user}" \
    -d "${POSTGRES_DB:-prospection}" \
    -c "INSERT INTO whatsapp_numbers (number, session_name, is_active, daily_limit, warmup_limit, warmup_day)
        VALUES ('$PHONE', '$SESSION', true, 20, 20, 1)
        ON CONFLICT (session_name) DO UPDATE SET
            number = EXCLUDED.number,
            is_active = true,
            daily_limit = 20,
            warmup_day = 1,
            updated_at = NOW();
        SELECT number, session_name, daily_limit, warmup_day FROM whatsapp_numbers WHERE session_name='$SESSION';"

echo ""
echo -e "${GREEN}════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ $SESSION ($PHONE) CONNECTÉ !${NC}"
echo -e "${GREEN}  Limite : 20 messages/jour (warmup)${NC}"
echo -e "${GREEN}════════════════════════════════════${NC}"
