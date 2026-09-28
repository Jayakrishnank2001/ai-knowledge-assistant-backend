import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { DatabaseService, DocumentStatus } from '../database/database.service'
import { ChunksService } from './chunks.service'
import { GridFsService } from './gridfs.service'
import { PdfTextService } from './pdf-text.service'
import { ObjectId } from 'mongodb'
import { Readable } from 'stream'

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

/** A GridFS binary plus the metadata needed to serve it over HTTP. */
export interface DocumentFile {
  fileName: string
  mimeType: string
  size: number
  stream: Readable
}

/** Shape of a row returned by MongoDB (entity + the generated ids). */
interface StoredDocument {
  _id: { toString(): string }
  fileName: string
  mimeType?: string
  fileSizeBytes: number
  status: DocumentStatus
  uploadedAt: Date
  pageCount: number
  gridFsFileId?: { toString(): string } | null
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

  constructor(
    private readonly db: DatabaseService,
    private readonly gridFs: GridFsService,
    private readonly chunks: ChunksService,
    private readonly pdfText: PdfTextService,
  ) {}

  async list(userId: string): Promise<DocumentDto[]> {
    const docs = await this.db.documents
      .find({ $or: [{ userId: null }, { userId }] })
      .sort({ uploadedAt: -1 })
      .exec()
    return docs.map(toDto)
  }

  async get(id: string, userId: string): Promise<DocumentDto> {
    const doc = await this.loadDocument(id, userId)
    if (!doc) {
      throw new NotFoundException(`Document "${id}" not found`)
    }
    return toDto(doc)
  }

  /**
   * Loads a document the caller may read: global rows (`userId: null`) plus the
   * caller's own. A malformed id is reported as "not found" rather than letting
   * Mongoose throw a CastError that would surface as a 500.
   */
  private async loadDocument(id: string, userId: string): Promise<StoredDocument | null> {
    if (!ObjectId.isValid(id)) return null
    return this.db.documents.findOne({
      _id: id,
      $or: [{ userId: null }, { userId }],
    })
  }

  /**
   * Opens the original PDF from GridFS so the API can stream it back for the
   * in-app preview (and for downloads). Visibility follows the same rule as
   * `get`: a document is readable when it is global (userId null) or owned by
   * the caller, so one user can never preview another user's file.
   */
  async openFile(id: string, userId: string): Promise<DocumentFile> {
    const doc = await this.loadDocument(id, userId)
    if (!doc) {
      throw new NotFoundException(`Document "${id}" not found`)
    }
    if (!doc.gridFsFileId) {
      throw new NotFoundException(`Document "${id}" has no stored file to preview`)
    }
    return {
      fileName: doc.fileName,
      mimeType: doc.mimeType || 'application/pdf',
      size: doc.fileSizeBytes,
      stream: this.gridFs.createDownloadStream(doc.gridFsFileId),
    }
  }

  /**
   * Upload pipeline:
   *   1. store the PDF binary in GridFS (fs.files / fs.chunks are created
   *      automatically; GridFS never shows up as an application collection)
   *   2. insert the `documents` metadata row with a reference to the GridFS id
   *   3. extract the real text, chunk + embed it into `document_chunks`, and
   *      mark the document completed (in the background, so the HTTP response
   *      is not held open)
   */
  async create(file: Express.Multer.File, userId: string): Promise<DocumentDto> {
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('The uploaded file is empty')
    }

    const gridFsFileId = await this.gridFs.upload(file.originalname, file.buffer, {
      mimeType: file.mimetype,
    })

    const doc = await this.db.documents.create({
      userId,
      fileName: file.originalname,
      mimeType: file.mimetype,
      fileSizeBytes: file.size,
      status: 'processing' as DocumentStatus,
      uploadedAt: new Date(),
      pageCount: 0,
      gridFsFileId,
    })

    // Real extraction + embedding: hand it off so the upload response returns
    // immediately, and let processDocument record success or failure.
    void this.processDocument(doc, file.buffer)

    return toDto(doc)
  }

  /**
   * Extracts the PDF text, chunks + embeds it, then flips the document to
   * completed. Every failure (unreadable PDF, no extractable text, embedding
   * API error) marks the document failed with a logged reason rather than
   * leaving it stuck on "processing" forever.
   */
  private async processDocument(doc: StoredDocument, buffer: Buffer): Promise<void> {
    try {
      const pages = await this.pdfText.extract(buffer)
      if (pages.length === 0) {
        throw new Error('no extractable text - is this a scanned/image-only PDF?')
      }

      const { chunkCount, pageCount } = await this.chunks.generateForDocument(
        doc._id.toString(),
        pages,
      )
      await this.db.documents.updateOne(
        { _id: doc._id },
        { $set: { status: 'completed', pageCount } },
      )
      this.logger.log(
        `Document "${doc.fileName}" processed: ${chunkCount} chunk(s), ${pageCount} page(s)`,
      )
    } catch (error) {
      this.logger.error(
        `Failed to process document "${doc.fileName}": ${(error as Error).message}`,
      )
      await this.db.documents
        .updateOne({ _id: doc._id }, { $set: { status: 'failed' } })
        .catch(() => {})
    }
  }

  /** Cascade delete: GridFS binary, chunks, then the metadata row. Only owners can delete. */
  async remove(id: string, userId: string): Promise<{ id: string; deleted: boolean }> {
    const doc = await this.db.documents.findOne({ _id: id, userId })
    if (!doc) {
      throw new NotFoundException(`Document "${id}" not found`)
    }

    if (doc.gridFsFileId) {
      try {
        await this.gridFs.remove(doc.gridFsFileId)
      } catch (error) {
        this.logger.warn(
          `Could not remove GridFS file for "${doc.fileName}": ${(error as Error).message}`,
        )
      }
    }

    await this.chunks.removeForDocument(id)
    await this.db.documents.deleteOne({ _id: id, userId })
    this.logger.log(`Deleted document "${doc.fileName}" (${id})`)
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