import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { AuthGuard } from '../auth/auth.guard'
import { CurrentUser, AuthUserPayload } from '../common/authenticated-request'
import { DocumentsService } from './documents.service'

@UseGuards(AuthGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  list(@CurrentUser() user: AuthUserPayload) {
    return this.documentsService.list(user.id)
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUserPayload, @Param('id') id: string) {
    return this.documentsService.get(id, user.id)
  }

  /**
   * Streams the stored PDF back so the UI can show an in-app preview.
   *
   * `inline` lets the browser render it in an embedded viewer; the same URL
   * opened in a new tab lets the user save their own copy. The file is piped
   * straight out of GridFS, so memory use stays flat regardless of PDF size.
   */
  @Get(':id/file')
  async file(
    @CurrentUser() user: AuthUserPayload,
    @Param('id') id: string,
  ): Promise<StreamableFile> {
    const file = await this.documentsService.openFile(id, user.id)

    // Quoted fallback for old clients + RFC 5987 form for non-ASCII names.
    const name = encodeURIComponent(file.fileName)

    return new StreamableFile(file.stream, {
      type: file.mimeType,
      disposition: `inline; filename="${name}"; filename*=UTF-8''${name}`,
      length: file.size,
    })
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
    @CurrentUser() user: AuthUserPayload,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded — did you send a "file" field?')
    }
    return this.documentsService.create(file, user.id)
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUserPayload, @Param('id') id: string) {
    return this.documentsService.remove(id, user.id)
  }
}