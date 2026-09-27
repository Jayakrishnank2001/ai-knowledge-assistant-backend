# AI Knowledge Assistant — Backend (NestJS)

A basic [NestJS](https://nestjs.com/) REST API that powers the
`ai-knowledge-assistant-frontend` (Next.js / React) app.

> **Status:** working RAG pipeline backed by **MongoDB Atlas** (+ Atlas Vector
> Search), **Gemini embeddings** (`gemini-embedding-001`) and a **Gemini chat
> model** — with an offline mock fallback when no `GEMINI_API_KEY` is set.

## Tech stack

| Layer              | Choice                              |
| ------------------ | ----------------------------------- |
| Runtime            | Node.js 20+                         |
| Framework          | NestJS 11 (Express under the hood)  |
| Language           | TypeScript                          |
| Database           | MongoDB Atlas (via Mongoose ODM)    |
| File uploads       | Multer (PDF, max 25 MB)             |
| PDF text           | pdf-parse v2 (pdf.js, per-page text) |
| Embeddings         | Gemini gemini-embedding-001 (1536-dim), offline mock fallback |
| Chat answers       | Gemini chat model (see GEMINI_CHAT_MODEL) |
| Vector search      | Atlas Vector Search ($vectorSearch) + in-process cosine fallback |
| Validation         | class-validator + ValidationPipe    |

## Getting started

```bash
npm install

# 1. Put your MongoDB connection string in .env
cp .env.example .env          # then edit .env -> set MONGODB_URI + GEMINI_API_KEY

npm run start:dev             # watch mode on http://localhost:3001
# or
npm run build && npm run start:prod

# After changing the embedding model (or upgrading from placeholder chunks):
npm run reindex               # re-extract + re-embed every document from GridFS
```

## Troubleshooting

**`npm run start:dev` crashes with `ERR_REQUIRE_ESM` / *"require() of ES Module ...
not supported"***: `@nestjs/config` v12+ is published as **ESM-only** (`"type": "module"`),
which cannot be `require()`d from this project's CommonJS build (see
`tsconfig.json` → `"module": "commonjs"`). Stay on the last CommonJS release,
`@nestjs/config@^4.0.4`, which supports NestJS 11. Do **not** upgrade it to v12
unless the whole project is migrated to ESM.

**`MongooseServerSelectionError` / *"tlsv1 alert internal error"* / *"IP that isn't
whitelisted"***: the code compiled and booted, but MongoDB Atlas refused the
connection. DNS and TCP (port 27017) resolve fine — Atlas aborts the TLS
handshake before authentication when the calling IP is not authorised. Fix:
Atlas dashboard → **Network Access** → **Add IP Address** → *Add Current IP
Address* (or `0.0.0.0/0` for local development only), wait for the entry to show
as **Active**, then re-run `npm run start:dev`. `src/main.ts` prints this hint
directly instead of dumping the raw driver stack trace.

**`npm test` finds no tests** ("No tests found", `testMatch ... 0 matches`): the repo
lives inside `OneDrive/Documents`, and OneDrive can mark committed files as
*cloud-only placeholders* that jest 29's filesystem API silently skips. Fix: make
a fresh local copy of the file (delete + restore it, or copy to a new name and
back). Pinning the folder locally in OneDrive avoids the issue entirely.

Set a different port with the `PORT` environment variable (see `.env.example`).

### Environment variables

| Variable          | Purpose                                                    | Example |
| ----------------- | ---------------------------------------------------------- | ------- |
| `PORT`            | HTTP port the API listens on (default `3001`)             | `3001`  |
| `MONGODB_URI`     | MongoDB connection string                                 | `mongodb+srv://user:pass@cluster0.example.mongodb.net/?appName=Cluster0` |
| `MONGODB_DBNAME`  | Database name inside the cluster (default `ai-knowledge-assistant`) | `ai-knowledge-assistant` |
| `GEMINI_API_KEY`  | Google Gemini key (enables real embeddings + answers)    | `AIza...` |
| `GEMINI_EMBEDDING_MODEL` | Embedding model - keep 1536-dim output, then `npm run reindex` | `gemini-embedding-001` |
| `GEMINI_CHAT_MODEL` | Chat model for answers                                    | `gemini-2.5-flash` |
| `RAG_MIN_SIMILARITY` | Cosine floor for retrieval (default: 0.12 mock / 0.5 Gemini) | `0.5` |
| `RAG_TOP_K`       | Max chunks handed to the LLM (default `6`)                | `6` |
| `RAG_MAX_CHUNKS_PER_DOCUMENT` | Max chunks per document (default `3`)        | `3` |

