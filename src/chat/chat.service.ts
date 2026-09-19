import { Injectable } from '@nestjs/common'
import { ConversationsService } from '../conversations/conversations.service'
import { KnowledgeBaseService } from './knowledge-base.service'
import { AskQuestionDto } from './dto/ask-question.dto'

@Injectable()
export class ChatService {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly knowledgeBase: KnowledgeBaseService,
  ) {}

  /**
   * Accepts a user question:
   *   1. creates a new conversation (or reuses conversationId)
   *   2. stores the user message
   *   3. asks the knowledge base for an answer + sources
   *   4. stores the assistant message
   *   5. returns the whole updated conversation
   */
  askQuestion(dto: AskQuestionDto) {
    const question = dto.question.trim()

    let conversationId = dto.conversationId
    if (!conversationId) {
      const created = this.conversations.create({ title: this.titleFrom(question) })
      conversationId = created.id
    }

    const { answer, sources } = this.knowledgeBase.ask(question)

    return this.conversations.appendMessages(conversationId, [
      { role: 'user', content: question },
      { role: 'assistant', content: answer, sources },
    ])
  }

  messagesOf(conversationId: string) {
    return this.conversations.getDetail(conversationId).messages
  }

  /** Turn a question into a short conversation title, e.g. "How many annual leave days do…" */
  private titleFrom(question: string): string {
    const words = question.split(' ').slice(0, 5).join(' ')
    return question.split(' ').length > 5 ? `${words}...` : words
  }
}