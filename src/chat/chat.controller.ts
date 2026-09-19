import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ChatService } from './chat.service'
import { AskQuestionDto } from './dto/ask-question.dto'

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  ask(@Body() dto: AskQuestionDto) {
    return this.chatService.askQuestion(dto)
  }

  @Get(':conversationId/messages')
  messages(@Param('conversationId') conversationId: string) {
    return this.chatService.messagesOf(conversationId)
  }
}