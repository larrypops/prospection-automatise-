# 📱 Automatisation WhatsApp avec n8n

## Vue d'ensemble

Ce guide explique comment orchestrer l'envoi de messages WhatsApp via n8n avec :
- **20 messages par jour** maximum (configurable)
- **Messages personnalisés** avec templates
- **Délai anti-ban** entre chaque envoi (30-120s)
- **Suivi des réponses** automatique (statut → replied)
- **Rotation des numéros** WhatsApp

---

## 🏗️ Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│   n8n (Cron)    │────▶│   Backend    │────▶│   WAHA (WA)     │
│  20 msg/jour    │     │   API REST   │     │  WhatsApp Web   │
└─────────────────┘     └──────────────┘     └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│  PostgreSQL     │     │  Webhook     │◀────│  Réponses       │
│  Leads/Stats    │     │  /webhook    │     │  WhatsApp       │
└─────────────────┘     └──────────────┘     └─────────────────┘
```

---

## 📋 Prérequis

### 1. Base de données (PostgreSQL)

```sql
-- Table pour les templates de messages
CREATE TABLE message_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100),
    channel VARCHAR(20) DEFAULT 'whatsapp',
    type VARCHAR(30) DEFAULT 'first_contact',
    body TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Table pour les numéros WhatsApp
CREATE TABLE whatsapp_numbers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    number VARCHAR(20) NOT NULL,
    session_name VARCHAR(50) NOT NULL,
    daily_limit INT DEFAULT 20,
    daily_sent INT DEFAULT 0,
    warmup_day INT DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    is_banned BOOLEAN DEFAULT false,
    last_sent_at TIMESTAMP,
    total_sent INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### 2. Variables d'environnement n8n

Dans n8n, configurez ces variables :

```bash
SENDER_NAME="Larry Mbili"
SENDER_COMPANY="Lumora Data"
WA_MIN_DELAY=30
WA_MAX_DELAY=120
```

---

## 🔧 Configuration du Workflow n8n

### Étape 1 : Import du Workflow

1. Allez sur `n8n.lumoradata.com`
2. **Add Workflow** → **Import from File**
3. Sélectionnez `n8n/workflows/03-whatsapp-sending.json`

### Étape 2 : Configuration du Cron (20 messages/jour)

**Noeud :** `Cron 9h Lun-Sam`

```
Mode: Custom Expression
Expression: 0 9 * * 1-6
```

Pour 20 messages répartis sur la journée, utilisez plutôt :
```
*/30 9-17 * * 1-6   (toutes les 30min de 9h à 17h, lun-sam)
```

### Étape 3 : Connexion PostgreSQL

**Noeud :** `Numéro WA Disponible` et `Leads à Contacter`

```
Host: pg-db-1
Port: 5432
Database: prospection
User: prospection_user
Password: [voir .env]
```

### Étape 4 : Templates de Messages

Insérez des templates personnalisés :

```sql
INSERT INTO message_templates (name, channel, type, body) VALUES
('Intro Restaurant', 'whatsapp', 'first_contact', 
'👋 Bonjour {{contact_name}},

Je suis {{sender_name}} de {{sender_company}}.

Je remarque que vous gérez un établissement à {{city}} et j''aimerais vous présenter une solution pour augmenter votre visibilité en ligne.

Seriez-vous disponible pour un échange rapide cette semaine ?

Bonne journée,
{{sender_name}}'),

('Suivi 1', 'whatsapp', 'followup_1',
'👋 {{contact_name}},

Je me permets de relancer mon message concernant notre solution pour {{company_name}}.

Auriez-vous 5 minutes cette semaine pour en discuter ?

Cordialement,
{{sender_name}}'),

('Dernier rappel', 'whatsapp', 'followup_2',
'👋 {{contact_name}},

Ceci est mon dernier message. Je comprends que vous ayez beaucoup de sollicitations.

Si un jour vous souhaitez améliorer votre présence digitale, n''hésitez pas à me recontacter.

Bonne continuation,
{{sender_name}}');
```

**Variables disponibles :**
- `{{contact_name}}` - Prénom du contact
- `{{company_name}}` - Nom de l'entreprise
- `{{city}}` - Ville
- `{{category}}` - Catégorie (restaurant, hôtel, etc.)
- `{{sender_name}}` - Votre nom
- `{{sender_company}}` - Votre entreprise

---

## 🔄 Webhook de Réponse (Statut "Replied")

### Configuration WAHA

Le webhook est déjà configuré dans le backend. WAHA envoie les événements à :

```
POST http://prospection-backend:4000/api/whatsapp/webhook
```

### Événements gérés

