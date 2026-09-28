import { Injectable } from '@nestjs/common'
import mongoose from 'mongoose'
import { GridFSBucket, ObjectId } from 'mongodb'
import { Readable } from 'stream'

/**
 * Thin wrapper around MongoDB GridFS.
 *
 * GridFS stores the original PDF binaries in the automatically created
 * `fs.files` + `fs.chunks` collections. Application code never queries those
 * collections directly - it only holds the `fs.files._id` (gridFsFileId) on the
 * `documents` record and uses this service to upload/delete binaries.
 */
@Injectable()
export class GridFsService {
  private bucket(): GridFSBucket {
    const db = mongoose.connection.db
    if (!db) {
      throw new Error('MongoDB is not connected')
    }
    return new GridFSBucket(db, { bucketName: 'fs' })
  }

  /** Upload a buffer (e.g. the multer file) and return the fs.files._id. */
  async upload(
    filename: string,
    data: Buffer,
    metadata?: Record<string, unknown>,
  ): Promise<ObjectId> {
    const bucket = this.bucket()
    return new Promise<ObjectId>((resolve, reject) => {
      const stream = bucket.openUploadStream(filename, { metadata })
      stream.once('error', reject)
      stream.once('finish', () => resolve(stream.id))
      stream.end(data)
    })
  }

  /**
   * Read a GridFS file back into memory.
   * Used when re-extracting text from documents that were uploaded earlier.
   */
  async download(fileId: ObjectId | string): Promise<Buffer> {
    const bucket = this.bucket()
    const id = new ObjectId(fileId.toString())
    return new Promise<Buffer>((resolve, reject) => {
      const parts: Buffer[] = []
      const stream = bucket.openDownloadStream(id)
      stream.on('data', (chunk: Buffer) => parts.push(chunk))
      stream.once('error', reject)
      stream.once('end', () => resolve(Buffer.concat(parts)))
    })
  }

  /**
   * Open a GridFS file as a readable stream instead of loading it into memory.
   * Used by the file-preview endpoint so a 25 MB PDF is piped straight to the
   * HTTP response.
   */
  createDownloadStream(fileId: ObjectId | string): Readable {
    const bucket = this.bucket()
    return bucket.openDownloadStream(new ObjectId(fileId.toString()))
  }

  /** Delete a GridFS file (and its chunks) by fs.files._id. */
  async remove(fileId: ObjectId | string): Promise<void> {
    const bucket = this.bucket()
    await bucket.delete(new ObjectId(fileId.toString()))
  }
}