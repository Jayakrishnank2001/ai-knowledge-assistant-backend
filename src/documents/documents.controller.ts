import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { Request } from 'express'
import { AuthGuard } from '../auth/auth.guard'
import { DocumentsService } from './documents.service'

interface AuthenticatedRequest extends Request {
  user: { id: string; email: string; name: string }
}

@UseGuards(AuthGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.documentsService.list(request.user.id)
  }

  @Get(':id')
  get(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.documentsService.get(id, request.user.id)
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
  upload(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded — did you send a "file" field?')
    }
    return this.documentsService.create(file, request.user.id)
  }

  @Delete(':id')
  remove(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.documentsService.remove(id, request.user.id)
  }
}