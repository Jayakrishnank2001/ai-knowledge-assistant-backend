import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'

// ---------------------------------------------------------------------------
// Entity types (the "shape" of every record stored in memory)
// ---------------------------------------------------------------------------

export type DocumentStatus = 'processing' | 'completed' | 'failed'

export interface SourceRef {
  name: string
  page: number
  relevance?: string
}

export interface ChatMessageEntity {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  sources?: SourceRef[]
}

export interface ConversationEntity {
  id: string
  title: string
  preview: string
  date: Date
  messages: ChatMessageEntity[]
}

export interface DocumentEntity {
  id: string
  fileName: string
  fileSizeBytes: number
  status: DocumentStatus
  uploadedAt: Date
  pageCount: number
}

export interface UserEntity {
  id: string
  email: string
  password: string
  name: string
}

// ---------------------------------------------------------------------------
// Helpers for the seed data
// ---------------------------------------------------------------------------

const MB = 1024 * 1024
const hoursAgo = (h: number): Date => new Date(Date.now() - h * 3_600_000)

/**
 * Tiny in-memory "database".
 *
 * For a real application you would swap these arrays for a Postgres /
 * MongoDB collection (e.g. via TypeORM, Prisma or Mongoose). Keeping the
 * records in memory makes this demo restart-friendly to reason about and
 * easy to replace later.
 */
@Injectable()
export class DatabaseService {
  readonly users: UserEntity[] = [
    { id: 'user_1', email: 'demo@nexa.ai', password: 'password123', name: 'John Doe' },
  ]

  readonly documents: DocumentEntity[] = [
    {
      id: 'doc_1',
      fileName: 'Employee Handbook.pdf',
      fileSizeBytes: 12.4 * MB,
      status: 'completed',
      uploadedAt: hoursAgo(30),
      pageCount: 64,
    },
    {
      id: 'doc_2',
      fileName: 'Leave Policy.pdf',
      fileSizeBytes: 5.7 * MB,
      status: 'completed',
      uploadedAt: hoursAgo(31),
      pageCount: 21,
    },
    {
      id: 'doc_3',
      fileName: 'IT Security Guide.pdf',
      fileSizeBytes: 3.2 * MB,
      status: 'processing',
      uploadedAt: hoursAgo(32),
      pageCount: 0,
    },
    {
      id: 'doc_4',
      fileName: 'Company Overview.pdf',
      fileSizeBytes: 8.5 * MB,
      status: 'failed',
      uploadedAt: hoursAgo(40),
      pageCount: 0,
    },
  ]

  readonly conversations: ConversationEntity[] = [
    {
      id: 'conv_1',
      title: 'Leave policy questions',
      preview: 'How many days of annual leave do employees get?',
      date: hoursAgo(2),
      messages: [
        {
          id: 'msg_1',
          role: 'user',
          content: 'How many days of annual leave do employees get?',
          timestamp: hoursAgo(2),
        },
        {
          id: 'msg_2',
          role: 'assistant',
          content:
            "## Annual leave allowance\n\nEmployees are entitled to **24 days** of annual leave per year according to the company's leave policy.",
          timestamp: hoursAgo(2),
          sources: [{ name: 'Leave Policy.pdf', page: 12, relevance: '98% match' }],
        },
      ],
    },
    {
      id: 'conv_2',
      title: 'IT security guidelines',
      preview: 'What are the password requirements?',
      date: hoursAgo(14),
      messages: [
        {
          id: 'msg_3',
          role: 'user',
          content: 'What are the password requirements?',
          timestamp: hoursAgo(14),
        },
        {
          id: 'msg_4',
          role: 'assistant',
          content:
            '## Password policy\n\nPasswords must be at least **12 characters** long and include upper/lowercase letters, a number and a symbol. Multi-factor authentication (MFA) is mandatory for corporate accounts.',
          timestamp: hoursAgo(14),
          sources: [{ name: 'IT Security Guide.pdf', page: 5, relevance: '91% match' }],
        },
      ],
    },
    {
      id: 'conv_3',
      title: 'Company overview',
      preview: 'What does the company do?',
      date: hoursAgo(72),
      messages: [
        {
          id: 'msg_5',
          role: 'user',
          content: 'What does the company do?',
          timestamp: hoursAgo(72),
        },
        {
          id: 'msg_6',
          role: 'assistant',
          content:
            '## Company overview\n\nThe company builds **AI-powered enterprise knowledge tools** that help teams turn internal documents into searchable, answerable knowledge bases.',
          timestamp: hoursAgo(72),
          sources: [{ name: 'Company Overview.pdf', page: 3, relevance: '95% match' }],
        },
      ],
    },
    {
      id: 'conv_4',
      title: 'Remote work policy',
      preview: 'Can employees work from home?',
      date: hoursAgo(96),
      messages: [
        {
          id: 'msg_7',
          role: 'user',
          content: 'Can employees work from home?',
          timestamp: hoursAgo(96),
        },
        {
          id: 'msg_8',
          role: 'assistant',
          content:
            '## Remote work\n\nEmployees may request **flexible or fully remote** working arrangements through HR. Approval depends on role and team requirements.',
          timestamp: hoursAgo(96),
          sources: [{ name: 'Employee Handbook.pdf', page: 8, relevance: '88% match' }],
        },
      ],
    },
  ]

  /** Generate a unique id like "doc_3f2a..." */
  nextId(prefix: string): string {
    return `${prefix}_${randomUUID()}`
  }
}