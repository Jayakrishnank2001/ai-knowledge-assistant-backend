import { Module } from '@nestjs/common'
import { DocumentsController } from './documents.controller'
import { DocumentsService } from './documents.service'
import { GridFsService } from './gridfs.service'
import { ChunksService } from './chunks.service'

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, GridFsService, ChunksService],
  exports: [DocumentsService],
})
export class DocumentsModule {}