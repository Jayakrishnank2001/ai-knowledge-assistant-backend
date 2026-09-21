import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OpenAI } from 'openai'
import { embedText } from '../documents/embedding.util'

/**
 * Normalised embedding interface - all providers must implement this.
 * Vectors are expected to be L2-normalised already.
 */
export interface EmbeddingProvider {
  /** Embed a single text and return a normalised vector. */
  embed(text: string): Promise<number[]>

  /** Embed multiple texts in a single batch call (more efficient). */
  embedMany(texts: string[]): Promise<number[][]>

  /** The dimensionality this provider returns (e.g. 1536 for text-embedding-3-small). */
  readonly dimensions: number
}

/**
 * Deterministic, zero-dependency mock provider (current behaviour).
 * Uses a stopword-free, singularised bag-of-hashed-words vector.
 */
@Injectable()
export class MockEmbeddingProvider implements EmbeddingProvider {
  private readonly logger = new Logger(MockEmbeddingProvider.name)
  readonly dimensions = 1536

  async embed(text: string): Promise<number[]> {
    return embedText(text)
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)))
  }
}

/**
 * OpenAI embedding provider (text-embedding-3-small by default).
 * Only instantiated when OPENAI_API_KEY is set.
 */
@Injectable()
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private readonly logger = new Logger(OpenAIEmbeddingProvider.name)
  private readonly client: OpenAI
  readonly dimensions = 1536

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY')
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set - cannot create OpenAIEmbeddingProvider')
    }
    this.client = new OpenAI({ apiKey })
    this.logger.log(`OpenAIEmbeddingProvider ready (model: ${this.config.get('OPENAI_EMBEDDING_MODEL') ?? 'text-embedding-3-small'})`)
  }

  async embed(text: string): Promise<number[]> {
    const model = this.config.get<string>('OPENAI_EMBEDDING_MODEL') ?? 'text-embedding-3-small'
    const response = await this.client.embeddings.create({ model, input: text })
    return response.data[0].embedding as number[]
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    const model = this.config.get<string>('OPENAI_EMBEDDING_MODEL') ?? 'text-embedding-3-small'
    const response = await this.client.embeddings.create({ model, input: texts })
    return response.data.map((d) => d.embedding as number[])
  }
}

/**
 * Factory: returns the appropriate provider based on config.
 * If OPENAI_API_KEY is set -> OpenAIEmbeddingProvider
 * Otherwise -> MockEmbeddingProvider
 */
@Injectable()
export class EmbeddingProviderFactory {
  private readonly logger = new Logger(EmbeddingProviderFactory.name)

  constructor(
    private readonly mock: MockEmbeddingProvider,
    private readonly config: ConfigService,
  ) {}

  getProvider(): EmbeddingProvider {
    if (this.config.get<string>('OPENAI_API_KEY')) {
      this.logger.log('Using OpenAIEmbeddingProvider')
      return new OpenAIEmbeddingProvider(this.config)
    }
    this.logger.log('Using MockEmbeddingProvider (no OPENAI_API_KEY set)')
    return this.mock
  }
}

// Backwards-compatible constants (used by legacy code)
export const EMBEDDING_DIM = 1536
export const MIN_SIMILARITY = 0.12

/** Cosine similarity between two normalised vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot // already normalised
}

/** Human-readable relevance label for a cosine score. */
export function similarityLabel(score: number): string {
  if (score >= 0.8) return 'High'
  if (score >= 0.6) return 'Medium'
  if (score >= 0.4) return 'Low'
  return 'Very low'
}