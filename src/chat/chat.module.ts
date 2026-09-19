import { Module } from '@nestjs/common'
import { ConversationsModule } from '../conversations/conversations.module'
import { ChatController } from './chat.controller'
import { ChatService } from './chat.service'
import { KnowledgeBaseService } from './knowledge-base.service'

@Module({
  imports: [ConversationsModule],
  controllers: [ChatController],
  providers: [ChatService, KnowledgeBaseService],
})
export class ChatModule {}