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
  userId?: { toString(): string } | null
  title: string
  preview: string
  date: Date
}

interface StoredMessage {
  _id?: { toString(): string }
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  sources?: SourceRef[]
}

/** Read the _id of a mongoose document, with a safety fallback. */
function objectIdOf(value: { _id?: { toString(): string } }): string {
  return value._id ? value._id.toString() : randomUUID()
}

function messageDto(message: StoredMessage): MessageDto {
  return {
    id: objectIdOf(message),
    role: message.role,
    content: message.content,
    timestamp: message.timestamp.toISOString(),
    sources: message.sources,
  }
}

/**
 * Every method is scoped by `userId` (the authenticated user), so users only
 * ever see and mutate THEIR OWN conversations.
 */
@Injectable()
export class ConversationsService {
  constructor(private readonly db: DatabaseService) {}

  async list(userId: string): Promise<ConversationDto[]> {
    const conversations = await this.db.conversations
      .find({ userId })
      .sort({ date: -1 })
      .exec()
    return Promise.all(
      conversations.map(async (conv) => ({
        id: objectIdOf(conv),
        title: conv.title,
        preview: conv.preview,
        date: conv.date.toISOString(),
        messageCount: await this.db.messages.countDocuments({ conversationId: conv._id }),
      })),
    )
  }

  async getDetail(id: string, userId: string): Promise<ConversationDetailDto> {
    const conversation = await this.findOwned(id, userId)
    const messages = await this.db.messages
      .find({ conversationId: conversation._id })
      .sort({ timestamp: 1 })
      .exec()
    return {
      id: objectIdOf(conversation),
      title: conversation.title,
      preview: conversation.preview,
      date: conversation.date.toISOString(),
      messages: messages.map(messageDto),
    }
  }

  async create(dto: CreateConversationDto | undefined, userId: string): Promise<ConversationDetailDto> {
    const conversation = await this.db.conversations.create({
      userId,
      title: dto?.title?.trim() || 'New conversation',
      preview: '',
      date: new Date(),
    })
    return {
      id: objectIdOf(conversation),
      title: conversation.title,
      preview: conversation.preview,
      date: conversation.date.toISOString(),
      messages: [],
    }
  }

  /**
   * Insert new messages into the `messages` collection and refresh the
   * conversation's preview/date. Returns the updated conversation detail.
   */
  async appendMessages(
    id: string,
    inputs: NewMessageInput[],
    userId: string,
  ): Promise<ConversationDetailDto> {
    const conversation = await this.findOwned(id, userId)
    const now = new Date()

    await this.db.messages.insertMany(
      inputs.map((input) => ({
        conversationId: conversation._id,
        role: input.role,
        content: input.content,
        timestamp: now,
        sources: input.sources,
      })),
    )

    const set: Record<string, unknown> = { date: now }
    const firstUserMessage = inputs.find((m) => m.role === 'user')
    if (firstUserMessage) {
      set.preview = firstUserMessage.content
    }
    await this.db.conversations.updateOne({ _id: conversation._id }, { $set: set })

    return this.getDetail(id, userId)
  }

  /** Delete the conversation (only its owner) and all of its messages. */
  async remove(id: string, userId: string): Promise<{ id: string; deleted: boolean }> {
    const result = await this.db.conversations.deleteOne({ _id: id, userId })
    if (result.deletedCount === 0) {
      throw new NotFoundException(`Conversation "${id}" not found`)
    }
    await this.db.messages.deleteMany({ conversationId: id })
    return { id, deleted: true }
  }

  /** Load a conversation and 404 unless it belongs to this user. */
  private async findOwned(id: string, userId: string): Promise<StoredConversation> {
    const conversation = (await this.db.conversations.findOne({
      _id: id,
      userId,
    })) as StoredConversation | null
    if (!conversation) {
      throw new NotFoundException(`Conversation "${id}" not found`)
    }
    return conversation
  }
}