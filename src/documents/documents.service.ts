import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { DatabaseService, DocumentStatus } from '../database/database.service'

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

/** Shape of a row returned by MongoDB (entity + the generated _id). */
interface StoredDocument {
  _id: { toString(): string }
  fileName: string
  fileSizeBytes: number
  status: DocumentStatus
  uploadedAt: Date
  pageCount: number
}

function formatBytes(bytes: number): string {
  const mb = bytes / MB
  return mb >= 100 ? `${mb.toFixed(0)} MB` : `${mb.toFixed(1)} MB`
}

function toDto(doc: StoredDocument): DocumentDto {
  return {
    id: doc._id.toString(),
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
  private readonly logger = new Logger(DocumentsService.name)

  constructor(private readonly db: DatabaseService) {}

  async list(): Promise<DocumentDto[]> {
    const docs = await this.db.documents.find().sort({ uploadedAt: -1 }).exec()
    return docs.map(toDto)
  }

  async get(id: string): Promise<DocumentDto> {
    const doc = await this.db.documents.findById(id)
    if (!doc) {
      throw new NotFoundException(`Document "${id}" not found`)
    }
    return toDto(doc)
  }

  /**
   * Persists an uploaded PDF, initially marked as "processing", then flips it
   * to "completed" after a few seconds (in a real app this would be a text
   * extraction / embedding step, often a background job).
   */
  async create(file: Express.Multer.File): Promise<DocumentDto> {
    const doc = await this.db.documents.create({
      fileName: file.originalname,
      fileSizeBytes: file.size,
      status: 'processing' as DocumentStatus,
      uploadedAt: new Date(),
      pageCount: 0,
    })

    setTimeout(() => {
      void this.db.documents
        .updateOne(
          { _id: doc._id },
          {
            $set: {
              status: 'completed',
              pageCount: 8 + Math.round(Math.random() * 60),
            },
          },
        )
        .then((result) =>
          this.logger.log(
            `Document "${doc.fileName}" processed (matched=${result.matchedCount}, modified=${result.modifiedCount})`,
          ),
        )
        .catch((error: Error) =>
          this.logger.error(`Failed to finalize document "${doc.fileName}": ${error.message}`, undefined, 'DocumentsService'),
        )
    }, 2500)

    return toDto(doc)
  }

  async remove(id: string): Promise<{ id: string; deleted: boolean }> {
    const result = await this.db.documents.deleteOne({ _id: id })
    if (result.deletedCount === 0) {
      throw new NotFoundException(`Document "${id}" not found`)
    }
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