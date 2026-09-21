import { Injectable } from '@nestjs/common'
import { DatabaseService, SourceRef } from '../database/database.service'
import {
  cosineSimilarity,
  embedText,
  MIN_SIMILARITY,
  similarityLabel,
} from '../documents/embedding.util'

/**
 * Retrieval Augmented Generation (RAG) against `document_chunks`.
 *
 * Flow for every question:
 *   1. embed the question (mock embedding - swap for a real model later)
 *   2. rank every stored chunk by cosine similarity
 *   3. keep the best chunk per document (no duplicate sources), min similarity
 *   4. build the answer from the top chunk texts + cite their documents/pages
 */
@Injectable()
export class KnowledgeBaseService {
  constructor(private readonly db: DatabaseService) {}

  async ask(question: string, userId?: string | null): Promise<{ answer: string; sources: SourceRef[] }> {
    const questionEmbedding = embedText(question)

    // Retrieval scope: the shared knowledge base (userId: null) + the caller's own documents
    const scope = userId ? { $or: [{ userId: null }, { userId }] } : { userId: null }
    const accessibleDocs = await this.db.documents.find(scope, { _id: 1 }).exec()
    const accessibleIds = new Set(accessibleDocs.map((doc) => doc._id.toString()))

    const chunks = (await this.db.chunks.find().exec()).filter((chunk) =>
      accessibleIds.has(chunk.documentId.toString()),
    )

    if (chunks.length === 0) {
      return this.fallbackAnswer(question)
    }

    const ranked = chunks
      .map((chunk) => ({
        chunk,
        score: cosineSimilarity(questionEmbedding, chunk.embedding),
      }))
      .sort((a, b) => b.score - a.score)

    // One chunk per document, sorted by relevance, above the similarity floor.
    const seenDocuments = new Set<string>()
    const bestPerDocument = ranked
      .filter(({ chunk }) => {
        const documentId = chunk.documentId.toString()
        if (seenDocuments.has(documentId)) return false
        seenDocuments.add(documentId)
        return true
      })
      .filter(({ score }) => score >= MIN_SIMILARITY)
      .slice(0, 3)

    if (bestPerDocument.length === 0) {
      return this.fallbackAnswer(question)
    }

    const documentIds = bestPerDocument.map(({ chunk }) => chunk.documentId.toString())
    const documents = await this.db.documents.find({ _id: { $in: documentIds } }).exec()
    const documentById = new Map(documents.map((doc) => [doc._id.toString(), doc]))

    const sources: SourceRef[] = bestPerDocument.map(({ chunk, score }) => {
      const document = documentById.get(chunk.documentId.toString())
      return {
        name: document?.fileName ?? 'Knowledge base',
        page: chunk.pageNumber,
        relevance: similarityLabel(score),
      }
    })

    const answer = bestPerDocument.map(({ chunk }) => chunk.content).join('\n\n')
    return {
      answer: `## Answer\n\n${answer}\n\nThis answer is grounded in the source documents below.`,
      sources,
    }
  }

  /** Used when the retrieval finds nothing similar enough. */
  private async fallbackAnswer(question: string): Promise<{ answer: string; sources: SourceRef[] }> {
    const newest = await this.db.documents
      .findOne({ status: 'completed' })
      .sort({ uploadedAt: -1 })
      .exec()
    return {
      answer: `I searched the knowledge base but could not find a direct match for "${question}". Try rephrasing your question or check that the relevant document has finished processing.`,
      sources: newest
        ? [{ name: newest.fileName, page: 1, relevance: 'No direct match' }]
        : [{ name: 'Knowledge base', page: 1, relevance: 'No direct match' }],
    }
  }
}