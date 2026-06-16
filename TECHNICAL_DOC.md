# Documentation Technique — VPO Assistant

> **Pour qui ?** Ce document est destiné à un développeur junior qui rejoint le projet. L'objectif est de comprendre l'architecture, les flux de données, les choix techniques, et les concepts d'IA utilisés. Pas besoin d'être expert en IA pour le lire : tout est expliqué.

---

## Table des matières

1. [Vue d'ensemble du projet](#1-vue-densemble-du-projet)
2. [Architecture générale](#2-architecture-générale)
3. [Backend — Structure et routes](#3-backend--structure-et-routes)
4. [Frontend — Pages et navigation](#4-frontend--pages-et-navigation)
5. [La base de données](#5-la-base-de-données)
6. [Le pipeline d'analyse IA](#6-le-pipeline-danalyse-ia)
7. [Concepts IA : RAG, embeddings et optimisation des coûts](#7-concepts-ia--rag-embeddings-et-optimisation-des-coûts)
8. [Authentification et sécurité](#8-authentification-et-sécurité)
9. [Streaming SSE](#9-streaming-sse)
10. [Variables d'environnement](#10-variables-denvironnement)
11. [Démarrage local](#11-démarrage-local)
12. [Particularités et bonnes pratiques du projet](#12-particularités-et-bonnes-pratiques-du-projet)

---

## 1. Vue d'ensemble du projet

**VPO Assistant** est un outil de support client augmenté par l'IA. Il aide les équipes support à :

- **Analyser** automatiquement les tickets clients (catégorie, priorité, sentiment)
- **Extraire** des faits durables sur chaque client à partir des échanges
- **Suggérer** des réponses et des étapes de résolution
- **Retrouver** des informations passées via une recherche sémantique
- **Poser des questions** à un assistant IA contextuel par client

> **Analogie :** Imagine un assistant qui lit tous les emails d'un client depuis le début, retient les infos importantes, et peut te répondre comme s'il connaissait parfaitement ce client.

---

## 2. Architecture générale

```
┌─────────────────────────────────────────────────────────────┐
│                        NAVIGATEUR                           │
│              React 18 + Vite (port 5173)                    │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP / SSE
┌────────────────────────▼────────────────────────────────────┐
│                    BACKEND API                              │
│              Fastify + Node.js (port 3001)                  │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │  Routes  │  │ Services │  │   AI     │  │  Storage  │  │
│  │  HTTP    │  │  Métier  │  │ Pipeline │  │  Fichiers │  │
│  └──────────┘  └──────────┘  └──────────┘  └───────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
┌─────────▼──────┐ ┌─────▼──────┐ ┌────▼────────────┐
│    MongoDB     │ │ Anthropic  │ │   Voyage AI     │
│  Atlas         │ │ Claude API │ │  (Embeddings)   │
│  (Données +    │ │ (Analyse + │ │  (Vectorisation)│
│   Vecteurs)    │ │  Streaming)│ │                 │
└────────────────┘ └────────────┘ └─────────────────┘
```

**Stack technique :**

| Couche | Technologie | Rôle |
|--------|------------|------|
| Frontend | React 18 + Vite + TypeScript | Interface utilisateur |
| Backend | Fastify + Node.js + TypeScript | API REST + logique métier |
| Base de données | MongoDB + Mongoose | Stockage des données |
| Recherche vectorielle | MongoDB Atlas Vector Search | Recherche sémantique |
| LLM | Anthropic Claude (Sonnet 4.6) | Analyse + assistant IA |
| Embeddings | Voyage AI (voyage-3-large) | Vectorisation du texte |
| Validation | Zod | Validation des entrées |
| Data fetching | TanStack Query | Cache + sync frontend |

---

## 3. Backend — Structure et routes

### 3.1 Structure des fichiers

```
backend/src/
├── server.ts          → Point d'entrée : crée l'app Fastify, monte les routes
├── config.ts          → Charge les variables d'env, définit les modèles IA
├── db.ts              → Connexion MongoDB
├── storage.ts         → Lecture/écriture de fichiers sur disque
├── models/
│   └── index.ts       → Tous les schémas Mongoose (User, Client, Ticket, etc.)
├── ai/
│   ├── client.ts      → Singleton du SDK Anthropic + prompt caching
│   ├── prompts.ts     → Prompts système + schémas d'outils
│   ├── analysis.ts    → Boucle agentique d'analyse de ticket
│   ├── embeddings.ts  → Découpage en chunks + vectorisation Voyage AI
│   └── assistant.ts   → Générateur async pour le streaming de l'assistant
├── services/
│   ├── ticketService.ts → Orchestration du pipeline d'analyse (5 étapes)
│   └── rag.ts           → Recherche vectorielle MongoDB Atlas
└── routes/
    ├── _auth.ts       → Middleware d'authentification
    ├── _sse.ts        → Helper pour les réponses Server-Sent Events
    ├── clients.ts     → CRUD clients
    ├── tickets.ts     → CRUD tickets + déclenchement analyse
    ├── context.ts     → Récupération des faits client
    ├── search.ts      → Recherche sémantique
    ├── assistant.ts   → Endpoint streaming de l'assistant
    ├── knowledge.ts   → Base de connaissances (docs + fichiers)
    └── me.ts          → Profil utilisateur courant
```

### 3.2 Toutes les routes API

> Toutes les routes sont préfixées par `/v1` et nécessitent un header d'authentification.

#### Clients (`/v1/clients`)

| Méthode | Chemin | Description |
|---------|--------|-------------|
| `GET` | `/clients` | Liste tous les clients de l'utilisateur |
| `POST` | `/clients` | Crée un nouveau client |
| `GET` | `/clients/:id` | Détails d'un client |
| `PATCH` | `/clients/:id` | Modifie un client (nom, entreprise, email, notes) |
| `DELETE` | `/clients/:id` | Supprime le client **et en cascade** : tous ses tickets, faits, chunks, docs |

> **Cascade delete :** quand on supprime un client, tout ce qui lui appartient disparaît. C'est intentionnel pour éviter les données orphelines.

#### Tickets (`/v1/tickets` et `/v1/clients/:clientId/tickets`)

| Méthode | Chemin | Description |
|---------|--------|-------------|
| `GET` | `/clients/:clientId/tickets` | Liste les tickets d'un client |
| `POST` | `/tickets` | Crée un ticket |
| `GET` | `/tickets/:id` | Détails du ticket avec toute la conversation |
| `POST` | `/tickets/:id/messages` | Ajoute un message (avec pièces jointes optionnelles) |
| `POST` | `/tickets/:id/messages/import` | Import en masse de messages (préserve les timestamps) |
| `DELETE` | `/tickets/:id/messages/:messageId` | Supprime un message |
| `POST` | **`/tickets/:id/analyze`** | **Déclenche le pipeline IA (réponse en SSE)** |
| `PATCH` | `/tickets/:id` | Modifie les métadonnées (sujet, statut, priorité…) |
| `DELETE` | `/tickets/:id` | Supprime le ticket et ses données associées |

#### Contexte client

| Méthode | Chemin | Description |
|---------|--------|-------------|
| `GET` | `/clients/:clientId/facts` | Tous les faits durables extraits pour ce client |
| `GET` | `/tickets/:ticketId/facts` | Faits extraits d'un ticket spécifique |

#### Recherche sémantique

| Méthode | Chemin | Description |
|---------|--------|-------------|
| `GET` | `/clients/:clientId/search?q=<query>&k=<num>` | Recherche dans les tickets par similarité sémantique |

#### Base de connaissances

| Méthode | Chemin | Description |
|---------|--------|-------------|
| `GET` | `/knowledge` | Liste les docs globaux de l'utilisateur |
| `POST` | `/knowledge` | Crée un doc (texte ou fichier uploadé) |
| `GET` | `/knowledge/:id` | Contenu complet d'un doc |
| `GET` | `/clients/:clientId/knowledge` | Docs spécifiques à un client |
| `PATCH` | `/knowledge/:id` | Modifie titre/description/contenu |
| `DELETE` | `/knowledge/:id` | Supprime le doc (et le fichier sur disque) |

#### Assistant IA

| Méthode | Chemin | Description |
|---------|--------|-------------|
| `POST` | `/clients/:clientId/assistant` | **Stream une réponse contextuelle (SSE)** |

#### Utilisateur et fichiers

| Méthode | Chemin | Description |
|---------|--------|-------------|
| `GET` | `/me` | Profil de l'utilisateur courant |
| `GET` | `/files/:folder/:stored` | Sert une pièce jointe stockée |

---

## 4. Frontend — Pages et navigation

```
frontend/src/
├── main.tsx           → Point d'entrée React
├── App.tsx            → Configuration React Router
├── lib/
│   ├── api.ts         → Client API typé (toutes les fonctions fetch)
│   ├── types.ts       → Types TypeScript (miroir du backend)
│   ├── queryKeys.ts   → Factory de clés TanStack Query
│   ├── tickets.ts     → Utilitaires tickets
│   └── files.ts       → Gestion des fichiers
├── components/        → Composants réutilisables
│   ├── Layout.tsx
│   ├── Sidebar.tsx
│   ├── TicketAssistant.tsx
│   ├── TicketConversation.tsx
│   ├── EditorPanel.tsx
│   ├── KnowledgeManager.tsx
│   └── ...
└── pages/             → Une page = une route
    ├── ClientsListPage.tsx      → /clients
    ├── DashboardPage.tsx        → /
    ├── TicketsListPage.tsx      → /clients/:id/tickets
    ├── TicketDetailPage.tsx     → /tickets/:id
    ├── ClientContextPage.tsx    → /clients/:id/context
    ├── ClientDocumentsPage.tsx  → /clients/:id/documents
    ├── GlobalKnowledgePage.tsx  → /knowledge
    ├── AssistantPage.tsx        → /clients/:id/assistant
    └── SearchPage.tsx           → /clients/:id/search
```

### Routes frontend

| URL | Page | Description |
|-----|------|-------------|
| `/` | Dashboard | Vue d'ensemble |
| `/clients` | ClientsListPage | Liste des clients |
| `/clients/:id/tickets` | TicketsListPage | Tickets d'un client |
| `/tickets/:id` | TicketDetailPage | Détail d'un ticket + analyse IA |
| `/clients/:id/context` | ClientContextPage | Faits durables sur le client |
| `/clients/:id/documents` | ClientDocumentsPage | Docs attachés au client |
| `/knowledge` | GlobalKnowledgePage | Base de connaissances globale |
| `/clients/:id/assistant` | AssistantPage | Chat IA contextuel |
| `/clients/:id/search` | SearchPage | Recherche sémantique |

### Gestion du state avec TanStack Query

Le frontend utilise **TanStack Query** (anciennement React Query) pour :
- Mettre en cache les réponses API
- Invalider automatiquement le cache quand des données changent
- Éviter les doubles requêtes

```typescript
// queryKeys.ts — factory centralisée
const qk = {
  clients: () => ['clients'],
  tickets: (clientId: string) => ['tickets', clientId],
  facts: (clientId: string) => ['facts', clientId],
  // ...
}

// Après une analyse : invalider les faits et le ticket → UI se rafraîchit
queryClient.invalidateQueries({ queryKey: qk.facts(clientId) })
queryClient.invalidateQueries({ queryKey: qk.ticket(ticketId) })
```

---

## 5. La base de données

### Collections MongoDB

#### `users` — Agents support
```typescript
{
  email: string,
  name: string,
  plan: 'free' | 'pro',
  passwordHash: string
}
```

#### `clients` — Comptes clients
```typescript
{
  userId: ObjectId,       // qui gère ce client
  name: string,
  company: string,
  contactEmail: string,
  notes: string           // notes libres sur le client
}
```

#### `tickets` — Demandes de support
```typescript
{
  clientId: ObjectId,
  subject: string,
  reference: string,      // numéro de ticket interne
  channel: string,        // email, chat, phone...
  status: 'open' | 'pending' | 'closed',
  priority: 'low' | 'medium' | 'high' | 'critical',
  category: string,       // rempli par l'IA
  messages: [{
    role: 'customer' | 'agent',
    content: string,
    timestamp: Date,
    attachments: [{ originalName, storedName, mimeType, size }]
  }],
  analysis: {             // résultat de l'analyse IA
    summary: string,
    sentiment: string,
    suggestedReply: string,
    nextSteps: string[],
    analyzedAt: Date
  },
  analysisVersion: number,  // incrémenté à chaque message ajouté
  lastAnalyzedVersion: number  // version au moment de la dernière analyse
}
```

> **Astuce :** `analysisVersion !== lastAnalyzedVersion` signifie que le ticket a été modifié depuis la dernière analyse → l'UI affiche un badge "Analyse obsolète".

#### `clientfacts` — Faits durables
```typescript
{
  clientId: ObjectId,
  sourceTicketId: ObjectId,  // ticket d'où vient ce fait
  sourceQuote: string,        // citation exacte
  category: string,           // ex: "préférence", "contrat", "problème récurrent"
  key: string,                // ex: "plan_actuel"
  value: string,              // ex: "Pro mensuel"
  confidence: number,         // 0-1, confiance de l'IA
  factuality: 'fact' | 'inference'
}
```

#### `knowledgedocs` — Base de connaissances
```typescript
{
  userId: ObjectId,
  scope: 'global' | 'client',
  clientId: ObjectId | null,  // null si global
  title: string,
  description: string,
  content: string,            // texte du doc
  source: 'text' | 'file',
  file: { originalName, storedName, mimeType, size }
}
```

#### `chunks` — Morceaux de texte vectorisés
```typescript
{
  clientId: ObjectId,
  ticketId: ObjectId,
  text: string,          // le morceau de texte (1200 chars environ)
  span: { start, end }, // position dans le texte original
  embedding: number[],   // vecteur de 1024 dimensions
  ticketVersion: number  // version du ticket au moment de l'indexation
}
```

> C'est cette collection qui permet la **recherche sémantique**. L'index vectoriel (`chunks_vector_idx`) est créé sur le champ `embedding`.

### Le modèle en trois couches

```
Couche 1 — Données brutes
  Ticket.messages[]         → les échanges emails/chat, tels quels

       ↓ Analyse IA
       
Couche 2 — Données structurées
  ClientFact                → faits extraits, nommés, catégorisés, citables

       ↓ Vectorisation
       
Couche 3 — Données vectorielles
  Chunk + embedding[]       → index sémantique pour la recherche
```

Chaque couche sert un usage différent :
- **Couche 1** : afficher la conversation, historique brut
- **Couche 2** : contexte client résumé pour l'IA, vue "profil client"
- **Couche 3** : retrouver des tickets similaires, alimenter l'assistant

---

## 6. Le pipeline d'analyse IA

Quand l'agent clique "Analyser" sur un ticket, voici ce qui se passe :

```
POST /v1/tickets/:id/analyze
          │
          ▼
    [Vérification anti-doublon]
    → Si une analyse est déjà en cours pour ce ticket → erreur 409

          │
          ▼
    ÉTAPE 1 — "preparing"
    → Charger le contexte client (faits + notes)
    → Charger l'index de la base de connaissances (titres + descriptions seulement)

          │
          ▼
    ÉTAPE 2 — "analyzing"
    → Envoyer à Claude : conversation + contexte + index des docs
    → Claude peut appeler fetch_documents (max 2 fois) pour charger le contenu des docs pertinents
    → Claude retourne : catégorie, priorité, sentiment, résumé, réponse suggérée, étapes, faits

          │
          ▼
    ÉTAPE 3 — "context"
    → Supprimer les anciens faits issus de CE ticket
    → Insérer les nouveaux faits extraits
    (idempotent : re-analyser ne crée pas de doublons)

          │
          ▼
    ÉTAPE 4 — "indexing"
    → Découper le texte du ticket en chunks (morceaux ~1200 chars)
    → Vectoriser chaque chunk avec Voyage AI
    → Sauvegarder en base (collection chunks)

          │
          ▼
    ÉTAPE 5 — "finalizing"
    → Sauvegarder le résultat de l'analyse dans le ticket
    → Mettre à jour lastAnalyzedVersion

          │
          ▼
    SSE → event "done"
```

> **Important :** Si une étape secondaire échoue (indexing, context), le pipeline continue quand même jusqu'à "finalizing". L'analyse est sauvegardée même si les embeddings ont planté.

### La boucle agentique (fetch_documents)

C'est une technique avancée pour éviter de charger toute la base de connaissances à chaque analyse :

```
Au lieu de :
  Prompt = [contexte] + [TOUS les docs, 50 000 tokens] + [ticket]

On fait :
  Prompt = [contexte] + [INDEX des docs : titre + description] + [ticket]
  
  → Claude : "Je veux lire le doc 'Politique de remboursement' (id: abc)"
  → Backend : charge le doc, le renvoie à Claude
  → Claude : "Je veux aussi lire 'Contrat Enterprise' (id: xyz)"
  → Backend : charge ce doc aussi
  → Claude : (max 2 rounds) → produit l'analyse finale
```

**Pourquoi ?** Parce que charger 20 documents à chaque analyse coûterait cher en tokens. On ne charge que ce dont l'IA a besoin.

---

## 7. Concepts IA : RAG, embeddings et optimisation des coûts

> Cette section explique les concepts clés de l'IA utilisés dans ce projet. Pas de prérequis nécessaire.

### 7.1 Les tokens : l'unité de base

Les APIs d'IA facturent à la **token**. Un token ≈ 4 caractères ≈ 0,75 mot.

- `"Bonjour"` → 1 token
- `"Bonjour, comment puis-je vous aider ?"` → ~8 tokens
- Un email de 500 mots → ~670 tokens
- L'historique complet d'un client depuis 2 ans → potentiellement 100 000+ tokens

**Règle d'or :** moins de tokens = moins cher + plus rapide.

---

### 7.2 Les embeddings — transformer du texte en coordonnées

Un **embedding** est la transformation d'un texte en une liste de nombres (un vecteur). Ce vecteur capture le **sens** du texte dans un espace mathématique.

```
"Mon imprimante ne fonctionne plus"  → [0.12, -0.87, 0.43, ..., 0.91]  (1024 nombres)
"L'imprimante est en panne"           → [0.14, -0.85, 0.41, ..., 0.89]  (très proche !)
"Je veux commander une pizza"         → [0.82,  0.21, -0.54, ..., 0.12]  (très différent)
```

**Pourquoi c'est utile ?** Parce qu'on peut mesurer la distance entre deux vecteurs pour savoir si deux textes ont un sens similaire, même s'ils n'ont pas les mêmes mots.

Dans ce projet, on utilise **Voyage AI** (`voyage-3-large`) qui produit des vecteurs de **1024 dimensions**.

```
backend/src/ai/embeddings.ts

embedTexts(texts: string[])  → float[][] (vecteurs pour indexation)
embedQuery(query: string)    → float[]   (vecteur pour recherche)
```

> **Note :** on utilise deux modes différents (`document` et `query`) car Voyage les optimise différemment selon l'usage.

---

### 7.3 Le RAG — Retrieval-Augmented Generation

**RAG** = Retrieval-Augmented Generation (génération augmentée par récupération).

C'est la technique qui permet à un LLM de répondre à des questions sur des données qu'il n'a pas vues pendant son entraînement.

#### Sans RAG — problème
```
Utilisateur : "Quelle est la politique de remboursement pour le client Dupont ?"
Claude : "Je n'ai pas accès à vos données clients..."
```

#### Avec RAG — solution
```
1. RETRIEVAL (récupération)
   → Vectoriser la question de l'utilisateur
   → Chercher dans la base les chunks les plus proches (par similarité de vecteurs)
   → Récupérer les 8 morceaux les plus pertinents

2. AUGMENTED GENERATION (génération augmentée)
   → Injecter ces chunks dans le prompt : "Voici le contexte pertinent : [chunks]"
   → Claude génère une réponse BASÉE SUR CES DONNÉES RÉELLES

Résultat : "D'après le ticket du 12 mars, M. Dupont bénéficie du plan Pro..."
```

**Flux RAG dans ce projet :**

```
Question utilisateur
      │
      ▼
embedQuery()  ←  Voyage AI vectorise la question
      │
      ▼
$vectorSearch ← MongoDB Atlas cherche les chunks similaires
      │
      ▼
Top 8 chunks  ← les morceaux de tickets les plus pertinents
      │
      ▼
Prompt = [contexte client] + [chunks RAG] + [historique chat] + [question]
      │
      ▼
Claude génère une réponse précise et sourcée
```

Code clé : `backend/src/services/rag.ts`

```typescript
// Cherche les K chunks les plus proches sémantiquement de la query
async function searchChunks(clientId, query, k = 8) {
  const queryVector = await embedQuery(query);
  return Chunk.aggregate([
    {
      $vectorSearch: {
        index: 'chunks_vector_idx',
        path: 'embedding',
        queryVector,
        numCandidates: k * 10,
        limit: k,
      }
    },
    { $lookup: { from: 'tickets', ... } }  // joindre le sujet du ticket
  ]);
}
```

---

### 7.4 Le chunking — découper intelligemment

On ne vectorise pas un ticket entier d'un coup (trop grand, perte de précision). On le découpe en **chunks** (morceaux).

**Stratégie de chunking dans ce projet :**

```
Taille cible : ~1200 caractères
Taille max   : ~1800 caractères
Méthode      : découpage par paragraphes avec fenêtre glissante

Paragraphe court  (< 1200 chars) → un chunk seul
Paragraphe moyen  (~1200 chars)  → un chunk
Paragraphe long   (> 1800 chars) → découpé en sous-chunks

Fenêtre glissante : les chunks se chevauchent légèrement pour ne pas
couper une idée au milieu
```

Code : `backend/src/ai/embeddings.ts → chunkText()`

---

### 7.5 Le prompt caching — ne pas répéter ce qu'on a déjà payé

Anthropic offre le **prompt caching** : si tu envoies le même début de prompt deux fois, tu paies beaucoup moins cher la deuxième fois.

**Comment ça marche :**
```
Requête 1 :
  [System prompt (2000 tokens)]  ← coût plein
  [Message utilisateur]

Requête 2 (même session) :
  [System prompt (2000 tokens)]  ← CACHE HIT → 90% moins cher !
  [Nouveau message utilisateur]
```

**Dans ce projet :**
```typescript
// backend/src/ai/client.ts
function cachedSystem(text: string) {
  return {
    type: 'text',
    text,
    cache_control: { type: 'ephemeral' }  // ← marque ce bloc comme cacheable
  };
}
```

Le système prompt (instructions de l'IA) est mis en cache automatiquement. Très utile pour l'assistant qui est appelé plusieurs fois de suite dans une conversation.

---

### 7.6 Les outils (tool use) — l'IA qui agit

Les LLMs modernes peuvent non seulement générer du texte, mais aussi **appeler des fonctions** définies par le développeur.

**Exemple dans ce projet :**

```typescript
// On définit un "outil" que Claude peut utiliser
const FETCH_DOCUMENTS_TOOL = {
  name: 'fetch_documents',
  description: 'Charge le contenu complet de documents de la base de connaissances',
  input_schema: {
    type: 'object',
    properties: {
      ids: { type: 'array', items: { type: 'string' } }
    }
  }
};

// Dans la boucle d'analyse :
// 1. On envoie le prompt à Claude
// 2. Claude répond : "je veux appeler fetch_documents avec ids: ['abc', 'xyz']"
// 3. Notre code charge ces docs
// 4. On renvoie le résultat à Claude
// 5. Claude termine son analyse
```

C'est ce qu'on appelle une **boucle agentique** : l'IA décide elle-même quelles données supplémentaires elle a besoin.

---

### 7.7 Récapitulatif des optimisations de coût

| Technique | Économie | Comment |
|-----------|----------|---------|
| **RAG** | Évite de mettre 100 000 tokens dans chaque prompt | On n'envoie que les 8 extraits pertinents |
| **Prompt caching** | -90% sur les tokens répétés | Le system prompt est mis en cache |
| **Lazy doc loading** | Évite de charger toute la KB | Claude demande seulement les docs utiles |
| **Chunking ciblé** | Précision + coût | On vectorise des morceaux, pas des docs entiers |
| **Modèles différenciés** | Utilise le bon outil | Sonnet pour l'analyse, Haiku (prévu) pour le résumé |
| **`.select().lean()`** | Pas IA mais BDD | Requêtes MongoDB légères, pas de champs inutiles |

---

## 8. Authentification et sécurité

### Mode développement (actuel)

```http
Authorization: Dev 507f1f77bcf86cd799439011
```

Le middleware `_auth.ts` accepte ce format simplifié et extrait l'userId. **Ne jamais utiliser en production.**

```typescript
// backend/src/routes/_auth.ts
fastify.addHook('preHandler', async (req) => {
  const header = req.headers.authorization ?? '';
  if (header.startsWith('Dev ')) {
    req.userId = header.slice(4);  // extrait l'ID après "Dev "
    return;
  }
  throw fastify.httpErrors.unauthorized();
});
```

### Fichiers uploadés

Les pièces jointes sont stockées avec un UUID dans leur nom :
```
uploads/tickets/<UUID>_nom_original.pdf
```

Le UUID rend le chemin impossible à deviner → sécurité basique par obscurité. En production, il faudrait des URLs signées avec expiration.

### Validation des entrées

Toutes les routes valident leurs paramètres avec **Zod** :

```typescript
const schema = z.object({
  subject: z.string().min(1).max(200),
  status: z.enum(['open', 'pending', 'closed']).optional(),
});
const body = schema.parse(req.body);  // lance une erreur si invalide → 400
```

---

## 9. Streaming SSE

L'analyse IA et l'assistant utilisent **Server-Sent Events (SSE)** plutôt que des WebSockets pour streamer les réponses.

**Pourquoi SSE et pas WebSocket ?**
- SSE est unidirectionnel (serveur → client) → parfait pour streamer du texte
- Pas besoin de la bidirectionnalité de WebSocket ici
- Plus simple à implémenter et déboguer

### Format des événements

```
event: step
data: {"step": "analyzing", "message": "Analyse en cours..."}

event: step
data: {"step": "indexing", "message": "Indexation des données..."}

event: data
data: {"delta": "Voici ma suggestion de réponse..."}

event: done
data: {}
```

### Particularité CORS

Fastify gère automatiquement les headers CORS pour les requêtes normales, mais **pas pour les réponses SSE** (qui bypasse le plugin via `reply.raw`). Le helper `_sse.ts` règle ce problème manuellement :

```typescript
// backend/src/routes/_sse.ts
function startSSE(req, reply) {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': req.headers.origin ?? '*',
  });
}
```

---

## 10. Variables d'environnement

### Backend (`backend/.env`)

```env
PORT=3001                          # Port du serveur Fastify
NODE_ENV=development               # Mode dev/prod
MONGO_URI=mongodb+srv://...        # Connexion MongoDB Atlas
ANTHROPIC_API_KEY=sk-ant-...       # Clé API Anthropic (Claude)
VOYAGE_API_KEY=pa-...              # Clé API Voyage AI (embeddings)
JWT_SECRET=dev-secret              # Secret JWT (inutilisé en dev)
```

### Frontend (`frontend/.env`)

```env
VITE_API_URL=http://localhost:3001      # URL du backend
VITE_DEV_USER_ID=507f1f77bcf86cd799439011  # ID utilisateur dev (ObjectId MongoDB)
```

---

## 11. Démarrage local

### Prérequis
- Node.js 20+
- Un cluster MongoDB Atlas (pour le Vector Search)
- Clés API : Anthropic + Voyage AI

### Installation

```bash
# Backend
cd backend
cp .env.example .env   # Remplir les variables
npm install
npm run indexes         # Créer l'index vectoriel MongoDB Atlas (une seule fois)
npm run dev             # Démarre sur http://localhost:3001

# Frontend (autre terminal)
cd frontend
cp .env.example .env   # Remplir VITE_API_URL
npm install
npm run dev             # Démarre sur http://localhost:5173
```

### Créer l'index vectoriel (une seule fois)

Le fichier `backend/scripts/createIndexes.ts` crée l'index `chunks_vector_idx` sur MongoDB Atlas. Sans lui, la recherche sémantique et le RAG ne fonctionnent pas.

```bash
cd backend && npm run indexes
```

---

## 12. Particularités et bonnes pratiques du projet

### Analyse idempotente

Re-analyser un ticket deux fois ne crée pas de doublons. Avant d'insérer les nouveaux faits, on supprime les anciens faits **issus de ce ticket** :

```typescript
// ticketService.ts
await ClientFact.deleteMany({ sourceTicketId: ticketId });
await ClientFact.insertMany(newFacts);
```

Résultat : toujours un état cohérent, peu importe combien de fois on ré-analyse.

### Anti-doublon d'analyse en vol

Un `Set<string>` global empêche deux analyses simultanées du même ticket (ex: deux onglets ouverts) :

```typescript
const inFlight = new Set<string>();

if (inFlight.has(ticketId)) throw new Error('Analyse déjà en cours');
inFlight.add(ticketId);
try {
  // ... analyse ...
} finally {
  inFlight.delete(ticketId);
}
```

### Détection "analyse obsolète"

Chaque ajout de message incrémente `ticket.analysisVersion`. L'analyse enregistre `lastAnalyzedVersion`. Si `analysisVersion > lastAnalyzedVersion`, le ticket a changé depuis la dernière analyse → l'UI affiche un avertissement.

### Requêtes MongoDB légères

Pour les listes, on évite de charger les gros champs :

```typescript
// Mauvais : charge tout, y compris messages[]
await Ticket.find({ clientId });

// Bien : exclut les messages (potentiellement énormes)
await Ticket.find({ clientId }).select('-messages').lean();
```

`.lean()` retourne des objets JS purs (sans méthodes Mongoose) → plus rapide.

### Multilinguisme transparent

Les prompts système sont en anglais, mais le contenu des tickets peut être en français, espagnol, etc. Claude détecte automatiquement la langue du ticket et rédige ses suggestions de réponse dans la même langue.

### Isolation des erreurs dans le pipeline

Si l'étape "indexing" (embeddings) échoue, l'analyse est quand même sauvegardée. Les étapes sont conçues pour être indépendantes autant que possible. L'échec d'une étape non critique ne fait pas échouer toute l'analyse.

---

## Glossaire

| Terme | Définition |
|-------|-----------|
| **Token** | Unité de texte pour les LLMs (~4 caractères). La facturation est au token. |
| **LLM** | Large Language Model — modèle de langage (Claude, GPT, etc.) |
| **Embedding** | Représentation vectorielle d'un texte qui capture son sens sémantique |
| **RAG** | Retrieval-Augmented Generation — technique pour injecter des données pertinentes dans le prompt |
| **Chunk** | Morceau de texte (~1200 chars) prêt à être vectorisé |
| **Vector Search** | Recherche par similarité de vecteurs (trouve les textes au sens proche) |
| **SSE** | Server-Sent Events — protocole HTTP pour streamer des données serveur → client |
| **Tool Use** | Capacité d'un LLM à appeler des fonctions définies par le développeur |
| **Prompt Caching** | Mise en cache des parties répétées d'un prompt pour réduire les coûts |
| **Idempotent** | Une opération qui produit le même résultat peu importe combien de fois on l'exécute |
| **Cascade delete** | Suppression en chaîne : supprimer A supprime automatiquement tout ce qui dépend de A |
| **Boucle agentique** | Boucle où l'IA décide elle-même quelles actions effectuer avant de répondre |

---

*Document rédigé pour l'onboarding des développeurs juniors — VPO Assistant*
