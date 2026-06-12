# VPO Assistant

> Le copilote de support qui *garde le contexte* de chaque client.

VPO Assistant est une application web de **suivi de tickets client** assistée par l'IA. Pour chaque ticket, elle propose une **analyse** (classement, priorité, ton du client), une **réponse prête à envoyer**, et des **étapes de résolution**. Surtout, elle construit automatiquement un **contexte vivant par client** (produit utilisé, environnement, historique, préférences) réutilisé d'un ticket à l'autre — sans saisie manuelle.

Le lien avec votre outil de ticketing se fait **manuellement** (champ « référence » sur chaque ticket) : VPO Assistant est la couche d'analyse et de mémoire, pas un remplaçant de votre helpdesk.

> POC issu d'un squelette d'application d'analyse de contenu, repointé sur le domaine du support client. Multi-utilisateur (agents) et multi-tickets.

---

## Fonctionnalités

- **Espace par client** — chaque client a ses tickets, son contexte et son assistant dédiés.
- **Analyse de ticket à la demande** — un clic « Analyser » lance le pipeline IA : catégorie, priorité, sentiment, résumé, **réponse suggérée** (copiable) et **prochaines étapes**.
- **Contexte client vivant** — l'IA extrait à chaque analyse les faits durables sur le client (plan, produit, OS, interlocuteurs…) et les accumule dans une fiche consultable.
- **Suivi** — statut (nouveau, en cours, en attente, résolu, clos) et priorité éditables, badges dans la liste des tickets.
- **Recherche sémantique** — retrouver un passage des tickets d'un client par le sens, pas par mot-clé exact.
- **Assistant conversationnel** — poser des questions sur l'historique du client ou faire rédiger un brouillon de réponse, en streaming, avec les tickets sources cités.

---

## Architecture

```
vpo-assistant/
├── backend/   # API Fastify + pipeline IA
└── frontend/  # Application React
```

### Modèle de données

| Couche | Modèle | Rôle |
|---|---|---|
| Texte brut | `Ticket.content` | Le message du client, source de vérité |
| Structuré | `ClientFact` | Faits durables extraits par l'IA, ancrés au ticket source |
| Vectoriel | `Chunk` | Index sémantique (RAG) par client |

- **`User`** — l'agent de support (multi-utilisateur via `userId`).
- **`Client`** — un compte client : nom, société, contact, **notes** libres de l'agent.
- **`Ticket`** — `subject`, `content`, `reference` (lien manuel vers le ticketing), `status`, `priority`, `category`, et le sous-document **`analysis`** (résumé, sentiment, réponse suggérée, étapes).
- **`ClientFact`** — un fait durable (`category`, `key`, `value`) ancré sur `sourceTicketId` → ré-analyser un ticket ne crée jamais de doublon.

### Pipeline d'analyse — déclenché **manuellement** (bouton « Analyser le ticket »)

```
PUT  /v1/tickets/:id/content   → sauvegarde le texte (aucun appel IA, gratuit)
POST /v1/tickets/:id/analyze   → lance le pipeline et STREAME sa progression (SSE) :
  0. preparing    Compiler le contexte client (faits + notes)
  1. analyzing    Analyser le ticket (Sonnet + tool_use) → classement, réponse, faits
  2. context      Fusionner les faits client (idempotent par ticket)
  3. indexing     Re-chunker + ré-indexer pour le RAG
  4. finalizing   Écrire l'analyse sur le ticket
  ◀──── event: done / event: error
```

Le frontend consomme ce flux pour animer un **stepper** en direct dans le panneau d'analyse. Chaque étape est isolée : l'échec d'une étape secondaire (faits, embeddings) n'empêche pas le ticket d'être marqué analysé.

### Sélection des modèles

| Tâche | Modèle | Raison |
|---|---|---|
| Analyse de ticket | `claude-sonnet-4-6` | Rapide, `tool_use` structuré |
| Assistant | `claude-sonnet-4-6` | Streaming SSE fluide |

### Stack

| Couche | Choix |
|---|---|
| Runtime | Node.js 20 + TypeScript (strict, ESM) |
| HTTP | Fastify (SSE natif) |
| Base de données | MongoDB + Mongoose |
| Vecteurs | MongoDB Atlas Vector Search |
| LLM | Anthropic (multi-modèles) |
| Embeddings | Voyage AI — `voyage-3-large` |
| Validation | Zod |
| Frontend | React 18 + Vite 5 + React Router 6 + TanStack Query 5 |

**Pages :**

| Route | Page |
|---|---|
| `/` | Liste des clients |
| `/clients/:id/tickets[/:ticketId]` | Espace ticket : message + analyse + suivi |
| `/clients/:id/context` | Contexte client (faits + notes) |
| `/clients/:id/search` | Recherche sémantique dans les tickets |
| `/clients/:id/assistant` | Chat avec l'IA sur le client |

---

## Démarrage rapide

### Prérequis

- Node.js 20+
- Compte [MongoDB Atlas](https://cloud.mongodb.com) (tier M0 gratuit suffisant)
- Clé API [Anthropic](https://console.anthropic.com)
- Clé API [Voyage AI](https://dash.voyageai.com) (pour la recherche sémantique)

### Backend

```bash
cd backend
cp .env.example .env
# Remplir : MONGO_URI, ANTHROPIC_API_KEY, VOYAGE_API_KEY
npm install
npm run indexes   # Crée l'index vectoriel Atlas (une seule fois — optionnel pour la démo)
npm run dev       # http://localhost:3001
```

Vérification : `curl http://localhost:3001/healthz`

### Frontend

```bash
cd frontend
cp .env.example .env
# Remplir : VITE_DEV_USER_ID=<id_mongo_d_un_user>
npm install
npm run dev       # http://localhost:5173
```

> **Auth (mode dev)** : le backend accepte `Authorization: Dev <userId>`. Renseignez dans `frontend/.env` l'`_id` Mongo d'un document `users` existant (créez-en un, ou réutilisez n'importe quel ObjectId valide — `/me` renverra un profil par défaut si le user n'existe pas encore). À remplacer par un vrai fournisseur d'auth (JWT/OAuth) en production.

---

## Démo en 6 étapes (à présenter)

1. Créer un **client**.
2. Créer un **ticket** et y coller un message client.
3. Cliquer **Analyser** → observer le stepper, puis catégorie / priorité / résumé / **réponse suggérée** / étapes.
4. Ajuster le **statut** (suivi).
5. Ouvrir **Contexte client** → les faits extraits s'y sont accumulés.
6. Poser une question dans l'**Assistant** (réponse en streaming citant les tickets).

---

## Limites connues / roadmap

- Authentification en mode dev uniquement (`Authorization: Dev <userId>`).
- Pas de connexion automatique à un outil de ticketing externe (lien manuel via le champ « référence »).
- Pas de quotas par utilisateur sur les appels IA.
- Recherche vectorielle : nécessite un index Atlas (`npm run indexes`) ; l'assistant et l'app fonctionnent sans, la recherche renvoie simplement zéro résultat.

### Optimisations de coûts en place

- **Analyse à la demande** : le pipeline IA ne tourne que sur clic explicite. Saisir et sauvegarder un ticket reste gratuit.
- **Prompt caching** (`cache_control: ephemeral`) sur le préfixe constant (system + schéma d'outil) des appels d'analyse et de l'assistant.
- **Extraction parcimonieuse** : le prompt plafonne le nombre de faits et impose des clés `snake_case` stables.
- **Nettoyage en cascade** : supprimer un ticket (ou un client) purge les faits et les chunks orphelins.
