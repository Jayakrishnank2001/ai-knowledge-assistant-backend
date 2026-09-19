import { Injectable, NotFoundException } from '@nestjs/common'
import {
  ChatMessageEntity,
  ConversationEntity,
  DatabaseService,
  SourceRef,
} from '../database/database.service'
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

interface NewMessageInput {
  role: 'user' | 'assistant'
  content: string
  sources?: SourceRef[]
}

@Injectable()
export class ConversationsService {
  constructor(private readonly db: DatabaseService) {}

  list(): ConversationDto[] {
    return this.db.conversations
      .slice()
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .map((conv) => this.toDto(conv))
  }

  getDetail(id: string): ConversationDetailDto {
    return this.toDetail(this.findOrThrow(id))
  }

  create(dto?: CreateConversationDto): ConversationDetailDto {
    const conversation: ConversationEntity = {
      id: this.db.nextId('conv'),
      title: dto?.title?.trim() || 'New conversation',
      preview: '',
      date: new Date(),
      messages: [],
    }
    this.db.conversations.push(conversation)
    return this.toDetail(conversation)
  }

  /**
   * Push new messages onto a conversation and refresh its preview/date.
   * Returns the updated conversation (including all messages).
   */
  appendMessages(id: string, messages: NewMessageInput[]): ConversationDetailDto {
    const conversation = this.findOrThrow(id)
    for (const input of messages) {
      const message: ChatMessageEntity = {
        id: this.db.nextId('msg'),
        role: input.role,
        content: input.content,
        timestamp: new Date(),
        sources: input.sources,
      }
      conversation.messages.push(message)
    }
    const firstUserMessage = messages.find((m) => m.role === 'user')
    if (firstUserMessage) {
      conversation.preview = firstUserMessage.content
    }
    conversation.date = new Date()
    return this.toDetail(conversation)
  }

  remove(id: string): { id: string; deleted: boolean } {
    const index = this.db.conversations.findIndex((c) => c.id === id)
    if (index === -1) {
      throw new NotFoundException(`Conversation "${id}" not found`)
    }
    this.db.conversations.splice(index, 1)
    return { id, deleted: true }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private findOrThrow(id: string): ConversationEntity {
    const conversation = this.db.conversations.find((c) => c.id === id)
    if (!conversation) {
      throw new NotFoundException(`Conversation "${id}" not found`)
    }
    return conversation
  }

  private toDto(conv: ConversationEntity): ConversationDto {
    return {
      id: conv.id,
      title: conv.title,
      preview: conv.preview,
      date: conv.date.toISOString(),
      messageCount: conv.messages.length,
    }
  }

  private toDetail(conv: ConversationEntity): ConversationDetailDto {
    return {
      id: conv.id,
      title: conv.title,
      preview: conv.preview,
      date: conv.date.toISOString(),
      messages: conv.messages
        .slice()
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
        .map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          timestamp: message.timestamp.toISOString(),
          sources: message.sources,
        })),
    }
  }
}