import { Module } from '@nestjs/common'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { DatabaseModule } from './database/database.module'
import { AuthModule } from './auth/auth.module'
import { DocumentsModule } from './documents/documents.module'
import { ConversationsModule } from './conversations/conversations.module'
import { ChatModule } from './chat/chat.module'
import { OverviewModule } from './overview/overview.module'

@Module({
  imports: [
    DatabaseModule, // @Global() - every module can use DatabaseService without importing it
    AuthModule,
    DocumentsModule,
    ConversationsModule,
    ChatModule,
    OverviewModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}