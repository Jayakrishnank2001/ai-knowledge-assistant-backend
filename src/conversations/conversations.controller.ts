import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common'
import { AuthGuard } from '../auth/auth.guard'
import { CurrentUser, AuthUserPayload } from '../common/authenticated-request'
import { ConversationsService } from './conversations.service'
import { CreateConversationDto } from './dto/create-conversation.dto'

@UseGuards(AuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUserPayload) {
    return this.conversationsService.list(user.id)
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUserPayload, @Param('id') id: string) {
    return this.conversationsService.getDetail(id, user.id)
  }

  @Post()
  create(@CurrentUser() user: AuthUserPayload, @Body() dto?: CreateConversationDto) {
    return this.conversationsService.create(dto, user.id)
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUserPayload, @Param('id') id: string) {
    return this.conversationsService.remove(id, user.id)
  }
}