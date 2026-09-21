import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { Request } from 'express'
import { AuthGuard } from '../auth/auth.guard'
import { ConversationsService } from './conversations.service'
import { CreateConversationDto } from './dto/create-conversation.dto'

interface AuthenticatedRequest extends Request {
  user: { id: string; email: string; name: string }
}

@UseGuards(AuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.conversationsService.list(request.user.id)
  }

  @Get(':id')
  get(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.conversationsService.getDetail(id, request.user.id)
  }

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() dto?: CreateConversationDto) {
    return this.conversationsService.create(dto, request.user.id)
  }

  @Delete(':id')
  remove(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.conversationsService.remove(id, request.user.id)
  }
}