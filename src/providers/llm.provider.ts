import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GoogleGenAI } from '@google/genai'
import { toFriendlyGeminiError, withGeminiRetry } from './gemini-retry.util'

/** Normalised LLM interface - all providers must implement this. */
export interface LlmProvider {
  /**
   * Generate an answer given the question and retrieved context chunks.
   * The context is a list of { text, documentName, page } objects.
   */
  generateAnswer(
    question: string,
    context: Array<{ text: string; documentName: string; page: number }>,
  ): Promise<string>
}

/**
 * Deterministic mock provider - concatenates context as the "answer".
 * Mirrors the previous KnowledgeBaseService behaviour exactly.
 */
@Injectable()
export class MockLlmProvider implements LlmProvider {
  private readonly logger = new Logger(MockLlmProvider.name)

  async generateAnswer(
    question: string,
    context: Array<{ text: string; documentName: string; page: number }>,
  ): Promise<string> {
    if (context.length === 0) {
      return `I searched the knowledge base but could not find a direct match for "${question}". Try rephrasing your question or check that the relevant document has finished processing.`
    }
    const answer = context.map((c) => c.text).join('\n\n')
    return `## Answer\n\n${answer}\n\nThis answer is grounded in the source documents below.`
  }
}

/**
 * Google Gemini chat provider (gemini-1.5-pro by default).
 * Only instantiated when GEMINI_API_KEY is set.
 */
@Injectable()
export class GeminiLlmProvider implements LlmProvider {
  private readonly logger = new Logger(GeminiLlmProvider.name)
  private readonly ai: GoogleGenAI
  private readonly model: string

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY')
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set - cannot create GeminiLlmProvider')
    }
    this.ai = new GoogleGenAI({ apiKey })
    this.model = this.config.get<string>('GEMINI_CHAT_MODEL') ?? 'gemini-2.5-flash'
    this.logger.log(`GeminiLlmProvider ready (model: ${this.model})`)
  }

  async generateAnswer(
    question: string,
    context: Array<{ text: string; documentName: string; page: number }>,
  ): Promise<string> {
    const contextText = context
      .map((c, i) => `[Source ${i + 1}: ${c.documentName}, page ${c.page}]\n${c.text}`)
      .join('\n\n')

    const systemPrompt = `You are a helpful assistant that answers questions based ONLY on the provided context.

Rules:
- Answer ONLY from the context. If it is absent, say so honestly.
- Cite ONLY the source(s) that directly contain the answer, using [Source N] inline.
- Do NOT cite a source merely because it shares a keyword or topic; omit irrelevant sources entirely.
- If a single source fully answers the question, cite only that source - do not pad the answer with additional sources.
- Be concise and direct.

Context:\n${contextText}`

    try {
      const response = await withGeminiRetry(
        () =>
          this.ai.models.generateContent({
            model: this.model,
            contents: `Context:\n${contextText || '(no matching documents were found)'}\n\nQuestion: ${question}`,
            config: {
              systemInstruction: systemPrompt,
              temperature: 0.1,
              // Thinking models (e.g. gemini-3.x-flash) spend part of this budget on
              // reasoning tokens, so keep it well above the expected answer length -
              // too small and `response.text` comes back empty.
              maxOutputTokens: 4096,
            },
          }),
        { operation: `Gemini chat (${this.model})` },
        this.logger,
      )

      return response.text?.trim() || 'No answer generated.'
    } catch (error) {
      toFriendlyGeminiError(error, `Gemini chat (${this.model})`)
    }
  }
}

/**
 * Factory: picks the right LLM provider based on config.
 *
 * Providers are cached per cache key (API key presence + model) so callers can
 * ask for the provider per request - the settings endpoint can hot-swap
 * GEMINI_CHAT_MODEL and the next request picks up a fresh instance.
 */
@Injectable()
export class LlmProviderFactory {
  private readonly logger = new Logger(LlmProviderFactory.name)
  private cached: LlmProvider | null = null
  private cachedKey: string | null = null

  constructor(
    private readonly mock: MockLlmProvider,
    private readonly config: ConfigService,
  ) {}

  getProvider(): LlmProvider {
    const hasApiKey = Boolean(this.config.get<string>('GEMINI_API_KEY'))
    const model = this.config.get<string>('GEMINI_CHAT_MODEL') ?? 'gemini-2.5-flash'
    const cacheKey = hasApiKey ? `gemini:${model}` : 'mock'
    if (this.cached && this.cachedKey === cacheKey) return this.cached

    if (hasApiKey) {
      this.logger.log(`Using GeminiLlmProvider (model: ${model})`)
      this.cached = new GeminiLlmProvider(this.config)
    } else {
      this.logger.log('Using MockLlmProvider (no GEMINI_API_KEY set)')
      this.cached = this.mock
    }
    this.cachedKey = cacheKey
    return this.cached
  }
}