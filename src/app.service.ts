import { Injectable } from '@nestjs/common'

@Injectable()
export class AppService {
  getRootInfo() {
    return {
      service: 'ai-knowledge-assistant-backend',
      version: '0.1.0',
      message: 'Welcome to the AI Knowledge Assistant API. See /api/health for a health check.',
    }
  }

  getHealth() {
    return {
      status: 'ok',
      service: 'ai-knowledge-assistant-backend',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    }
  }
}