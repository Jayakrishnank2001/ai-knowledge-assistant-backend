import { Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { DatabaseService, SourceRef } from '../database/database.service'
import { CreateConversationDto } from './dto/create-conversation.dto'

export interface ConversationDto {
  id: string
  title: string
  preview: string
  date: string
  messageCount: number
}

export interface MessageDto {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  sources?: SourceRef[]
}

export interface ConversationDetailDto {
  id: string
  title: string
  preview: string
  date: string
  messages: MessageDto[]
}

export interface NewMessageInput {
  role: 'user' | 'assistant'
  content: string
  sources?: SourceRef[]
}

/** Shape of a row returned by MongoDB (entity + generated ids). */
interface StoredConversation {
  _id: { toString(): string }
  title: string
  preview: string
  date: Date
  messages: Array<{
    _id?: { toString(): string }
    role: 'user' | 'assistant'
    content: string
    timestamp: Date
    sources?: SourceRef[]
  }>
}

/** Read the _id of a mongoose document/subdocument, with a safety fallback. */
function objectIdOf(value: { _id?: { toString(): string } }): string {
  return value._id ? value._id.toString() : randomUUID()
}

@Injectable()
export class ConversationsService {
  constructor(private readonly db: DatabaseService) {}

  async list(): Promise<ConversationDto[]> {
    const conversations = await this.db.conversations.find().sort({ date: -1 }).exec()
    return conversations.map((conv) => this.toDto(conv))
  }

  async getDetail(id: string): Promise<ConversationDetailDto> {
    const conversation = await this.findOrThrow(id)
    return this.toDetail(conversation)
  }

  async create(dto?: CreateConversationDto): Promise<ConversationDetailDto> {
    const conversation = await this.db.conversations.create({
      title: dto?.title?.trim() || 'New conversation',
      preview: '',
      date: new Date(),
      messages: [],
    })
    return this.toDetail(conversation)
  }

  /**
   * Push new messages onto a conversation and refresh its preview/date.
   * Uses an atomic $push so we never lose data when two requests race.
   * Returns the updated conversation (including all messages).
   */
  async appendMessages(id: string, inputs: NewMessageInput[]): Promise<ConversationDetailDto> {
    const now = new Date()
    const messages = inputs.map((input) => ({
      role: input.role,
      content: input.content,
      timestamp: now,
      sources: input.sources,
    }))

    const set: Record<string, unknown> = { date: now }
    const firstUserMessage = inputs.find((m) => m.role === 'user')
    if (firstUserMessage) {
      set.preview = firstUserMessage.content
    }

    const conversation = (await this.db.conversations.findOneAndUpdate(
      { _id: id },
      { $push: { messages: { $each: messages } }, $set: set },
      { new: true },
    )) as StoredConversation | null

    if (!conversation) {
      throw new NotFoundException(`Conversation "${id}" not found`)
    }
    return this.toDetail(conversation)
  }

  async remove(id: string): Promise<{ id: string; deleted: boolean }> {
    const result = await this.db.conversations.deleteOne({ _id: id })
    if (result.deletedCount === 0) {
      throw new NotFoundException(`Conversation "${id}" not found`)
    }
    return { id, deleted: true }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async findOrThrow(id: string): Promise<StoredConversation> {
    const conversation = (await this.db.conversations.findById(id)) as StoredConversation | null
    if (!conversation) {
      throw new NotFoundException(`Conversation "${id}" not found`)
    }
    return conversation
  }

  private toDto(conv: StoredConversation): ConversationDto {
    return {
      id: objectIdOf(conv),
      title: conv.title,
      preview: conv.preview,
      date: conv.date.toISOString(),
      messageCount: conv.messages.length,
    }
  }

  private toDetail(conv: StoredConversation): ConversationDetailDto {
    return {
      id: objectIdOf(conv),
      title: conv.title,
      preview: conv.preview,
      date: conv.date.toISOString(),
      messages: conv.messages
        .slice()
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
        .map((message) => ({
          id: objectIdOf(message),
          role: message.role,
          content: message.content,
          timestamp: message.timestamp.toISOString(),
          sources: message.sources,
        })),
    }
  }
}