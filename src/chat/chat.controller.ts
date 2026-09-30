import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { AuthGuard } from '../auth/auth.guard'
import { CurrentUser, AuthUserPayload } from '../common/authenticated-request'
import { ChatService } from './chat.service'
import { AskQuestionDto } from './dto/ask-question.dto'

@UseGuards(AuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  ask(@CurrentUser() user: AuthUserPayload, @Body() dto: AskQuestionDto) {
    return this.chatService.askQuestion(dto, user.id)
  }

  @Get(':conversationId/messages')
  messages(
    @CurrentUser() user: AuthUserPayload,
    @Param('conversationId') conversationId: string,
  ) {
    return this.chatService.messagesOf(conversationId, user.id)
  }
}