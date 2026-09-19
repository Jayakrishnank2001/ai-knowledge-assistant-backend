import { Injectable } from '@nestjs/common'
import { DatabaseService } from '../database/database.service'

@Injectable()
export class OverviewService {
  constructor(private readonly db: DatabaseService) {}

  stats() {
    const documents = this.db.documents
    const completed = documents.filter((doc) => doc.status === 'completed')
    const processedPercent = documents.length
      ? Math.round((completed.length / documents.length) * 100)
      : 0

    return {
      documents: documents.length,
      pages: completed.reduce((sum, doc) => sum + doc.pageCount, 0),
      processedPercent,
      conversations: this.db.conversations.length,
      questionsAnswered: this.db.conversations.reduce(
        (sum, conv) => sum + conv.messages.filter((m) => m.role === 'assistant').length,
        0,
      ),
    }
  }

  recentDocuments() {
    return this.db.documents
      .slice()
      .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())
      .slice(0, 5)
      .map((doc) => ({
        id: doc.id,
        name: doc.fileName,
        pages: doc.pageCount,
        daysAgo: Math.max(0, Math.floor((Date.now() - doc.uploadedAt.getTime()) / 86_400_000)),
        status: doc.status,
      }))
  }
}