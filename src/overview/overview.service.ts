import { Injectable } from '@nestjs/common'
import { DatabaseService } from '../database/database.service'

@Injectable()
export class OverviewService {
  constructor(private readonly db: DatabaseService) {}

  async stats() {
    const total = await this.db.documents.countDocuments()
    const completed = await this.db.documents.countDocuments({ status: 'completed' })

    const pagesRows = await this.db.documents.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$pageCount' } } },
    ])
    const pages = pagesRows.length ? Number(pagesRows[0].total) : 0

    const questionsRows = await this.db.conversations.aggregate([
      { $unwind: '$messages' },
      { $match: { 'messages.role': 'assistant' } },
      { $count: 'answered' },
    ])

    return {
      documents: total,
      pages,
      processedPercent: total ? Math.round((completed / total) * 100) : 0,
      conversations: await this.db.conversations.countDocuments(),
      questionsAnswered: questionsRows.length ? Number(questionsRows[0].answered) : 0,
    }
  }

  async recentDocuments() {
    const docs = await this.db.documents.find().sort({ uploadedAt: -1 }).limit(5).exec()
    return docs.map((doc) => ({
      id: doc._id.toString(),
      name: doc.fileName,
      pages: doc.pageCount,
      daysAgo: Math.max(0, Math.floor((Date.now() - doc.uploadedAt.getTime()) / 86_400_000)),
      status: doc.status,
    }))
  }
}