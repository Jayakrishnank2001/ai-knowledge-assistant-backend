import 'dotenv/config'

import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import mongoose from 'mongoose'
import { AppModule } from '../app.module'
import { DatabaseService, DocumentEntity } from '../database/database.service'
import { VectorIndexService } from '../database/vector-index.service'
import { ChunksService } from '../documents/chunks.service'
import { GridFsService } from '../documents/gridfs.service'
import { PdfTextService } from '../documents/pdf-text.service'

/**
 * Re-extracts, re-chunks and re-embeds every uploaded document from the PDF
 * stored in GridFS.
 *
 * Run this after changing the embedding model, or after upgrading from the
 * version that stored placeholder chunks - vectors from two different models
 * live in different spaces and cannot be compared.
 *
 *   npm run reindex                              # re-index everything
 *   npm run reindex -- --dry-run                 # report only, write nothing
 *   npm run reindex -- --only leave              # substring match on the filename
 */
async function main(): Promise<void> {
  const logger = new Logger('Reindex')
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const onlyIndex = args.indexOf('--only')
  const only = onlyIndex >= 0 ? args[onlyIndex + 1] : undefined

  const mongoUri = process.env.MONGODB_URI
  if (!mongoUri) {
    logger.error('MONGODB_URI is missing. Copy .env.example to .env and set your connection string.')
    process.exit(1)
  }

  await mongoose.connect(mongoUri, {
    dbName: process.env.MONGODB_DBNAME ?? 'ai-knowledge-assistant',
    serverSelectionTimeoutMS: 10_000,
  })
  logger.log('Connected to MongoDB')

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] })

  try {
    const db = app.get(DatabaseService)
    const gridFs = app.get(GridFsService)
    const pdfText = app.get(PdfTextService)
    const chunks = app.get(ChunksService)
    const vectorIndex = app.get(VectorIndexService)

    const filter: mongoose.FilterQuery<DocumentEntity> = only
      ? { fileName: { $regex: only.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }
      : {}
    const documents = await db.documents.find(filter).sort({ uploadedAt: 1 }).exec()

    if (documents.length === 0) {
      logger.warn(only ? `No document matched "${only}"` : 'No documents found - nothing to re-index')
      return
    }

    let indexed = 0
    let skipped = 0
    let failed = 0
    let chunkTotal = 0

    for (const doc of documents) {
      if (!doc.gridFsFileId) {
        skipped += 1
        logger.warn(`Skipping "${doc.fileName}" - no PDF in GridFS (seeded or legacy row)`)
        continue
      }

      try {
        const buffer = await gridFs.download(doc.gridFsFileId)
        const pages = await pdfText.extract(buffer)
        if (pages.length === 0) {
          throw new Error('no extractable text - is this a scanned/image-only PDF?')
        }

        if (dryRun) {
          indexed += 1
          logger.log(`[dry-run] "${doc.fileName}": ${pages.length} page(s) would be re-indexed`)
          continue
        }

        // Replace the old vectors instead of appending to them.
        await chunks.removeForDocument(doc._id.toString())
        const { chunkCount, pageCount } = await chunks.generateForDocument(doc._id.toString(), pages)
        await db.documents.updateOne({ _id: doc._id }, { $set: { status: 'completed', pageCount } })

        indexed += 1
        chunkTotal += chunkCount
        logger.log(`Re-indexed "${doc.fileName}": ${chunkCount} chunk(s) over ${pageCount} page(s)`)
      } catch (error) {
        failed += 1
        logger.error(`Failed to re-index "${doc.fileName}": ${(error as Error).message}`)
        if (!dryRun) {
          await db.documents.updateOne({ _id: doc._id }, { $set: { status: 'failed' } })
        }
      }
    }

    logger.log(
      `${dryRun ? '[dry-run] ' : ''}Done: ${indexed} document(s) processed, ` +
        `${chunkTotal} chunk(s) written, ${skipped} skipped, ${failed} failed`,
    )

    const ready = await vectorIndex.ensureIndex()
    logger.log(
      ready
        ? 'Atlas Vector Search index is ready - chat will use it.'
        : 'Atlas Vector Search index is not queryable yet - chat uses the in-process cosine scan until it is.',
    )
  } finally {
    await app.close()
    await mongoose.disconnect()
  }
}

void main()
