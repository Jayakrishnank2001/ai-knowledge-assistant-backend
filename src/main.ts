import 'dotenv/config'

import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import mongoose from 'mongoose'
import { AppModule } from './app.module'

async function bootstrap() {
  const mongoUri = process.env.MONGODB_URI
  if (!mongoUri) {
    console.error('MONGODB_URI is missing. Copy .env.example to .env and set your connection string.')
    process.exit(1)
  }

  // Connect to MongoDB BEFORE the app boots, so no request can ever
  // race the database connection.
  await mongoose.connect(mongoUri, {
    dbName: process.env.MONGODB_DBNAME ?? 'ai-knowledge-assistant',
    serverSelectionTimeoutMS: 10_000,
  })
  console.log('📦 Connected to MongoDB')

  const app = await NestFactory.create(AppModule)

  // Every route will live under /api, e.g. POST /api/auth/login
  app.setGlobalPrefix('api')

  // Allow the Next.js frontend (http://localhost:3000) to call this API
  app.enableCors({ origin: true, credentials: true })

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