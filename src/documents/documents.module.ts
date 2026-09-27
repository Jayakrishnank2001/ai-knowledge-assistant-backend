import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { DocumentsController } from './documents.controller'
import { DocumentsService } from './documents.service'
import { GridFsService } from './gridfs.service'
import { ChunksService } from './chunks.service'
import { PdfTextService } from './pdf-text.service'

@Module({
  imports: [AuthModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, GridFsService, ChunksService, PdfTextService],
  exports: [DocumentsService],
})
export class DocumentsModule {}