1. **Message envoyé** (`message.ack`) :
   - ACK 1 = `sent`
   - ACK 2 = `delivered`
   - ACK 3 = `read`

2. **Réponse reçue** (`message` + `fromMe: false`) :
   - Met à jour le lead : `contacted` → `replied`
   - Met à jour le message : `replied`
   - Enregistre `last_replied_at`

### Test du Webhook

```bash
# Simuler une réponse
➜  curl -X POST http://localhost:4000/api/whatsapp/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "event": "message",
    "payload": {
      "from": "237696719651@c.us",
      "fromMe": false,
      "body": "Oui je suis intéressé"
    }
  }'
```

Résultat attendu :
- Le lead avec `phone_whatsapp = +237696719651` passe en statut `replied`
- Le dernier message envoyé à ce numéro passe en statut `replied`

---

## 📊 Monitoring et Limites

### Limite journalière : 20 messages

Configuration dans `whatsapp_numbers` :
```sql
-- Voir la consommation
SELECT session_name, daily_sent, daily_limit, 
       (daily_limit - daily_sent) as remaining
FROM whatsapp_numbers 
WHERE is_active = true;

-- Réinitialiser le compteur (cron quotidien)
UPDATE whatsapp_numbers 
SET daily_sent = 0 
WHERE is_active = true;
```

### Logs et Statistiques

```sql
-- Messages envoyés aujourd'hui
SELECT status, COUNT(*) 
FROM messages 
WHERE DATE(sent_at) = CURRENT_DATE 
GROUP BY status;

-- Taux de réponse par campagne
SELECT 
  c.name,
  COUNT(m.id) as total_sent,
  COUNT(CASE WHEN m.status = 'replied' THEN 1 END) as replies,
  ROUND(COUNT(CASE WHEN m.status = 'replied' THEN 1 END) * 100.0 / COUNT(m.id), 2) as reply_rate
FROM campaigns c
LEFT JOIN messages m ON m.campaign_id = c.id
GROUP BY c.id, c.name;
```

---

## 🚀 Déploiement

### 1. Démarrer le workflow

Dans n8n :
1. **Activate** le workflow
2. Vérifiez que le statut passe à **Active**

### 2. Test manuel

```bash
# Déclencher manuellement le workflow
➜  curl -X POST https://n8n.lumoradata.com/webhook/whatsapp-test \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

### 3. Vérifier l'exécution

Dans n8n : **Executions** → vérifiez que les runs sont en statut `Success`

---

## ⚙️ Personnalisation

### Modifier le nombre de messages par jour

Éditez le workflow n8n :

**Noeud :** `Leads à Contacter` (requête SQL)
```sql
-- Modifier LIMIT pour changer le nombre
LIMIT {{ $json.remaining }}  -- Utilise la capacité restante
```

Ou modifiez `daily_limit` dans la table `whatsapp_numbers`.

### Modifier les horaires d'envoi

**Noeud :** `Cron 9h Lun-Sam`

Pour 20 messages répartis sur 8h (9h-17h) :
```
Expression: 0,30 9-17 * * 1-6
# Toutes les heures à :00 et :30, de 9h à 17h, lun-sam
```

### Ajouter un délai entre chaque lot

Ajoutez un nœud **Wait** entre `Un Lead à la Fois` et `Template Aléatoire` :
- Type : Time Interval
- Amount : 30
- Unit : Minutes

---

## 🐛 Dépannage

### Problème : Messages non envoyés

Vérifiez :
```bash
# Logs du backend
➜  docker logs prospection-backend --tail 100 | grep whatsapp

# Logs de WAHA
➜  docker logs prospection-waha --tail 50
```

### Problème : Limite atteinte trop vite

Vérifiez la configuration :
```sql
SELECT * FROM whatsapp_numbers WHERE session_name = 'default';
```

### Problème : Webhook ne met pas à jour

Vérifiez que WAHA est configuré avec le bon webhook URL :
```bash
➜  curl http://localhost:3005/api/sessions/default
# Vérifiez que webhookUrl contient l'URL du backend
```

---

## 📞 Support

En cas de problème :
1. Vérifiez les logs : `docker logs prospection-backend`
2. Vérifiez l'état WAHA : `docker logs prospection-waha`
3. Consultez les exécutions n8n pour les erreurs

---

## 📝 Résumé des Endpoints

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/api/whatsapp/send` | POST | Envoyer un message |
| `/api/whatsapp/webhook` | POST | Réception événements WAHA |
| `/api/whatsapp/session/:name/status` | GET | Statut session WAHA |
| `/api/whatsapp/numbers` | GET | Liste des numéros |

---

**Créé le :** 2026-03-02  
**Version :** 1.0
