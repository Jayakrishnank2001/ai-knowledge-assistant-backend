# AI Knowledge Assistant — Backend (NestJS)

A basic [NestJS](https://nestjs.com/) REST API that powers the
`ai-knowledge-assistant-frontend` (Next.js / React) app.

> **Status:** starter/educational project. Uses **MongoDB Atlas** for persistence
> and a **mock "knowledge base"** that generates answers with sources by keyword
> matching — no LLM yet.

## Tech stack

| Layer              | Choice                              |
| ------------------ | ----------------------------------- |
| Runtime            | Node.js 20+                         |
| Framework          | NestJS 11 (Express under the hood)  |
| Language           | TypeScript                          |
| Database           | MongoDB Atlas (via Mongoose ODM)    |
| File uploads       | Multer (PDF, max 25 MB)             |
| Validation         | class-validator + ValidationPipe    |

## Getting started

```bash
npm install

# 1. Put your MongoDB connection string in .env
cp .env.example .env          # then edit .env -> set MONGODB_URI

npm run start:dev             # watch mode on http://localhost:3001
# or
npm run build && npm run start:prod
```

Set a different port with the `PORT` environment variable (see `.env.example`).

### Environment variables

| Variable          | Purpose                                                    | Example |
| ----------------- | ---------------------------------------------------------- | ------- |
| `PORT`            | HTTP port the API listens on (default `3001`)             | `3001`  |
| `MONGODB_URI`     | MongoDB connection string                                 | `mongodb+srv://user:pass@cluster0.example.mongodb.net/?appName=Cluster0` |
| `MONGODB_DBNAME`  | Database name inside the cluster (default `ai-knowledge-assistant`) | `ai-knowledge-assistant` |

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
  3. ~2.5 s later (simulated extraction):
       text → chunks + embeddings → document_chunks
       documents.status → "completed", pageCount set from the chunks
```

Delete cascades: `GridFS binary → document_chunks → documents` row.

### RAG chat flow

```
POST /api/chat { question }
  1. embed the question
  2. rank every document_chunk by cosine similarity (1536-dim embeddings)
  3. keep the best chunk per document above a similarity floor
  4. answer = joined chunk texts; sources = { document, page, relevance }
  5. user + assistant rows → messages, conversation preview/date updated
```

> Since no embedding model/LLM is wired up yet, `embedText()` is a deterministic
> mock (stopword-free, singularized, hashed bag of words), and chunk content is
> generated from a small pool keyed by filename. Both are designed so you can
> swap in a real embedding model + PDF text extractor without touching the
> storage layer.

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