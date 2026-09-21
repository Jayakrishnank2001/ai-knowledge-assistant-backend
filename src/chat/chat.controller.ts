import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { Request } from 'express'
import { AuthGuard } from '../auth/auth.guard'
import { ChatService } from './chat.service'
import { AskQuestionDto } from './dto/ask-question.dto'

interface AuthenticatedRequest extends Request {
  user: { id: string; email: string; name: string }
}

@UseGuards(AuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  ask(@Req() request: AuthenticatedRequest, @Body() dto: AskQuestionDto) {
    return this.chatService.askQuestion(dto, request.user.id)
  }

  @Get(':conversationId/messages')
  messages(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId') conversationId: string,
  ) {
    return this.chatService.messagesOf(conversationId, request.user.id)
  }
}