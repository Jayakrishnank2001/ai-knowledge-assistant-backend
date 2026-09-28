import { Injectable } from '@nestjs/common'
import mongoose from 'mongoose'
import { DatabaseService, DocumentEntity } from '../database/database.service'

/**
 * Dashboard figures for ONE logged-in user.
 *
 * Scoping mirrors the pages these numbers summarise, so they always match what
 * the user can actually open:
 *   - documents / pages: the user's own uploads PLUS the shared company
 *     knowledge base (`userId: null` - the same rows the Documents page lists
 *     and RAG retrieval may cite)
 *   - conversations / questions: strictly the user's own, because chat history
 *     is private
 */
@Injectable()
export class OverviewService {
  constructor(private readonly db: DatabaseService) {}

  /** Documents visible to this user: their own uploads + the shared knowledge base. */
  private documentScope(userId: string): mongoose.FilterQuery<DocumentEntity> {
    return { $or: [{ userId: null }, { userId }] }
  }

  async stats(userId: string) {
    const scope = this.documentScope(userId)

    const total = await this.db.documents.countDocuments(scope)
    const completed = await this.db.documents.countDocuments({ ...scope, status: 'completed' })

    // Page counts are summed with a normal query rather than an aggregation
    // pipeline: Mongoose casts the user id for queries, but NOT inside a
    // pipeline $match, where a string id would silently match nothing.
    const completedDocs = await this.db.documents
      .find({ ...scope, status: 'completed' }, { pageCount: 1 })
      .exec()
    const pages = completedDocs.reduce((sum, doc) => sum + (doc.pageCount ?? 0), 0)

    // Chat history is per-user: resolve this user's conversation ids first and
    // count only the assistant messages that belong to them.
    const conversations = await this.db.conversations.find({ userId }, { _id: 1 }).exec()
    const conversationIds = conversations.map((conversation) => conversation._id.toString())
    const questionsAnswered = conversationIds.length
      ? await this.db.messages.countDocuments({
          conversationId: { $in: conversationIds },
          role: 'assistant',
        })
      : 0

    return {
      documents: total,
      pages,
      processedPercent: total ? Math.round((completed / total) * 100) : 0,
      conversations: conversationIds.length,
      questionsAnswered,
    }
  }

  async recentDocuments(userId: string) {
    const docs = await this.db.documents
      .find(this.documentScope(userId))
      .sort({ uploadedAt: -1 })
      .limit(5)
      .exec()
    return docs.map((doc) => ({
      id: doc._id.toString(),
      name: doc.fileName,
      pages: doc.pageCount,
      daysAgo: Math.max(0, Math.floor((Date.now() - doc.uploadedAt.getTime()) / 86_400_000)),
      status: doc.status,
    }))
  }
}