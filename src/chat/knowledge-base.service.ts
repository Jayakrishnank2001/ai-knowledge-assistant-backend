import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import mongoose from 'mongoose'
import { DatabaseService, DocumentEntity, SourceRef } from '../database/database.service'
import { VECTOR_INDEX_NAME, VectorIndexService } from '../database/vector-index.service'
import { similarityLabel } from '../documents/embedding.util'
import { EmbeddingProvider, EmbeddingProviderFactory } from '../providers/embedding.provider'
import { LlmProvider, LlmProviderFactory } from '../providers/llm.provider'
import { RawChunk, ScoredChunk, rankChunks } from './retrieval.util'

/** One Sources-card entry: merged text of every retrieved chunk from a document page. */
interface SourceGroup {
  documentName: string;
  pageNumber: number;
  /** Best chunk score in the group, used for the relevance label. */
  score: number;
  chunks: ScoredChunk[];
}

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

    const groups = this.groupSources(ranked, nameOf);
    const context = groups.map((group) => ({
      text: group.chunks.map((c) => c.content).join('\n\n'),
      documentName: group.documentName,
      page: group.pageNumber,
    }));

    const llmAnswer = await llm.generateAnswer(question, context);
    return {
      answer: llmAnswer,
      sources: this.citedSources(llmAnswer, groups),
    }
  }

  // -------------------------------------------------------------------------
  // Retrieval
  // -------------------------------------------------------------------------

  /**
   * Keep the sources card honest: only chunks whose [Source N] tag the model
   * actually wrote in its answer stay visible. Falls back to the top chunk
   * when the model cited nothing, so the card is never empty.
   */
  private groupSources(ranked: ScoredChunk[], nameOf: (chunk: ScoredChunk) => string): SourceGroup[] {
    const groups: SourceGroup[] = [];
    const indexByKey = new Map();
    for (const chunk of ranked) {
      const documentName = nameOf(chunk);
      const key = documentName + '|' + chunk.pageNumber;
      let group = indexByKey.get(key);
      if (!group) {
        group = { documentName, pageNumber: chunk.pageNumber, score: chunk.score, chunks: [] };
        indexByKey.set(key, groups.length);
        groups.push(group);
      } else {
        group = groups[indexByKey.get(key)];
        group.score = Math.max(group.score, chunk.score);
      }
      group.chunks.push(chunk);
    }
    return groups;
  }

  private citedSources(answer: string, groups: SourceGroup[]): SourceRef[] {
    const cited = new Set<number>();
    const pattern = /\[Source\s+(\d+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(answer)) !== null) {
      const index = Number(match[1]) - 1;
      if (Number.isInteger(index) && index >= 0 && index < groups.length) cited.add(index);
    }
    const visible = (cited.size > 0 ? [...cited] : [0]).sort((a, b) => a - b);
    return visible.map((index) => ({
      name: groups[index].documentName,
      page: groups[index].pageNumber,
      relevance: similarityLabel(groups[index].score),
    }));
  }

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
      relevanceMargin: this.numberFromConfig('RAG_RELEVANCE_MARGIN', 0.04),
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
