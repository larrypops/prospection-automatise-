# 📡 Utilisation des APIs dans des Services Externes

Ce guide explique comment intégrer les APIs Prospection dans des services externes comme n8n, Zapier, Make, ou votre propre code.

---

## 🔑 Authentification

Toutes les APIs nécessitent une clé API dans le header `X-API-Key`:

```bash
X-API-Key: scraper_secret_change_me
```

**Variables d'environnement:**
```bash
BACKEND_URL=http://localhost:4000  # ou https://api.lumoradata.com
SCRAPER_API_KEY=scraper_secret_change_me
```

---

## 📊 API Companies

### Récupérer les leads (avec pagination)

**Endpoint:** `GET /api/companies/new`

**Paramètres:**
| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `limit` | int | 50 | Nombre de résultats par page |
| `page` | int | 1 | Numéro de page |
| `city` | string | - | Filtre par ville (ex: Douala) |
| `category` | string | - | Filtre par catégorie |
| `has_phone` | bool | - | `true` = uniquement avec téléphone |

**Exemples:**

```bash
# 10 premiers leads
curl -H "X-API-Key: $SCRAPER_API_KEY" \
  "$BACKEND_URL/api/companies/new?limit=10"

# Page 2 avec 20 résultats
curl -H "X-API-Key: $SCRAPER_API_KEY" \
  "$BACKEND_URL/api/companies/new?limit=20&page=2"

# Filtre: restaurants à Douala avec téléphone
curl -H "X-API-Key: $SCRAPER_API_KEY" \
  "$BACKEND_URL/api/companies/new?limit=50&city=Douala&category=restaurant&has_phone=true"
```

**Réponse:**
```json
{
  "data": [
    {
      "id": "92945064-9ba3-4dd3-ba51-1078a8801559",
      "name": "Kamer burn Cameroun",
      "category": "Restaurant",
      "phone_whatsapp": "+237682056890",
      "city": "Douala",
      "status": "new"
    }
  ],
  "pagination": {
    "total": 55,
    "page": 1,
    "limit": 10,
    "pages": 6
  }
}
```

---

## 🔍 API Scraper

### Lancer un scraping Google Maps

**Endpoint:** `POST /api/scraper/google-maps`

**Body:**
```json
{
  "query": "restaurant",
  "location": "Yaoundé, Cameroun",
  "max_results": 50
}
```

**Exemple:**

```bash
curl -X POST "$BACKEND_URL/api/scraper/google-maps" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $SCRAPER_API_KEY" \
  -d '{
    "query": "restaurant",
    "location": "Yaoundé, Cameroun",
    "max_results": 50
  }'
```

**Réponse:**
```json
{
  "success": true,
  "job_id": "ebb2f141-859d-42a4-b527-0adf77e1101c",
  "spider": "google_maps",
  "query": "restaurant",
  "location": "Yaoundé, Cameroun",
  "max_results": 50
}
```

### Vérifier le statut d'un job

**Endpoint:** `GET /api/scraper/status/{job_id}`

```bash
curl -H "X-API-Key: $SCRAPER_API_KEY" \
  "$BACKEND_URL/api/scraper/status/ebb2f141-859d-42a4-b527-0adf77e1101c"
```

**Réponse:**
```json
{
  "id": "ebb2f141-859d-42a4-b527-0adf77e1101c",
  "status": "done",
  "leads_found": 9,
  "duration_sec": 86,
  "error_message": null
}
```

**Statuts possibles:** `pending`, `running`, `done`, `failed`

---

## 💬 API WhatsApp

### Envoyer un message

**Endpoint:** `POST /api/whatsapp/send`

**Body:**
```json
{
  "company_id": "uuid-du-lead",
  "to_number": "+237699999999",
  "message": "Bonjour, je suis intéressé par votre offre",
  "session_name": "default",
  "campaign_id": "uuid-campagne",
  "template_id": "uuid-template",
  "message_type": "first_contact"
}
```

**Exemple:**

```bash
curl -X POST "$BACKEND_URL/api/whatsapp/send" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $SCRAPER_API_KEY" \
  -d '{
    "company_id": "92945064-9ba3-4dd3-ba51-1078a8801559",
    "to_number": "+237682056890",
    "message": "Bonjour, je suis Larry de Lumora Data...",
    "session_name": "default",
    "message_type": "first_contact"
  }'
```

**Réponse:**
```json
{
  "success": true,
  "message_id": "msg-uuid",
  "waha_message_id": "waha-msg-id",
  "status": "sent",
  "lead_status": "contacted"
}
```

### Liste des numéros WhatsApp

```bash
curl -H "X-API-Key: $SCRAPER_API_KEY" \
  "$BACKEND_URL/api/whatsapp/numbers"
```

---

## 🔧 Intégration n8n

### Node HTTP Request - Scraper Google Maps

```json
{
  "method": "POST",
  "url": "http://prospection-backend:4000/api/scraper/google-maps",
  "headers": {
    "Content-Type": "application/json",
    "X-API-Key": "scraper_secret_change_me"
  },
  "body": {
    "query": "={{ $json.query }}",
    "location": "={{ $json.location }}",
    "max_results": "={{ $json.max_results || 50 }}"
  }
}
```

### Node HTTP Request - Récupérer leads

