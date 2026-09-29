import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * Chat models the settings endpoint is allowed to persist.
 * Allowlist so the API can never write an arbitrary string into .env.
 */
export const AVAILABLE_CHAT_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
] as const

/** Fallback when GEMINI_CHAT_MODEL is absent from .env and process.env. */
export const DEFAULT_CHAT_MODEL = 'gemini-3.5-flash-lite'

const ENV_KEY = 'GEMINI_CHAT_MODEL'

/**
 * Reads/writes the AI preference (GEMINI_CHAT_MODEL) that lives in the
 * backend .env file.
 *
 * The value is persisted to .env so it survives restarts, AND mirrored into
 * process.env so the change takes effect immediately: dotenv has already
 * loaded by the time this runs, and ConfigService falls through to
 * process.env for keys that were never registered via ConfigModule.forRoot().
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name)

  constructor(private readonly config: ConfigService) {}

  /** Where GEMINI_CHAT_MODEL is persisted. Overridable in tests. */
  envFilePath = path.resolve(process.cwd(), '.env')

  get availableModels(): readonly string[] {
    return AVAILABLE_CHAT_MODELS
  }

  /** The model currently in effect (process.env wins over the .env default). */
  getChatModel(): string {
    return this.config.get<string>(ENV_KEY) ?? DEFAULT_CHAT_MODEL
  }

  /**
   * Persist a new chat model: rewrite the .env line first (so a failed write
   * never leaves a half-applied change), then hot-swap process.env.
   */
  async setChatModel(chatModel: string): Promise<string> {
    if (!(AVAILABLE_CHAT_MODELS as readonly string[]).includes(chatModel)) {
      throw new BadRequestException(
        `Unknown chat model "${chatModel}". Allowed: ${AVAILABLE_CHAT_MODELS.join(', ')}`,
      )
    }
    await this.writeEnvValue(chatModel)
    process.env[ENV_KEY] = chatModel
    this.logger.log(`Chat model set to ${chatModel} (applied immediately, persisted to .env)`)
    return chatModel
  }

  /**
   * Replace the `GEMINI_CHAT_MODEL=` line in the .env file in place, or append
   * it when missing. Every other key, comment and line ending is preserved.
   */
  private async writeEnvValue(value: string): Promise<void> {
    let contents = ''
    try {
      contents = await fs.readFile(this.envFilePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      // No .env yet - create one containing just this key.
    }

    const line = `${ENV_KEY}=${value}`
    // Character class instead of \s so the match never spans lines (\s eats \n).
    const existingKey = /^[ \t]*GEMINI_CHAT_MODEL[ \t]*=.*$/m
    let next: string
    if (existingKey.test(contents)) {
      next = contents.replace(existingKey, line)
    } else {
      const separator = contents.length > 0 && !contents.endsWith('\n') ? '\n' : ''
      next = `${contents}${separator}${line}\n`
    }

    await fs.writeFile(this.envFilePath, next, 'utf8')
  }
}