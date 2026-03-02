# 🚀 Prospection System — lumoradata.com

Système de prospection automatisée adapté à votre infra existante.

## Infra cible

| Service | Container | Réseau | Port |
|---------|-----------|--------|------|
| PostgreSQL | `pg-db-1` (existant) | `pg_default` | 5432 |
| n8n | `n8n-n8n-1` (existant) | `n8n_default` | 5678 → https://n8n.lumoradata.com |
| **Redis** | `prospection-redis` (nouveau) | `prospection-net` | 6379 (interne) |
| **WAHA** | `prospection-waha` (nouveau) | `prospection-net` | **3005** (3000 occupé) |
| **Scraper** | `prospection-scraper` (nouveau) | `prospection-net` + `pg_default` | 5000 (interne) |
| **Backend** | `prospection-backend` (nouveau) | `prospection-net` + `pg_default` + `n8n_default` | 4000 (interne) |
| Dashboard | Nginx → 3000 | host | https://dashboard.lumoradata.com |

---

## ⚡ Installation en 5 étapes

### 1. Déployer sur le VPS

```bash
# Sur votre machine locale
scp -r prospection-lumora/ lumora@vmi2792705:/opt/

# Sur le VPS
cd /opt/prospection-lumora
cp .env.example .env
nano .env
```

**Variables critiques à renseigner dans `.env` :**
```bash
POSTGRES_PASSWORD=<mot_de_passe_fort>        # pour le nouvel user prospection_user
POSTGRES_ADMIN_PASS=<mdp_admin_pg_existant>  # pour créer la base
WAHA_API_KEY=<clé_secrète_waha>
JWT_SECRET=<64_chars_aléatoires>
SENDER_NAME=<votre_prénom>
SENDER_COMPANY=<votre_société>
```

### 2. Lancer l'init

```bash
chmod +x scripts/*.sh
sudo bash scripts/init.sh
```

Le script va automatiquement :
- Vérifier `pg-db-1` et `n8n-n8n-1` sont en cours
- Créer l'user `prospection_user` et la base `prospection` dans `pg-db-1`
- Appliquer le schéma SQL et les données initiales
- Builder les images Docker et démarrer les services
- Générer la config Nginx pour `dashboard.lumoradata.com/api`

### 3. Configurer Nginx

```bash
# Le script génère la config, appliquez-la :
sudo nginx -t && sudo systemctl reload nginx

# SSL si pas encore sur dashboard.lumoradata.com :
sudo certbot --nginx -d dashboard.lumoradata.com
```

### 4. Ajouter un numéro WhatsApp

```bash
bash scripts/add-whatsapp-number.sh session1 +237612345678
# Scannez le QR Code avec WhatsApp → Appareils connectés
```

### 5. Importer les workflows n8n

1. Ouvrir **https://n8n.lumoradata.com**
2. Menu → **Workflows** → **Import from File**
3. Importer dans l'ordre :
   ```
   n8n/workflows/01-scraping-orchestration.json
   n8n/workflows/02-qualification-leads.json
   n8n/workflows/03-whatsapp-sending.json
   n8n/workflows/04-followups.json
   ```
4. Dans chaque workflow, configurer la **credential PostgreSQL** :
   - Type : PostgreSQL
   - Host : `pg-db-1`
   - Port : `5432`
   - Database : `prospection`
   - User : `prospection_user`
   - Password : (votre `POSTGRES_PASSWORD`)

---

## 🔌 Points d'accès

```
Dashboard :  https://dashboard.lumoradata.com
API Backend: https://dashboard.lumoradata.com/api
  ou local:  http://127.0.0.1:4000
n8n :        https://n8n.lumoradata.com
WAHA API :   http://127.0.0.1:3005/api  (local uniquement)
WAHA Swagger:http://127.0.0.1:3005/api  (local uniquement)
```

---

## 📡 API Backend — Exemples

```bash
# Stats dashboard
curl https://dashboard.lumoradata.com/api/stats/dashboard

# Lancer un scraping
curl -X POST https://dashboard.lumoradata.com/api/scraper/google-maps \
  -H "Content-Type: application/json" \
  -d '{"query":"restaurant","location":"Yaoundé, Cameroun","max_results":50}'

# Leads qualifiés avec téléphone WA
curl "https://dashboard.lumoradata.com/api/companies?status=qualified&has_phone=true"

# Statut numéros WhatsApp
curl https://dashboard.lumoradata.com/api/whatsapp/numbers
```

---

## 🕐 Crons à activer

```bash
crontab -e
```

```cron
# Reset journalier WhatsApp (minuit)
0 0 * * * cd /opt/prospection-lumora && node cron/wa_manager.js >> logs/cron.log 2>&1

# Backup PostgreSQL (3h)
0 3 * * * docker exec pg-db-1 pg_dump -U prospection_user prospection > /opt/backups/prospection_$(date +\%Y\%m\%d).sql
```

---

## 🐛 Debug rapide

```bash
# Logs en temps réel
docker logs prospection-backend -f
docker logs prospection-waha    -f
docker logs prospection-scraper -f
docker logs prospection-redis   -f

# Vérifier connexion PostgreSQL depuis backend
docker exec prospection-backend node -e "require('./utils/db').query('SELECT COUNT(*) FROM companies').then(r=>console.log('DB OK:', r.rows[0]))"

# Vérifier WAHA (port 3005 depuis l'hôte)
curl http://127.0.0.1:3005/api/health -H "X-Api-Key: $(grep WAHA_API_KEY .env | cut -d= -f2)"

# Stats PostgreSQL depuis pg-db-1
docker exec pg-db-1 psql -U prospection_user -d prospection -c "SELECT * FROM vw_dashboard_stats;"
```

---

## 🛡️ Warmup WhatsApp progressif

| Jours | Limite/jour |
|-------|-------------|
| 1-7   | 20 messages |
| 8-14  | 40 messages |
| 15-21 | 80 messages |
| 22-30 | 150 messages|
| 31+   | 300 messages|

Délai entre messages : **aléatoire 30-120 secondes** (configurable dans `.env`).
