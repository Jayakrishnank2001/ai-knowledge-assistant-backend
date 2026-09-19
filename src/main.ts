import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { AppModule } from './app.module'

async function bootstrap() {
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
}

void bootstrap()