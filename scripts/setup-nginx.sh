#!/bin/bash
# ═══════════════════════════════════════════════════════
# Setup Nginx — api.lumoradata.com (backend) séparé de dashboard
# ═══════════════════════════════════════════════════════
set -e
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

BACKEND_PORT="${BACKEND_PORT:-4000}"
API_CONF="/etc/nginx/sites-available/api.lumoradata.com"

echo -e "${YELLOW}[→] Création vhost api.lumoradata.com → backend:${BACKEND_PORT}...${NC}"

cat > /tmp/api-lumoradata.conf << NGINXEOF
# ═══════════════════════════════════════════════════════
# api.lumoradata.com — Backend Prospection System
# ═══════════════════════════════════════════════════════

server {
    listen 80;
    server_name api.lumoradata.com;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name api.lumoradata.com;

    # SSL (Certbot remplira ces lignes automatiquement)
    # ssl_certificate /etc/letsencrypt/live/api.lumoradata.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/api.lumoradata.com/privkey.pem;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    access_log /var/log/nginx/api.lumoradata.access.log;
    error_log  /var/log/nginx/api.lumoradata.error.log;

    location / {
        proxy_pass http://127.0.0.1:${BACKEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout    300s;
        proxy_connect_timeout 10s;

        add_header Access-Control-Allow-Origin  "https://dashboard.lumoradata.com" always;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Authorization, Content-Type, X-API-Key" always;
        add_header Access-Control-Allow-Credentials "true" always;

        if (\$request_method = OPTIONS) {
            add_header Access-Control-Allow-Origin  "https://dashboard.lumoradata.com";
            add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS";
            add_header Access-Control-Allow-Headers "Authorization, Content-Type, X-API-Key";
            add_header Access-Control-Max-Age 86400;
            return 204;
        }
    }

    location = /health {
        proxy_pass http://127.0.0.1:${BACKEND_PORT}/health;
        access_log off;
    }
}
NGINXEOF

echo -e "${GREEN}Config générée :${NC}"
cat /tmp/api-lumoradata.conf
echo ""

if [ "$(id -u)" = "0" ]; then
    read -rp "Appliquer maintenant ? [o/N] " APPLY
    if [[ "$APPLY" =~ ^[oO]$ ]]; then
        cp /tmp/api-lumoradata.conf "$API_CONF"
        ln -sf "$API_CONF" /etc/nginx/sites-enabled/api.lumoradata.com
        nginx -t || { echo -e "${RED}Erreur Nginx${NC}"; exit 1; }
        systemctl reload nginx
        echo -e "${GREEN}[✓] Nginx rechargé${NC}"
        certbot --nginx -d api.lumoradata.com --non-interactive --agree-tos \
            -m "admin@lumoradata.com" 2>/dev/null \
        && echo -e "${GREEN}[✓] SSL OK${NC}" \
        || echo -e "${YELLOW}[!] Lancez : sudo certbot --nginx -d api.lumoradata.com${NC}"
    fi
else
    echo -e "${YELLOW}En tant que root :${NC}"
    echo "  sudo cp /tmp/api-lumoradata.conf /etc/nginx/sites-available/api.lumoradata.com"
    echo "  sudo ln -sf /etc/nginx/sites-available/api.lumoradata.com /etc/nginx/sites-enabled/"
    echo "  sudo nginx -t && sudo systemctl reload nginx"
    echo "  sudo certbot --nginx -d api.lumoradata.com"
fi

echo ""
echo -e "${GREEN}Backend sur : https://api.lumoradata.com${NC}"
echo -e "${GREEN}Dashboard inchangé : https://dashboard.lumoradata.com${NC}"