```json
{
  "method": "GET",
  "url": "http://prospection-backend:4000/api/companies/new?limit=20&has_phone=true",
  "headers": {
    "X-API-Key": "scraper_secret_change_me"
  }
}
```

### Workflow complet: Scraper → Attendre → Récupérer leads

```
1. HTTP Request (POST /api/scraper/google-maps)
   ↓
2. Wait (2 minutes)
   ↓
3. HTTP Request (GET /api/scraper/status/{job_id})
   ↓
4. IF status = "done"
   ↓
5. HTTP Request (GET /api/companies/new?limit=50)
```

---

## 🔧 Intégration Zapier

### Webhook POST - Envoyer message WhatsApp

**URL:** `https://api.lumoradata.com/api/whatsapp/send`
**Méthode:** POST
**Headers:**
```
Content-Type: application/json
X-API-Key: scraper_secret_change_me
```

**Body:**
```json
{
  "to_number": "{{phone_whatsapp}}",
  "message": "Bonjour {{name}}, ...",
  "session_name": "default",
  "message_type": "first_contact"
}
```

---

## 🔧 Intégration Make (Integromat)

### Module HTTP - Lancer scraping

**URL:** `http://prospection-backend:4000/api/scraper/google-maps`
**Méthode:** POST
**Body type:** Raw
**Content type:** JSON

**Request content:**
```json
{
  "query": "{{1.query}}",
  "location": "{{1.location}}",
  "max_results": 50
}
```

---

## 🔧 Intégration Python

```python
import requests
import time

BASE_URL = "http://localhost:4000"
API_KEY = "scraper_secret_change_me"

headers = {
    "X-API-Key": API_KEY,
    "Content-Type": "application/json"
}

# 1. Lancer un scraping
response = requests.post(
    f"{BASE_URL}/api/scraper/google-maps",
    headers=headers,
    json={
        "query": "restaurant",
        "location": "Yaoundé, Cameroun",
        "max_results": 20
    }
)
job = response.json()
job_id = job["job_id"]
print(f"Job lancé: {job_id}")

# 2. Attendre la fin
while True:
    time.sleep(10)
    status = requests.get(
        f"{BASE_URL}/api/scraper/status/{job_id}",
        headers=headers
    ).json()
    
    print(f"Statut: {status['status']}, Leads: {status.get('leads_found', 0)}")
    
    if status["status"] in ["done", "failed"]:
        break

# 3. Récupérer les leads
leads = requests.get(
    f"{BASE_URL}/api/companies/new?limit=50",
    headers=headers
).json()

print(f"Total leads: {leads['pagination']['total']}")
for lead in leads["data"]:
    print(f"- {lead['name']} ({lead['phone_whatsapp']})")
```

---

## 🔧 Intégration Node.js

```javascript
const axios = require('axios');

const BASE_URL = 'http://localhost:4000';
const API_KEY = 'scraper_secret_change_me';

const api = axios.create({
    baseURL: BASE_URL,
    headers: { 'X-API-Key': API_KEY }
});

async function scrapeAndGetLeads() {
    // 1. Lancer scraping
    const { data: job } = await api.post('/api/scraper/google-maps', {
        query: 'restaurant',
        location: 'Yaoundé, Cameroun',
        max_results: 20
    });
    console.log('Job lancé:', job.job_id);
    
    // 2. Attendre la fin
    let status;
    do {
        await new Promise(r => setTimeout(r, 10000));
        const { data } = await api.get(`/api/scraper/status/${job.job_id}`);
        status = data;
        console.log('Statut:', status.status, 'Leads:', status.leads_found);
    } while (status.status === 'running');
    
    // 3. Récupérer leads
    const { data: leads } = await api.get('/api/companies/new?limit=50');
    console.log('Total leads:', leads.pagination.total);
    
    return leads.data;
}

scrapeAndGetLeads().catch(console.error);
```

---

## 📋 Récapitulatif des Endpoints

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/api/companies/new` | GET | Leads avec filtres et pagination |
| `/api/companies/{id}` | GET | Détail d'un lead |
| `/api/companies/{id}/status` | PUT | Mettre à jour le statut |
| `/api/scraper/google-maps` | POST | Lancer scraping Google Maps |
| `/api/scraper/facebook` | POST | Lancer scraping Facebook |
| `/api/scraper/meta-ads` | POST | Lancer scraping Meta Ads |
| `/api/scraper/pagesjaunes` | POST | Lancer scraping PagesJaunes |
| `/api/scraper/status/{id}` | GET | Statut d'un job |
| `/api/whatsapp/send` | POST | Envoyer message WhatsApp |
| `/api/whatsapp/numbers` | GET | Liste des numéros WA |

---

## 🐛 Dépannage

### Erreur 401 Unauthorized
- Vérifiez le header `X-API-Key`
- Vérifiez la valeur dans `.env` (`SCRAPER_API_KEY`)

### Erreur 500
- Vérifiez les logs: `docker logs prospection-backend`
- Vérifiez que PostgreSQL est accessible

### Timeout sur scraping
- Le scraping peut prendre plusieurs minutes
- Utilisez `/api/scraper/status/{job_id}` pour suivre la progression

---

**Dernière mise à jour:** 2026-03-02
