# 📋 Guide pour lancer un job manuellement

## 🚀 Lancement d'un job de scraping

### 1. Via l'API Scraper
```bash
# Lancer un spider Google Maps
curl -X POST "http://localhost:5000/api/scrape/start" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: votre_cle_api" \
  -d '{
    "spider": "google_maps",
    "query": "restaurant",
    "location": "Yaoundé, Cameroun",
    "max_results": 50,
    "job_id": "job_manuel_001"
  }'

# Lancer un spider Meta Ads
curl -X POST "http://localhost:5000/api/scrape/start" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: votre_cle_api" \
  -d '{
    "spider": "meta_ads",
    "query": "école privée",
    "country_code": "CM",
    "max_results": 100,
    "job_id": "job_meta_001"
  }'

# Lancer un spider PagesJaunes
curl -X POST "http://localhost:5000/api/scrape/start" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: votre_cle_api" \
  -d '{
    "spider": "pagesjaunes_cm",
    "category": "restaurants",
    "max_results": 200,
    "job_id": "job_pj_001"
  }'
```

### 2. Via Docker Exec (direct dans le conteneur)
```bash
# Se connecter au conteneur scraper
docker exec -it prospection-scraper-1 /bin/bash

# Lancer un spider manuellement
cd /app
scrapy crawl google_maps -a query="restaurant" -a location="Yaoundé, Cameroun" -a max_results=50

# Ou avec des paramètres avancés
scrapy crawl meta_ads -a query="hotel" -a country_code="CM" -a max_results=100 -a job_id=manuel_hotel_001
```

### 3. Via n8n (automatisation)
1. Allez sur `https://n8n.lumoradata.com`
2. Trouvez le workflow "01-scraping-orchestration"
3. Exécutez-le manuellement avec les paramètres souhaités

## 📊 Monitoring des jobs

### Vérifier l'état d'un job
```bash
# Voir tous les jobs
curl "http://localhost:5000/api/scrape/jobs"

# Voir un job spécifique
curl "http://localhost:5000/api/scrape/jobs/job_manuel_001"

# Voir les statistiques
echo "Jobs actifs :"
curl "http://localhost:5000/api/scrape/stats" | jq .
```

### Arrêter un job
```bash
curl -X POST "http://localhost:5000/api/scrape/stop/job_manuel_001"
```

## 🔍 Recherche par mot-clé de scraping

### Nouvelle route API disponible
```bash
# Rechercher toutes les entreprises scrappées avec un mot-clé
curl "http://localhost:4000/api/companies/by-keyword/restaurant"

# Avec pagination
curl "http://localhost:4000/api/companies/by-keyword/école?page=2&limit=20"

# Résultat inclut :
# - Liste des entreprises
# - Statistiques par source
# - Statistiques par ville
# - Pagination complète
```

## ⚙️ Paramètres disponibles

### Google Maps Spider
- `query` : mot-clé de recherche (ex: "restaurant", "hotel")
- `location` : ville/région (ex: "Yaoundé, Cameroun")
- `max_results` : nombre maximum de résultats (défaut: 50)
- `job_id` : ID optionnel pour tracking

### Meta Ads Spider  
- `query` : mot-clé publicitaire (ex: "école privée")
- `country_code` : code pays (ex: "CM" pour Cameroun)
- `max_results` : nombre maximum (défaut: 50)
- `job_id` : ID optionnel

### PagesJaunes Spider
- `category` : catégorie (ex: "restaurants", "hotels")
- `location` : ville spécifique (optionnel)
- `max_results` : nombre maximum (défaut: 1000)
- `job_id` : ID optionnel

## 🎯 Bonnes pratiques

1. **Limitez le nombre de résultats** pour éviter les bans
2. **Utilisez des job_id descriptifs** pour le tracking
3. **Surveillez les logs** en temps réel
4. **Vérifiez les quotas** avant de lancer de gros jobs
5. **Utilisez la nouvelle recherche par mot-clé** pour analyser vos données

## 📈 Exemple de résultat

Après un job réussi, vous pouvez utiliser la nouvelle fonctionnalité :

```bash
# Voir toutes les entreprises "restaurant"
curl "http://localhost:4000/api/companies/by-keyword/restaurant" | jq .

# Sortie typique :
{
  "keyword": "restaurant",
  "data": [...],
  "pagination": {...},
  "stats": {
    "total": 145,
    "by_source": [
      {"source": "google_maps", "count": 89},
      {"source": "pagesjaunes_cm", "count": 56}
    ],
    "by_city": [
      {"city": "Yaoundé", "count": 78},
      {"city": "Douala", "count": 67}
    ]
  }
}