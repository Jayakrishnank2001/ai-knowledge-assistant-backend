import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  DatabaseService,
  DocumentEntity,
  DocumentStatus,
} from '../database/database.service'

const MB = 1024 * 1024

export interface DocumentDto {
  id: string
  fileName: string
  fileSize: string
  fileSizeBytes: number
  status: DocumentStatus
  uploadedAt: string
  pageCount: number
}

function formatBytes(bytes: number): string {
  const mb = bytes / MB
  return mb >= 100 ? `${mb.toFixed(0)} MB` : `${mb.toFixed(1)} MB`
}

function toDto(doc: DocumentEntity): DocumentDto {
  return {
    id: doc.id,
    fileName: doc.fileName,
    fileSize: formatBytes(doc.fileSizeBytes),
    fileSizeBytes: doc.fileSizeBytes,
    status: doc.status,
    uploadedAt: doc.uploadedAt.toISOString(),
    pageCount: doc.pageCount,
  }
}

@Injectable()
export class DocumentsService {
  constructor(private readonly db: DatabaseService) {}

  list(): DocumentDto[] {
    return this.db.documents.map(toDto)
  }

  get(id: string): DocumentDto {
    const doc = this.db.documents.find((d) => d.id === id)
    if (!doc) {
      throw new NotFoundException(`Document "${id}" not found`)
    }
    return toDto(doc)
  }

  /**
   * Simulates uploading + processing a PDF.
   * The record is created as "processing" and flips to "completed"
   * after a few seconds (in a real app this would be a text extract /
   * embedding step, often a background job).
   */
  create(file: Express.Multer.File): DocumentDto {
    const doc: DocumentEntity = {
      id: this.db.nextId('doc'),
      fileName: file.originalname,
      fileSizeBytes: file.size,
      status: 'processing',
      uploadedAt: new Date(),
      pageCount: 0,
    }
    this.db.documents.push(doc)

    setTimeout(() => {
      doc.status = 'completed'
      doc.pageCount = 8 + Math.round(Math.random() * 60)
    }, 2500)

    return toDto(doc)
  }

  remove(id: string): { id: string; deleted: boolean } {
    const index = this.db.documents.findIndex((d) => d.id === id)
    if (index === -1) {
      throw new NotFoundException(`Document "${id}" not found`)
    }
    this.db.documents.splice(index, 1)
    return { id, deleted: true }
  }

  /** Throws BadRequestException for non-PDF files (used as multer fileFilter). */
  static pdfFileFilter(
    _request: any,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) {
    if (file.mimetype !== 'application/pdf') {
      return callback(new BadRequestException('Only PDF files are supported'), false)
    }
    callback(null, true)
  }
}