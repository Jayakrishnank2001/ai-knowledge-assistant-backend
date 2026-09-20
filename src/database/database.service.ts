import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import mongoose from 'mongoose'
import {
  ConversationEntity,
  DocumentEntity,
  UserEntity,
} from './models'
import { ConversationModel, DocumentModel, UserModel } from './models'

export type {
  ChatMessageEntity,
  ConversationEntity,
  DocumentEntity,
  DocumentStatus,
  SourceRef,
  UserEntity,
} from './models'

// ---------------------------------------------------------------------------
// Demo seed data (only inserted when the collections are empty)
// ---------------------------------------------------------------------------

const MB = 1024 * 1024
const hoursAgo = (h: number): Date => new Date(Date.now() - h * 3_600_000)

const SEED_USERS: UserEntity[] = [
  { email: 'demo@nexa.ai', password: 'password123', name: 'John Doe' },
]

const SEED_DOCUMENTS: DocumentEntity[] = [
  {
    fileName: 'Employee Handbook.pdf',
    fileSizeBytes: 12.4 * MB,
    status: 'completed',
    uploadedAt: hoursAgo(30),
    pageCount: 64,
  },
  {
    fileName: 'Leave Policy.pdf',
    fileSizeBytes: 5.7 * MB,
    status: 'completed',
    uploadedAt: hoursAgo(31),
    pageCount: 21,
  },
  {
    fileName: 'IT Security Guide.pdf',
    fileSizeBytes: 3.2 * MB,
    status: 'processing',
    uploadedAt: hoursAgo(32),
    pageCount: 0,
  },
  {
    fileName: 'Company Overview.pdf',
    fileSizeBytes: 8.5 * MB,
    status: 'failed',
    uploadedAt: hoursAgo(40),
    pageCount: 0,
  },
]

const SEED_CONVERSATIONS: ConversationEntity[] = [
  {
    title: 'Leave policy questions',
    preview: 'How many days of annual leave do employees get?',
    date: hoursAgo(2),
    messages: [
      {
        role: 'user',
        content: 'How many days of annual leave do employees get?',
        timestamp: hoursAgo(2),
      },
      {
        role: 'assistant',
        content:
          "## Annual leave allowance\n\nEmployees are entitled to **24 days** of annual leave per year according to the company's leave policy.",
        timestamp: hoursAgo(2),
        sources: [{ name: 'Leave Policy.pdf', page: 12, relevance: '98% match' }],
      },
    ],
  },
  {
    title: 'IT security guidelines',
    preview: 'What are the password requirements?',
    date: hoursAgo(14),
    messages: [
      {
        role: 'user',
        content: 'What are the password requirements?',
        timestamp: hoursAgo(14),
      },
      {
        role: 'assistant',
        content:
          '## Password policy\n\nPasswords must be at least **12 characters** long and include upper/lowercase letters, a number and a symbol. Multi-factor authentication (MFA) is mandatory for corporate accounts.',
        timestamp: hoursAgo(14),
        sources: [{ name: 'IT Security Guide.pdf', page: 5, relevance: '91% match' }],
      },
    ],
  },
  {
    title: 'Company overview',
    preview: 'What does the company do?',
    date: hoursAgo(72),
    messages: [
      {
        role: 'user',
        content: 'What does the company do?',
        timestamp: hoursAgo(72),
      },
      {
        role: 'assistant',
        content:
          '## Company overview\n\nThe company builds **AI-powered enterprise knowledge tools** that help teams turn internal documents into searchable, answerable knowledge bases.',
        timestamp: hoursAgo(72),
        sources: [{ name: 'Company Overview.pdf', page: 3, relevance: '95% match' }],
      },
    ],
  },
  {
    title: 'Remote work policy',
    preview: 'Can employees work from home?',
    date: hoursAgo(96),
    messages: [
      {
        role: 'user',
        content: 'Can employees work from home?',
        timestamp: hoursAgo(96),
      },
      {
        role: 'assistant',
        content:
          '## Remote work\n\nEmployees may request **flexible or fully remote** working arrangements through HR. Approval depends on role and team requirements.',
        timestamp: hoursAgo(96),
        sources: [{ name: 'Employee Handbook.pdf', page: 8, relevance: '88% match' }],
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// Repository facade around the Mongoose models
// ---------------------------------------------------------------------------

/**
 * Think of this as the "data access layer". Every feature service injects this
 * class and talks to `.users / .documents / .conversations` (Mongoose models)
 * instead of touching MongoDB directly. Swapping the ODM or adding a second
 * data source later only touches this one file.
 */
@Injectable()
export class DatabaseService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseService.name)

  readonly users = UserModel
  readonly documents = DocumentModel
  readonly conversations = ConversationModel

  /** Called automatically once the app has finished bootstrapping. */
  async onApplicationBootstrap(): Promise<void> {
    await this.seedIfEmpty()
  }

  /**
   * Insert demo data the first time the database is empty, so the frontend
   * always has something to show. Safe to re-run: it is a no-op once data
   * exists.
   */
  private async seedIfEmpty(): Promise<void> {
    if (mongoose.connection.readyState !== 1) {
      this.logger.warn('MongoDB not connected - skipping seed')
      return
    }

    if ((await this.documents.countDocuments()) === 0) {
      await this.documents.insertMany(SEED_DOCUMENTS)
      this.logger.log('Seeded demo documents')
    }

    if ((await this.conversations.countDocuments()) === 0) {
      await this.conversations.insertMany(SEED_CONVERSATIONS)
      this.logger.log('Seeded demo conversations')
    }

    if ((await this.users.countDocuments()) === 0) {
      await this.users.insertMany(SEED_USERS)
      this.logger.log('Seeded demo user (demo@nexa.ai)')
    }
  }
}