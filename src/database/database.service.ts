import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import mongoose from 'mongoose'
import { buildChunkSeeds, embedText } from '../documents/embedding.util'
import {
  DocumentChunkEntity,
  DocumentEntity,
  MessageEntity,
  UserEntity,
} from './models'
import {
  ConversationModel,
  DocumentChunkModel,
  DocumentModel,
  MessageModel,
  UserModel,
} from './models'

export type {
  ConversationEntity,
  DocumentChunkEntity,
  DocumentEntity,
  DocumentStatus,
  MessageEntity,
  SourceRef,
  UserEntity,
} from './models'

// ---------------------------------------------------------------------------
// Demo seed data (only inserted when the collections are empty)
// ---------------------------------------------------------------------------

const MB = 1024 * 1024
const hoursAgo = (h: number): Date => new Date(Date.now() - h * 3_600_000)

const SEED_USERS: UserEntity[] = [
  {
    email: 'demo@nexa.ai',
    password: 'password123',
    name: 'John Doe',
    workspaceName: 'Acme knowledge base',
  },
]

const SEED_DOCUMENTS: DocumentEntity[] = [
  {
    userId: null,
    fileName: 'Employee Handbook.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 12.4 * MB,
    status: 'completed',
    uploadedAt: hoursAgo(30),
    pageCount: 3,
    gridFsFileId: null,
  },
  {
    userId: null,
    fileName: 'Leave Policy.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 5.7 * MB,
    status: 'completed',
    uploadedAt: hoursAgo(31),
    pageCount: 2,
    gridFsFileId: null,
  },
  {
    userId: null,
    fileName: 'IT Security Guide.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 3.2 * MB,
    status: 'processing',
    uploadedAt: hoursAgo(32),
    pageCount: 2,
    gridFsFileId: null,
  },
  {
    userId: null,
    fileName: 'Company Overview.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 8.5 * MB,
    status: 'failed',
    uploadedAt: hoursAgo(40),
    pageCount: 2,
    gridFsFileId: null,
  },
]

interface SeedConversation {
  title: string
  preview: string
  date: Date
  messages: MessageEntity[]
}

const SEED_CONVERSATIONS: SeedConversation[] = [
  {
    title: 'Leave policy questions',
    preview: 'How many days of annual leave do employees get?',
    date: hoursAgo(2),
    messages: [
      { conversationId: '', role: 'user', content: 'How many days of annual leave do employees get?', timestamp: hoursAgo(2) },
      {
        conversationId: '',
        role: 'assistant',
        content:
          "## Annual leave allowance\n\nEmployees are entitled to **24 days** of annual leave per year according to the company's leave policy.",
        timestamp: hoursAgo(2),
        sources: [{ name: 'Leave Policy.pdf', page: 1, relevance: '98% match' }],
      },
    ],
  },
  {
    title: 'IT security guidelines',
    preview: 'What are the password requirements?',
    date: hoursAgo(14),
    messages: [
      { conversationId: '', role: 'user', content: 'What are the password requirements?', timestamp: hoursAgo(14) },
      {
        conversationId: '',
        role: 'assistant',
        content:
          '## Password policy\n\nPasswords must be at least **12 characters** long and include upper/lowercase letters, a number and a symbol. Multi-factor authentication (MFA) is mandatory for corporate accounts.',
        timestamp: hoursAgo(14),
        sources: [{ name: 'IT Security Guide.pdf', page: 1, relevance: '91% match' }],
      },
    ],
  },
  {
    title: 'Company overview',
    preview: 'What does the company do?',
    date: hoursAgo(72),
    messages: [
      { conversationId: '', role: 'user', content: 'What does the company do?', timestamp: hoursAgo(72) },
      {
        conversationId: '',
        role: 'assistant',
        content:
          '## Company overview\n\nThe company builds **AI-powered enterprise knowledge tools** that help teams turn internal documents into searchable, answerable knowledge bases.',
        timestamp: hoursAgo(72),
        sources: [{ name: 'Company Overview.pdf', page: 1, relevance: '95% match' }],
      },
    ],
  },
  {
    title: 'Remote work policy',
    preview: 'Can employees work from home?',
    date: hoursAgo(96),
    messages: [
      { conversationId: '', role: 'user', content: 'Can employees work from home?', timestamp: hoursAgo(96) },
      {
        conversationId: '',
        role: 'assistant',
        content:
          '## Remote work\n\nEmployees may request **flexible or fully remote** working arrangements through HR. Approval depends on role and team requirements.',
        timestamp: hoursAgo(96),
        sources: [{ name: 'Employee Handbook.pdf', page: 1, relevance: '88% match' }],
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// Repository facade around the Mongoose models
// ---------------------------------------------------------------------------

/**
 * Think of this as the "data access layer". Every feature service injects this
 * class and talks to `.users / .documents / .chunks / .conversations /
 * .messages` (Mongoose models) instead of touching MongoDB directly.
 */
@Injectable()
export class DatabaseService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseService.name)

  readonly users = UserModel
  readonly documents = DocumentModel
  readonly chunks = DocumentChunkModel
  readonly conversations = ConversationModel
  readonly messages = MessageModel

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

    // users ----------------------------------------------------------------
    if ((await this.users.countDocuments()) === 0) {
      await this.users.insertMany(SEED_USERS)
      this.logger.log('Seeded demo user (demo@nexa.ai)')
    }

    // backfill the workspaceName field for rows created before it existed
    const backfilled = await this.users.updateMany(
      { workspaceName: { $exists: false } },
      { $set: { workspaceName: 'Acme knowledge base' } },
    )
    if (backfilled.modifiedCount > 0) {
      this.logger.log(`Backfilled workspaceName for ${backfilled.modifiedCount} user(s)`)
    }

    // documents + document_chunks ------------------------------------------
    if ((await this.documents.countDocuments()) === 0) {
      const docs = await this.documents.insertMany(SEED_DOCUMENTS)
      const chunkDocs: DocumentChunkEntity[] = []
      for (const doc of docs) {
        for (const seed of buildChunkSeeds(doc.fileName)) {
          chunkDocs.push({
            documentId: doc._id.toString(),
            content: seed.content,
            pageNumber: seed.pageNumber,
            chunkIndex: seed.chunkIndex,
            embedding: embedText(seed.content),
          })
        }
      }
      await this.chunks.insertMany(chunkDocs)
      this.logger.log(
        `Seeded ${docs.length} demo documents + ${chunkDocs.length} chunks`,
      )
    }

    // conversations + messages ----------------------------------------------
    if ((await this.conversations.countDocuments()) === 0) {
      const inserted = await this.conversations.insertMany(
        SEED_CONVERSATIONS.map((conv) => ({
          title: conv.title,
          preview: conv.preview,
          date: conv.date,
        })),
      )
      const messageDocs: MessageEntity[] = []
      SEED_CONVERSATIONS.forEach((conv, index) => {
        for (const message of conv.messages) {
          messageDocs.push({
            conversationId: inserted[index]._id.toString(),
            role: message.role,
            content: message.content,
            timestamp: message.timestamp,
            sources: message.sources,
          })
        }
      })
      await this.messages.insertMany(messageDocs)
      this.logger.log(
        `Seeded ${inserted.length} demo conversations + ${messageDocs.length} messages`,
      )
    }
  }
}