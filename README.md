# AI Knowledge Assistant — Backend (NestJS)

A basic [NestJS](https://nestjs.com/) REST API that powers the
`ai-knowledge-assistant-frontend` (Next.js / React) app.

> **Status:** starter/educational project. Uses **in-memory storage** (data resets
> on restart) and a **mock "knowledge base"** that generates answers with sources
> by keyword matching — no database or LLM yet.

## Tech stack

| Layer              | Choice                              |
| ------------------ | ----------------------------------- |
| Runtime            | Node.js 20+                         |
| Framework          | NestJS 11 (Express under the hood)  |
| Language           | TypeScript                          |
| File uploads       | Multer (PDF, max 25 MB)             |
| Storage            | In-memory (no external database)    |
| Validation         | class-validator + ValidationPipe    |

## Getting started

```bash
npm install
npm run start:dev     # watch mode on http://localhost:3001
# or
npm run build && npm run start:prod
```

Set a different port with the `PORT` environment variable (see `.env.example`).

## Project structure

```
src/
├── main.ts                     # bootstrap: CORS, /api prefix, validation pipe
├── app.module.ts               # root module wiring all feature modules
├── database/                   # @Global in-memory store, seeded with demo data
├── auth/                       # login, register, /me, logout + AuthGuard
├── documents/                  # list / get / upload( PDF ) / delete
├── conversations/              # list / get / create / delete conversations
├── chat/                       # POST /api/chat, GET .../messages
└── overview/                   # dashboard stats + recent documents
```

Each feature follows the NestJS layer pattern:

```
Controller  -> receives HTTP requests, delegates to service
Service     -> business logic, uses DatabaseService
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

- Swap `DatabaseService` for a real database (TypeORM/Prisma + Postgres).
- Replace the mock `KnowledgeBaseService` with real RAG: PDF text extraction,
  embeddings + vector search, and an LLM call.
- Replace the in-memory session tokens with JWT + refresh tokens.
- Add e2e tests (`supertest`) and a `/test` folder.