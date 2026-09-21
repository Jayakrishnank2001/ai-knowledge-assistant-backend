import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OpenAI } from 'openai'

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
 * OpenAI chat completion provider (gpt-4o-mini by default).
 * Only instantiated when OPENAI_API_KEY is set.
 */
@Injectable()
export class OpenAILlmProvider implements LlmProvider {
  private readonly logger = new Logger(OpenAILlmProvider.name)
  private readonly client: OpenAI
  private readonly model: string

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY')
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set - cannot create OpenAILlmProvider')
    }
    this.client = new OpenAI({ apiKey })
    this.model = this.config.get<string>('OPENAI_CHAT_MODEL') ?? 'gpt-4o-mini'
    this.logger.log(`OpenAILlmProvider ready (model: ${this.model})`)
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
- If the context does not contain the answer, say so honestly.
- Cite sources using [Source N] notation inline.
- Be concise and direct.

Context:\n${contextText}`

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
      ],
      temperature: 0.1,
      max_tokens: 800,
    })

    return response.choices[0].message.content ?? 'No answer generated.'
  }
}

/** Factory: picks the right LLM provider based on config. */
@Injectable()
export class LlmProviderFactory {
  private readonly logger = new Logger(LlmProviderFactory.name)

  constructor(
    private readonly mock: MockLlmProvider,
    private readonly config: ConfigService,
  ) {}

  getProvider(): LlmProvider {
    if (this.config.get<string>('OPENAI_API_KEY')) {
      this.logger.log('Using OpenAILlmProvider')
      return new OpenAILlmProvider(this.config)
    }
    this.logger.log('Using MockLlmProvider (no OPENAI_API_KEY set)')
    return this.mock
  }
}