> ⚠️ The real connection string lives in `.env` (gitignored). `.env.example` only
> contains placeholders — never commit real credentials.

## How persistence works

The data follows a logical RAG-ready layout. MongoDB ends up with **five
application collections** (managed by the code) plus the **GridFS collections**
(maintained automatically by MongoDB — never create or edit them manually):

```
MongoDB Atlas (db: ai-knowledge-assistant)
│
├── users                 ← accounts
├── documents             ← metadata only: filename, mimeType, size, status,
│                            pageCount + gridFsFileId pointing at the PDF binary
├── document_chunks       ← extracted text + embeddings (1536-dim), the data
│                            RAG retrieval searches
├── conversations         ← chat thread metadata (title, preview, date)
├── messages              ← one row per chat message (conversationId -> conversation)
│
├── fs.files              ← GridFS (auto) - PDF file metadata
└── fs.chunks             ← GridFS (auto) - the PDF binary in 255 KB chunks
```

### The document upload pipeline

```
POST /api/documents (multipart PDF)
  1. PDF binary → GridFS (fs.files + fs.chunks), returns gridFsFileId
  2. metadata row → documents   { userId, fileName, mimeType, fileSizeBytes,
                                  status: "processing", gridFsFileId }
  3. in the background (real extraction - the response is not held open):
       pdf-parse text (per page) → sentence-boundary chunks (1000 chars,
       200-char overlap, never splits a word) → provider embeddings
       → document_chunks
       documents.status → "completed" (pageCount from the extracted pages)
       - unreadable PDFs: status → "failed" with a logged reason
       - scanned/image-only PDFs: status → "failed" (no extractable text)
```

Delete cascades: `GridFS binary → document_chunks → documents` row.

### RAG chat flow

```
POST /api/chat { question }
  1. embed the question with the SAME provider that indexed the documents
     (Gemini: RETRIEVAL_QUERY task type; mock: hashed bag-of-words)
  2. retrieve candidates:
       Atlas $vectorSearch (indexed, scoped to the user's documents) when the
       "document_chunks_vector_index" is queryable, otherwise an in-process
       cosine scan of the user's chunks
  3. re-rank every candidate with exact cosine similarity via rankChunks():
       drop mismatched vector widths (stale models), drop below
       RAG_MIN_SIMILARITY, cap RAG_MAX_CHUNKS_PER_DOCUMENT per document,
       keep top RAG_TOP_K overall
  4. Gemini answers from the surviving chunks; sources = { document, page, relevance }
  5. user + assistant rows → messages, conversation preview/date updated
```

> The embedding model is picked once at startup: `GEMINI_API_KEY` set →
> Gemini (`gemini-embedding-001`, 1536-dim), otherwise an offline deterministic
> mock (keyword-based, not semantic). **Indexed vectors and the question vector
> must come from the same model** - changing models requires
> `npm run reindex`, otherwise old chunks are skipped as dimension mismatches
> (and usually score NaN → filtered as "no context").

### Access control (per-user scoping)

Every route except `/` and `/api/health` requires a **Bearer JWT**.

- **Documents** — `userId: null` rows are the **shared company knowledge base**
  (visible to every user, not deletable by regular accounts). A user's own
  uploads (`userId` set) are private: only the owner sees them and only the
  owner can delete them.
- **Conversations + messages** — fully private. Every conversation belongs to
  exactly one user; reading, continuing, or deleting someone else's
  conversation returns 404.
- **RAG retrieval** — a question only matches chunks from the shared knowledge
  base plus the asker's own documents.

```bash
# Demo isolation check (after login):
curl.exe -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/conversations        # only YOUR conversations
```

## Project structure

```
src/
├── main.ts                     # bootstrap: MongoDB connect, CORS, /api prefix, validation
├── app.module.ts               # root module wiring all feature modules
├── database/                   # @Global Mongoose-backed data layer + seeding
│   ├── models.ts               # schemas + typed models (users, documents,
│   │                           #   document_chunks, conversations, messages,
│   │                           #   revoked_tokens)
│   └── database.service.ts     # repository facade (db.users / .documents / ...)
├── documents/                  # list / get / upload / delete
│   ├── gridfs.service.ts       # GridFS upload/delete wrapper
│   ├── chunks.service.ts       # chunk generation + cascading cleanup
│   ├── embedding.util.ts       # mock embedText/cosine similarity/chunk builder
├── auth/                       # JWT login/register/me/logout + AuthGuard + bcrypt
├── conversations/              # conversations + messages split into their own models
├── chat/                       # RAG retrieval over document_chunks (KnowledgeBaseService)
└── overview/                   # dashboard stats + recent documents
```

