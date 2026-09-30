import 'dotenv/config'

import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import mongoose from 'mongoose'
import { AppModule } from './app.module'

function collectNestedErrorText(error: unknown): string {
  const reason = (error as { reason?: { servers?: Map<string, { error?: unknown }> } } | null)?.reason
  if (!(reason?.servers instanceof Map)) return ''

  const parts: string[] = []
  for (const server of reason.servers.values()) {
    const serverError = server?.error
    if (serverError instanceof Error) parts.push(serverError.message)
  }
  return parts.join('\n')
}

/**
 * Turns a Mongoose/MongoDB driver failure into a short, actionable message.
 * Without this the driver throws a raw `MongooseServerSelectionError`, which
 * buries the actual fix in hundreds of lines of topology/stack output.
 */
function explainMongoFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  // Mongoose hides the real cause inside `reason.servers`, so check there too.
  const text = `${message}\n${collectNestedErrorText(error)}`

  // Atlas aborts the TLS handshake *before* authentication when the calling IP
  // is missing from the cluster's Access List (Atlas calls this "Network
  // Access"); the driver reports that as a server-level TLS alert.
  if (/tlsv1 alert internal error|SSL alert number 80|not whitelisted|whitelist/i.test(text)) {
    return [
      "Could not reach the Atlas cluster - this machine's IP is not on the",
      "cluster's Access List (Atlas calls this \"Network Access\").",
      '',
      'Fix: Atlas dashboard -> Network Access -> Add IP Address',
      '  -> "Add Current IP Address" (0.0.0.0/0 for local dev only).',
      'Wait until the entry shows "Active", then re-run npm run start:dev.',
    ].join('\n')
  }

  if (/Authentication failed|bad auth/i.test(text)) {
    return [
      'Atlas rejected the credentials in MONGODB_URI.',
      'Fix: check the username/password in .env (URL-encode special characters)',
      'and confirm the user exists under Atlas -> Database Access.',
    ].join('\n')
  }

  if (/ENOTFOUND|querySrv|ESERVFAIL/i.test(text)) {
    return [
      'Could not resolve the MongoDB hostname.',
      'Fix: check MONGODB_URI for typos and confirm DNS/network connectivity.',
    ].join('\n')
  }

  return `Could not connect to MongoDB.\n${message}`
}

async function bootstrap() {
  const mongoUri = process.env.MONGODB_URI
  if (!mongoUri) {
    console.error('MONGODB_URI is missing. Copy .env.example to .env and set your connection string.')
    process.exit(1)
  }

  if (!process.env.JWT_SECRET) {
    console.error(
      'JWT_SECRET is missing. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
    )
    process.exit(1)
  }

  // Connect to MongoDB BEFORE the app boots, so no request can ever
  // race the database connection.
  try {
    await mongoose.connect(mongoUri, {
      dbName: process.env.MONGODB_DBNAME ?? 'ai-knowledge-assistant',
      serverSelectionTimeoutMS: 10_000,
    })
  } catch (error) {
    console.error('❌ Could not connect to MongoDB.')
    console.error(explainMongoFailure(error))
    process.exit(1)
  }
  console.log('📦 Connected to MongoDB')

  const app = await NestFactory.create(AppModule)

  // Every route will live under /api, e.g. POST /api/auth/login
  app.setGlobalPrefix('api')

  // Allow the configured frontends: comma-separated CORS_ORIGINS in .env
  // (e.g. http://localhost:3000 + the Vercel deployment). Omit the variable to
  // reflect any origin, which keeps ad-hoc local tooling (curl, Swagger) easy.
  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean)
  app.enableCors({ origin: corsOrigins.length ? corsOrigins : true, credentials: true })

  // Validate & strip incoming request bodies defined with class-validator DTOs
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))

  const port = Number(process.env.PORT ?? 3001)
  await app.listen(port)
  console.log(`🚀 AI Knowledge Assistant API is running on http://localhost:${port}/api`)
  console.log(`   Health check: http://localhost:${port}/api/health`)

  // Gracefully close the MongoDB connection when the process is terminated
  const shutdown = async () => {
    await mongoose.disconnect()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

void bootstrap()