import { Injectable } from '@nestjs/common'
import { DatabaseService, SourceRef } from '../database/database.service'

interface KnowledgeEntry {
  documentName: string
  keywords: string[]
  content: string
  page: number
}

/**
 * A simulated "Retrieval Augmented Generation" (RAG) knowledge base.
 *
 * Real implementation: embed uploaded PDFs, store chunks + embeddings in a
 * vector database (pgvector, Pinecone, ...), find the most similar chunks
 * to the question and feed them to an LLM (OpenAI, Claude, ...).
 */
const ENTRY_POOL: KnowledgeEntry[] = [
  {
    documentName: 'Employee Handbook.pdf',
    keywords: ['working hours', 'work hours', 'lunch', 'remote', 'work from home', 'schedule', 'break'],
    content:
      'Standard working hours are **9:00 AM to 5:00 PM**, Monday to Friday. Employees are also allowed a 1-hour lunch break and may request flexible or remote working arrangements through HR.',
    page: 8,
  },
  {
    documentName: 'Leave Policy.pdf',
    keywords: ['annual leave', 'leave', 'vacation', 'holiday', 'days off', 'pto', 'days of annual'],
    content:
      'Employees are entitled to **24 days** of paid annual leave per year according to the leave policy. Requests should be submitted through the leave portal at least two weeks in advance.',
    page: 12,
  },
  {
    documentName: 'IT Security Guide.pdf',
    keywords: ['password', 'security', 'mfa', 'two-factor', 'login', 'credentials', 'passwords'],
    content:
      'Passwords must be at least **12 characters** long and include upper/lowercase letters, a number and a symbol. Multi-factor authentication (MFA) is mandatory for all corporate accounts.',
    page: 5,
  },
  {
    documentName: 'Company Overview.pdf',
    keywords: ['company', 'about', 'mission', 'product', 'overview', 'what does the company'],
    content:
      'The company builds **AI-powered enterprise knowledge tools** that help teams turn internal documents into searchable, answerable knowledge bases.',
    page: 3,
  },
]

@Injectable()
export class KnowledgeBaseService {
  constructor(private readonly db: DatabaseService) {}

  async ask(question: string): Promise<{ answer: string; sources: SourceRef[] }> {
    const normalized = question.toLowerCase()

    const score = (entry: KnowledgeEntry) =>
      entry.keywords.reduce((sum, keyword) => (normalized.includes(keyword) ? sum + 1 : sum), 0)

    const ranked = ENTRY_POOL.map((entry) => ({ entry, score: score(entry) })).sort(
      (a, b) => b.score - a.score,
    )
    const best = ranked[0]

    if (!best || best.score === 0) {
      return this.fallbackAnswer(question)
    }

    const relevance = Math.min(98, 86 + best.score * 3)
    return {
      answer: `## Answer\n\n${best.entry.content}\n\nThis answer is grounded in the source document${best.score > 1 ? 's' : ''} below.`,
      sources: [{ name: best.entry.documentName, page: best.entry.page, relevance: `${relevance}% match` }],
    }
  }

  /** Used when no keyword matches any known document. */
  private async fallbackAnswer(question: string): Promise<{ answer: string; sources: SourceRef[] }> {
    const newest = await this.db.documents
      .findOne({ status: 'completed' })
      .sort({ uploadedAt: -1 })
      .exec()
    return {
      answer: `I searched your knowledge base but could not find a direct match for "${question}". Try rephrasing your question or check that the relevant document has finished processing.`,
      sources: newest
        ? [{ name: newest.fileName, page: 1, relevance: 'No direct match' }]
        : [{ name: 'Knowledge base', page: 1, relevance: 'No direct match' }],
    }
  }
}