Each feature follows the NestJS layer pattern:

```
Controller  -> receives HTTP requests, delegates to service
Service     -> business logic (async), uses DatabaseService / other services
DTO         -> class-validator rules for request bodies
Module      -> wraps controller + providers for that feature
```

## API reference

Base URL: `http://localhost:3001/api`

### Auth (demo account: `demo@nexa.ai` / `password123`)

| Method | Route                | Body                                | Description                       |
| ------ | -------------------- | ----------------------------------- | --------------------------------- |
| POST   | `/auth/login`        | `{ email, password }`               | Returns `{ token, user }` (JWT)   |
| POST   | `/auth/register`     | `{ name, email, password }`         | Creates an account, returns JWT   |
| GET    | `/auth/me`           | _Bearer token_                      | Current logged-in user            |
| PATCH  | `/auth/me`           | `{ name?, email?, workspaceName? }` | Update profile (guarded)          |
| POST   | `/auth/logout`       | _Bearer token_                      | Revokes the token                 |

**Sessions:** signed **JWTs** (7-day expiry, `JWT_SECRET` in `.env`). Passwords are
hashed with **bcrypt** on register/seed; legacy plaintext rows are upgraded to a
hash on first login. Because tokens are stateless, they **survive server
restarts**. Logout writes the token to a `revoked_tokens` collection with a TTL
index, so it stops working immediately and the row self-deletes once the JWT
expires.

### Documents

| Method | Route          | Body / file                         | Description                    |
| ------ | -------------- | ----------------------------------- | ------------------------------ |
| GET    | `/documents`   | —                                   | List all uploaded documents    |
| GET    | `/documents/:id` | —                                 | One document                   |
| POST   | `/documents`   | `multipart/form-data` field `file`  | Upload a PDF (max 25 MB)       |
| DELETE | `/documents/:id` | —                                 | Delete a document              |

Upload example:

```bash
curl.exe -X POST http://localhost:3001/api/documents \
  -F "file=@C:\path\to\Employee Handbook.pdf"
```

### Conversations

| Method | Route                 | Body            | Description                             |
| ------ | --------------------- | --------------- | --------------------------------------- |
| GET    | `/conversations`      | —               | List conversations (newest first)       |
| GET    | `/conversations/:id`  | —               | Full conversation incl. messages        |
| POST   | `/conversations`      | `{ title? }`    | Create an (empty) conversation          |
| DELETE | `/conversations/:id`  | —               | Delete a conversation                   |

### Chat

| Method | Route                       | Body                                        | Description                                  |
| ------ | --------------------------- | ------------------------------------------- | -------------------------------------------- |
| POST   | `/chat`                     | `{ question, conversationId? }`             | Ask a question; creates/continues a conversation and returns it with the AI answer + sources |
| GET    | `/chat/:conversationId/messages` | —                                         | All messages in a conversation               |

### Overview (dashboard)

| Method | Route                     | Description                              |
| ------ | ------------------------- | ---------------------------------------- |
| GET    | `/overview/stats`         | Document/page/conversation counts        |
| GET    | `/overview/recent-documents` | Recently uploaded documents             |

## Example flows

**1. Ask a question (frontend `ChatPage`)**

```bash
curl.exe -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{\"question\":\"How many days of annual leave do employees get?\"}'
```

Response contains the conversation with a user message + an assistant message
carrying `sources` (document name, page, relevance).

**2. Upload a document (frontend `DocumentsPage`)**

```bash
curl.exe -X POST http://localhost:3001/api/documents -F "file=@leave.pdf"
```

The document is created with `status: "processing"` and flips to `"completed"`
after ~2.5 seconds.

## What's next

- Replace the mock `KnowledgeBaseService` with real RAG: PDF text extraction,
  embeddings + vector search, and an LLM call.
- Replace the in-memory session tokens with JWT + refresh tokens.
- Add e2e tests (`supertest`) and a `/test` folder.