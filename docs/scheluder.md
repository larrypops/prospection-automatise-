# Scheduler - Service de planification automatique

## Vue d'ensemble

Le **scheduler** est un service Node.js autonome qui remplace n8n pour l'automatisation des tâches de prospection. Il exécute 3 crons quotidiens pour scraper des leads, envoyer des messages WhatsApp et gérer les relances.

## Architecture

```
scheduler/
├── index.js          # Point d'entrée, orchestration des crons
├── logger.js         # Winston logger (logs dans /app/logs/)
├── package.json      # Dépendances: axios, node-cron, pg, winston
├── Dockerfile        # Image Node.js 20-alpine
└── jobs/
    ├── scraping.js   # Cron 1: Scraping Google Maps & Meta Ads
    ├── sending.js    # Cron 2: Envoi WhatsApp first contact
    └── followup.js   # Cron 3: Relances automatiques
```

## Crons programmés

### 1. Scraping (`jobs/scraping.js`)

**Horaire:** 3h00 du matin, lundi au samedi

**Fonctionnement:**
- Sélectionne aléatoirement 10 catégories parmi 50 (écoles, cliniques, restaurants, etc.)
- Pour chaque catégorie, choisit une ville aléatoire (Yaoundé, Douala, Bafoussam, Kribi, Garoua)
- Lance des jobs Google Maps (max 150 résultats) et Meta Ads (max 50 résultats)
- Attend la fin de chaque job avec polling toutes les 2 minutes (timeout 30 min)
- Pause de 30 secondes entre chaque job pour ne pas surcharger le scraper

**API utilisée:**
```
POST /api/scraper/google-maps
POST /api/scraper/meta-ads
GET  /api/scraper/status/:jobId
```

### 2. Envoi WhatsApp (`jobs/sending.js`)

**Horaire:** 8h00 du matin, lundi au samedi

**Fonctionnement:**
- Récupère les leads avec `has_whatsapp=true` via `/api/companies/new?has_whatsapp=true&limit=20`
- Pour chaque lead, construit un message personnalisé avec le nom de l'entreprise
- Envoie via `/api/whatsapp/send` avec `skip_delay: true`
- Gère l'erreur 429 (limite journalière atteinte) en arrêtant immédiatement
- Attend 30-120 secondes aléatoires entre chaque envoi

**Message envoyé:**
```
Bonjour, je suis Larry Mbili de Lumora Data. Je vous contacte car j'analyse
actuellement les entreprises comme {nom_entreprise} afin de les aider à mettre
en place des systèmes automatisés de gestion et de suivi financier...
```

### 3. Follow-up (`jobs/followup.js`)

**Horaire:** 10h00 du matin, lundi au samedi

**Fonctionnement:**
- Requête SQL directe sur PostgreSQL pour trouver les leads à relancer:
  ```sql
  SELECT * FROM companies 
  WHERE status = 'contacted' 
    AND phone_whatsapp IS NOT NULL 
    AND next_followup_at <= NOW()
    AND followup_count < 3
  ```
- Envoie 3 messages de relance selon le `followup_count`:
  - **Relance 1** (J+3): Message de rappel
  - **Relance 2** (J+7): Message avec témoignages
  - **Relance 3** (J+14): Dernier message
- Met à jour `followup_count`, `next_followup_at` et `status` en DB
- Attend 30-120 secondes entre chaque envoi

## Configuration Docker

### Service dans docker-compose.yml

```yaml
scheduler:
  build:
    context: ../scheduler
    dockerfile: Dockerfile
  image: prospection-scheduler:latest
  container_name: prospection-scheduler
  restart: unless-stopped
  environment:
    NODE_ENV: production
    BACKEND_URL: http://prospection-backend:4000
    DATABASE_URL: postgresql://user:pass@pg-db-1:5432/prospection
    WA_MIN_DELAY: 30
    WA_MAX_DELAY: 120
    TZ: Africa/Douala
  volumes:
    - scheduler_logs:/app/logs
  networks:
    - prospection-net
    - pg_default
  depends_on:
    - backend
    - scraper
```

### Variables d'environnement

| Variable | Description | Défaut |
|----------|-------------|--------|
| `BACKEND_URL` | URL du backend API | `http://prospection-backend:4000` |
| `DATABASE_URL` | Connexion PostgreSQL | - |
| `WA_MIN_DELAY` | Délai min entre envois (sec) | 30 |
| `WA_MAX_DELAY` | Délai max entre envois (sec) | 120 |
| `TZ` | Timezone | Africa/Douala |

## Logs

Les logs sont stockés dans `/app/logs/`:
- `scheduler.log` - Logs généraux
- `scheduler-error.log` - Erreurs uniquement

## Commandes utiles

```bash
# Voir les logs en temps réel
docker logs prospection-scheduler -f

# Redémarrer le scheduler
docker compose restart scheduler

# Tester manuellement un job
docker exec prospection-scheduler node -e "require('./jobs/sending')()"

# Vérifier le statut
docker ps | grep scheduler
```

## Sécurité

- Pas de `.env` dans le container (variables via Docker Compose)
- Pas de clés API en dur dans le code
- Connexion au backend via réseau interne Docker
- Accès PostgreSQL via réseau `pg_default`

## Monitoring

Le scheduler vérifie au démarrage:
1. Connexion au backend (`/health`)
2. Affiche un warning si le backend est indisponible
3. Log le début et la fin de chaque cron avec durée d'exécution

## Gestion des erreurs

- **Chevauchement:** Flag `isRunning` pour éviter les exécutions simultanées
- **Timeout:** 30 minutes max par job de scraping
- **Retry:** Polling toutes les 2 minutes pour les jobs scraper
- **Limite WhatsApp:** Arrêt immédiat sur erreur 429
