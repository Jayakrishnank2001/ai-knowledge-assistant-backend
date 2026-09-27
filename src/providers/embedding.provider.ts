import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GoogleGenAI } from '@google/genai'
import { EMBEDDING_DIM, embedText } from '../documents/embedding.util'

/** Gemini task types: queries and documents are embedded asymmetrically. */
type GeminiTaskType = 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT'

/**
 * An embedding model.
 *
 * Indexing and querying MUST go through the same provider: two different models
 * return vectors in different spaces (and often different widths), and mixing
 * them silently destroys every similarity score.
 */
export interface EmbeddingProvider {
  readonly name: string
  /** Width of every vector this provider returns. */
  readonly dimensions: number
  /** Default cosine floor for retrieval (RAG_MIN_SIMILARITY overrides it). */
  readonly defaultMinSimilarity: number
  /** Embed one search query (asymmetric retrieval: query task type). */
  embedQuery(text: string): Promise<number[]>
  /** Embed chunk texts for indexing (document task type, batched). */
  embedDocuments(texts: string[]): Promise<number[][]>
}

/**
 * Fails loudly if a provider returns a vector the Atlas Vector Search index
 * cannot use, instead of letting a bad width become a silent "no results".
 */
export function assertVectorWidth(vector: number[], expected: number, context: string): void {
  const actual = Array.isArray(vector) ? vector.length : 'none'
  if (actual !== expected) {
    throw new Error(
      `${context}: expected a ${expected}-dimension embedding but received ${actual}. ` +
        'Re-index the documents (npm run reindex) after changing embedding models.',
    )
  }
}

/**
 * Offline fallback: deterministic hashed bag-of-words. No network, no API key,
 * but keyword-based rather than semantic.
 */
@Injectable()
export class MockEmbeddingProvider implements EmbeddingProvider {
  private readonly logger = new Logger(MockEmbeddingProvider.name)
  readonly name = 'MockEmbeddingProvider'
  readonly dimensions = EMBEDDING_DIM
  readonly defaultMinSimilarity = 0.12

  async embedQuery(text: string): Promise<number[]> {
    return embedText(text)
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return texts.map((text) => embedText(text))
  }
}

/** Gemini caps how many inputs one embed request may carry. */
const GEMINI_BATCH_SIZE = 32

/**
 * Google Gemini embeddings (gemini-embedding-001 by default).
 *
 * `outputDimensionality` pins the width to EMBEDDING_DIM so switching between
 * this provider and the mock never changes the vector width - only the space
 * (which still requires a re-index to be meaningful).
 */
@Injectable()
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  private readonly logger = new Logger(GeminiEmbeddingProvider.name)
  readonly name = 'GeminiEmbeddingProvider'
  readonly dimensions = EMBEDDING_DIM
  readonly defaultMinSimilarity: number
  private readonly ai: GoogleGenAI
  private readonly model: string

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY')
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set - cannot create GeminiEmbeddingProvider')
    }
    this.ai = new GoogleGenAI({ apiKey })
    this.model = this.config.get<string>('GEMINI_EMBEDDING_MODEL') ?? 'gemini-embedding-001'
    this.defaultMinSimilarity = Number(this.config.get<string>('RAG_MIN_SIMILARITY') ?? 0.5)
    this.logger.log(`${this.name} ready (model: ${this.model}, ${this.dimensions}-dim)`)
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embed([text], 'RETRIEVAL_QUERY')
    assertVectorWidth(vector, this.dimensions, 'Gemini embedQuery')
    return vector
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    const vectors: number[][] = []
    for (let i = 0; i < texts.length; i += GEMINI_BATCH_SIZE) {
      const batch = texts.slice(i, i + GEMINI_BATCH_SIZE)
      vectors.push(...(await this.embed(batch, 'RETRIEVAL_DOCUMENT')))
    }
    for (const vector of vectors) {
      assertVectorWidth(vector, this.dimensions, 'Gemini embedDocuments')
    }
    return vectors
  }

  private async embed(contents: string[], taskType: GeminiTaskType): Promise<number[][]> {
    const response = await this.ai.models.embedContent({
      model: this.model,
      contents,
      config: { taskType, outputDimensionality: this.dimensions },
    })
    return (response.embeddings ?? []).map((embedding) => embedding.values ?? [])
  }
}

/**
 * Picks the provider once and caches it. `ChunksService` asks for a provider
 * per document, so without caching every upload would rebuild an API client.
 */
@Injectable()
export class EmbeddingProviderFactory {
  private readonly logger = new Logger(EmbeddingProviderFactory.name)
  private cached: EmbeddingProvider | null = null
  private cachedKey: string | null = null

  constructor(
    private readonly mock: MockEmbeddingProvider,
    private readonly config: ConfigService,
  ) {}

  getProvider(): EmbeddingProvider {
    const model = this.config.get<string>('GEMINI_EMBEDDING_MODEL') ?? 'gemini-embedding-001'
    const hasApiKey = Boolean(this.config.get<string>('GEMINI_API_KEY'))
    const cacheKey = hasApiKey ? `gemini:${model}` : 'mock'

    if (this.cached && this.cachedKey === cacheKey) return this.cached

    if (hasApiKey) {
      this.cached = new GeminiEmbeddingProvider(this.config)
    } else {
      this.logger.log(
        'Using MockEmbeddingProvider (no GEMINI_API_KEY set) - retrieval is keyword-based, not semantic',
      )
      this.cached = this.mock
    }
    this.cachedKey = cacheKey
    return this.cached
  }
}
