import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { DocumentsService } from './documents.service'

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  list() {
    return this.documentsService.list()
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.documentsService.get(id)
  }

  /**
   * Accepts multipart/form-data with a "file" field.
   * Example (PowerShell):
   *   curl.exe -X POST http://localhost:3001/api/documents -F "file=@C:\path\Employee Handbook.pdf"
   */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 }, // max 25 MB, matches the frontend
      fileFilter: DocumentsService.pdfFileFilter,
    }),
  )
  upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded — did you send a "file" field?')
    }
    return this.documentsService.create(file)
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.documentsService.remove(id)
  }
}