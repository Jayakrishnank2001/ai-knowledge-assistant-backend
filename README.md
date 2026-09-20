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

Everything is stored in MongoDB through three Mongoose models
(`src/database/models.ts`):

- `users` — demo account seeded on first boot (`demo@nexa.ai` / `password123`)
- `documents` — uploaded PDF metadata; status flips `processing -> completed`
  a few seconds after upload (simulated background job)
- `conversations` — each contains an embedded array of `messages` with optional
  `sources` for AI answers

`DatabaseService` (`src/database/database.service.ts`, marked `@Global`) is the
single data-access facade all feature services use. It auto-seeds demo data the
first time the collections are empty, so the frontend always has something to
show. Data survives server restarts.

MongoDB is connected in `src/main.ts` **before** `NestFactory.create()` boots the
app, so no request can ever race the database connection.

## Project structure

```
src/
├── main.ts                     # bootstrap: MongoDB connect, CORS, /api prefix, validation
├── app.module.ts               # root module wiring all feature modules
├── database/                   # @Global Mongoose-backed data layer + seeding
│   ├── models.ts               # schemas + typed models (users, documents, conversations)
│   └── database.service.ts     # repository facade (db.users / .documents / .conversations)
├── auth/                       # login, register, /me, logout + AuthGuard
├── documents/                  # list / get / upload( PDF ) / delete
├── conversations/              # list / get / create / delete conversations
├── chat/                       # POST /api/chat, GET .../messages
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

| Method | Route                | Body                              | Description              |
| ------ | -------------------- | --------------------------------- | ------------------------ |
| POST   | `/auth/login`        | `{ email, password }`             | Returns `{ token, user }`|
| POST   | `/auth/register`     | `{ name, email, password }`       | Creates an account       |
| GET    | `/auth/me`           | _Bearer token_                    | Current logged-in user   |
| POST   | `/auth/logout`       | _Bearer token_                    | Invalidates the session  |

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