import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import mongoose from 'mongoose'
import { DatabaseService, DocumentEntity, SourceRef } from '../database/database.service'
import { VECTOR_INDEX_NAME, VectorIndexService } from '../database/vector-index.service'
import { similarityLabel } from '../documents/embedding.util'
import { EmbeddingProvider, EmbeddingProviderFactory } from '../providers/embedding.provider'
import { LlmProvider, LlmProviderFactory } from '../providers/llm.provider'
import { RawChunk, ScoredChunk, rankChunks } from './retrieval.util'

/** How many nearest neighbours Atlas returns before we re-rank them exactly. */
const VECTOR_SEARCH_CANDIDATES = 100

@Injectable()
export class KnowledgeBaseService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeBaseService.name)
  private embeddingProvider!: EmbeddingProvider
  private llmProvider!: LlmProvider
  private vectorSearchWarned = false

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly embeddingFactory: EmbeddingProviderFactory,
    private readonly llmFactory: LlmProviderFactory,
    private readonly vectorIndex: VectorIndexService,
  ) {}

  onModuleInit() {
    this.embeddingProvider = this.embeddingFactory.getProvider()
    this.llmProvider = this.llmFactory.getProvider()
    this.logger.log(
      `KnowledgeBaseService ready: ${this.embeddingProvider.name} ` +
        `(${this.embeddingProvider.dimensions}-dim) + ${this.llmProvider.constructor.name}, ` +
        `Atlas vector search ${this.vectorIndex.isReady() ? 'ON' : 'off'}`,
    )
  }

  /**
   * Resolve the LLM provider at call time, not from the field frozen during
   * onModuleInit - the settings endpoint can swap GEMINI_CHAT_MODEL at runtime
   * and the factory returns a fresh provider for the new cache key.
   * (Embeddings stay frozen on purpose: they must match the indexed vectors.)
   */
  private llm(): LlmProvider {
    return this.llmFactory.getProvider()
  }

  /** Retrieval scope: the shared knowledge base (userId: null) + the caller's own documents. */
  async ask(
    question: string,
    userId?: string | null,
  ): Promise<{ answer: string; sources: SourceRef[] }> {
    const llm = this.llm()
    const queryVector = await this.embeddingProvider.embedQuery(question)
    const documentIds = await this.accessibleDocumentIds(userId)

    if (documentIds.length === 0) {
      this.logger.warn('No documents are visible to this user - answering without context')
      return { answer: await llm.generateAnswer(question, []), sources: [] }
    }

    const { ranked, dimensionMismatches } = await this.retrieve(queryVector, documentIds)

    if (dimensionMismatches > 0) {
      this.logger.warn(
        `Skipped ${dimensionMismatches} chunk(s) whose vector width is not ${queryVector.length}. ` +
          'Run `npm run reindex` after changing embedding models.',
      )
    }

    if (ranked.length === 0) {
      this.logger.warn(
        `No chunk reached the similarity floor (${this.minSimilarity()}) for "${question}"`,
      )
      return { answer: await llm.generateAnswer(question, []), sources: [] }
    }

    const names = await this.documentNames(ranked)
    const nameOf = (chunk: ScoredChunk): string => names.get(chunk.documentId) ?? 'Knowledge base'

    this.logger.log(
      `Retrieved ${ranked.length} chunk(s) for "${question}" (top score ${ranked[0].score.toFixed(3)})`,
    )

    return {
      answer: await llm.generateAnswer(
        question,
        ranked.map((chunk) => ({
          text: chunk.content,
          documentName: nameOf(chunk),
          page: chunk.pageNumber,
        })),
      ),
      sources: ranked.map((chunk) => ({
        name: nameOf(chunk),
        page: chunk.pageNumber,
        relevance: similarityLabel(chunk.score),
      })),
    }
  }

  // -------------------------------------------------------------------------
  // Retrieval
  // -------------------------------------------------------------------------

  private async accessibleDocumentIds(userId?: string | null): Promise<string[]> {
    const scope: mongoose.FilterQuery<DocumentEntity> = userId
      ? { $or: [{ userId: null }, { userId }] }
      : { userId: null }
    const docs = await this.db.documents.find(scope, { _id: 1 }).exec()
    return docs.map((doc) => doc._id.toString())
  }

  /**
   * Prefers Atlas Vector Search (indexed approximate search) and falls back to
   * an in-process cosine scan when the index is missing, still building, or the
   * deployment does not support vector search. Both paths rank through
   * `rankChunks`, so results stay comparable.
   */
  private async retrieve(queryVector: number[], documentIds: string[]) {
    const options = {
      minSimilarity: this.minSimilarity(),
      topK: this.numberFromConfig('RAG_TOP_K', 6),
      maxPerDocument: this.numberFromConfig('RAG_MAX_CHUNKS_PER_DOCUMENT', 3),
    }

    if (this.vectorIndex.isReady()) {
      try {
        const candidates = await this.atlasVectorSearch(queryVector, documentIds)
        return rankChunks(queryVector, candidates, options)
      } catch (error) {
        if (!this.vectorSearchWarned) {
          this.vectorSearchWarned = true
          this.logger.warn(
            `Atlas $vectorSearch failed (${(error as Error).message}) - ` +
              'falling back to the in-process cosine scan',
          )
        }
      }
    }

    return rankChunks(queryVector, await this.loadChunks(documentIds), options)
  }

  /**
   * Atlas returns candidates pre-sorted by its own score; we re-score them
   * exactly in `rankChunks` so the Atlas and fallback paths agree.
   */
  private async atlasVectorSearch(
    queryVector: number[],
    documentIds: string[],
  ): Promise<RawChunk[]> {
    const db = mongoose.connection.db
    if (!db) throw new Error('MongoDB is not connected')

    const rows = await db
      .collection('document_chunks')
      .aggregate([
        {
          $vectorSearch: {
            index: VECTOR_INDEX_NAME,
            path: 'embedding',
            queryVector,
            numCandidates: Math.max(VECTOR_SEARCH_CANDIDATES, documentIds.length * 10),
            limit: VECTOR_SEARCH_CANDIDATES,
            filter: {
              documentId: { $in: documentIds.map((id) => new mongoose.Types.ObjectId(id)) },
            },
          },
        },
        { $project: { documentId: 1, content: 1, pageNumber: 1, embedding: 1 } },
      ])
      .toArray()

    return rows.map((row) => ({
      chunkId: String(row._id),
      documentId: String(row.documentId),
      content: String(row.content),
      pageNumber: Number(row.pageNumber),
      embedding: (row.embedding ?? []) as number[],
    }))
  }

  /** Fallback path: only the chunks of the documents this user may read. */
  private async loadChunks(documentIds: string[]): Promise<RawChunk[]> {
    const chunks = await this.db.chunks.find({ documentId: { $in: documentIds } }).exec()
    return chunks.map((chunk) => ({
      chunkId: chunk._id.toString(),
      documentId: chunk.documentId.toString(),
      content: chunk.content,
      pageNumber: chunk.pageNumber,
      embedding: chunk.embedding,
    }))
  }

  private async documentNames(ranked: ScoredChunk[]): Promise<Map<string, string>> {
    const ids = [...new Set(ranked.map((chunk) => chunk.documentId))]
    const docs = await this.db.documents.find({ _id: { $in: ids } }, { fileName: 1 }).exec()
    return new Map(docs.map((doc) => [doc._id.toString(), doc.fileName]))
  }

  // -------------------------------------------------------------------------
  // Config
  // -------------------------------------------------------------------------

  /** RAG_MIN_SIMILARITY wins; otherwise the active provider's own default. */
  private minSimilarity(): number {
    const configured = Number(this.config.get<string>('RAG_MIN_SIMILARITY'))
    return Number.isFinite(configured) && configured > 0
      ? configured
      : this.embeddingProvider.defaultMinSimilarity
  }

  private numberFromConfig(key: string, fallback: number): number {
    const value = Number(this.config.get<string>(key))
    return Number.isFinite(value) && value > 0 ? value : fallback
  }
}
