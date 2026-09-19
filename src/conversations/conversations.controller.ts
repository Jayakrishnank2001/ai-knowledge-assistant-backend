import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common'
import { ConversationsService } from './conversations.service'
import { CreateConversationDto } from './dto/create-conversation.dto'

@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  list() {
    return this.conversationsService.list()
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.conversationsService.getDetail(id)
  }

  @Post()
  create(@Body() dto?: CreateConversationDto) {
    return this.conversationsService.create(dto)
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.conversationsService.remove(id)
  }
}