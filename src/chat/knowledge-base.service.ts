import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { DatabaseService, SourceRef } from '../database/database.service'
import { cosineSimilarity, similarityLabel } from '../documents/embedding.util'
import { EmbeddingProvider, EmbeddingProviderFactory } from '../providers/embedding.provider'
import { LlmProvider, LlmProviderFactory } from '../providers/llm.provider'

@Injectable()
export class KnowledgeBaseService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeBaseService.name)
  private embeddingProvider!: EmbeddingProvider
  private llmProvider!: LlmProvider
  private readonly MIN_SIMILARITY = 0.12

  constructor(
    private readonly db: DatabaseService,
    private readonly embeddingFactory: EmbeddingProviderFactory,
    private readonly llmFactory: LlmProviderFactory,
  ) {}

  onModuleInit() {
    this.embeddingProvider = this.embeddingFactory.getProvider()
    this.llmProvider = this.llmFactory.getProvider()
    this.logger.log(`KnowledgeBaseService initialized with ${this.embeddingProvider.constructor.name} + ${this.llmProvider.constructor.name}`)
  }

  async ask(question: string, userId?: string | null): Promise<{ answer: string; sources: SourceRef[] }> {
    const questionEmbedding = await this.embeddingProvider.embed(question)

    // Retrieval scope: the shared knowledge base (userId: null) + the caller's own documents
    const scope = userId ? { $or: [{ userId: null }, { userId }] } : { userId: null }
    const accessibleDocs = await this.db.documents.find(scope, { _id: 1 }).exec()
    const accessibleIds = new Set(accessibleDocs.map((doc) => doc._id.toString()))

    const chunks = (await this.db.chunks.find().exec()).filter((chunk) =>
      accessibleIds.has(chunk.documentId.toString()),
    )

    if (chunks.length === 0) {
      const answer = await this.llmProvider.generateAnswer(question, [])
      const newest = await this.db.documents
        .findOne({ status: 'completed' })
        .sort({ uploadedAt: -1 })
        .exec()
      return {
        answer,
        sources: newest
          ? [{ name: newest.fileName, page: 1, relevance: 'No direct match' }]
          : [{ name: 'Knowledge base', page: 1, relevance: 'No direct match' }],
      }
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
      .filter(({ score }) => score >= this.MIN_SIMILARITY)
      .slice(0, 3)

    if (bestPerDocument.length === 0) {
      const answer = await this.llmProvider.generateAnswer(question, [])
      const newest = await this.db.documents
        .findOne({ status: 'completed' })
        .sort({ uploadedAt: -1 })
        .exec()
      return {
        answer,
        sources: newest
          ? [{ name: newest.fileName, page: 1, relevance: 'No direct match' }]
          : [{ name: 'Knowledge base', page: 1, relevance: 'No direct match' }],
      }
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

    const context = bestPerDocument.map(({ chunk }) => ({
      text: chunk.content,
      documentName: documentById.get(chunk.documentId.toString())?.fileName ?? 'Knowledge base',
      page: chunk.pageNumber,
    }))

    const answer = await this.llmProvider.generateAnswer(question, context)
    return { answer, sources }
  }
}