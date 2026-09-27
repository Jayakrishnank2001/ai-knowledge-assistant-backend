import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import mongoose from 'mongoose'
import { EMBEDDING_DIM } from '../documents/embedding.util'

/** Name of the Atlas Vector Search index on `document_chunks`. */
export const VECTOR_INDEX_NAME = 'document_chunks_vector_index'

/**
 * Definition of the Atlas Vector Search index.
 *
 * `embedding` is declared at exactly EMBEDDING_DIM, and `documentId` is
 * declared as a *filter* field so retrieval can restrict the search to the
 * documents the caller may see before the nearest-neighbour scan runs.
 */
export const VECTOR_INDEX_DEFINITION = {
  fields: [
    { type: 'vector', path: 'embedding', numDimensions: EMBEDDING_DIM, similarity: 'cosine' },
    { type: 'filter', path: 'documentId' },
  ],
}

interface SearchIndexInfo {
  name: string
  status?: string
  queryable?: boolean
}

/**
 * Creates (and reports on) the Atlas Vector Search index that backs retrieval.
 *
 * Only Atlas can build this index, and building it is asynchronous, so this
 * must never break startup: if the index is missing, still building, or the
 * deployment does not support vector search at all, retrieval falls back to the
 * in-process cosine scan.
 */
@Injectable()
export class VectorIndexService implements OnApplicationBootstrap {
  private readonly logger = new Logger(VectorIndexService.name)
  private ready = false

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureIndex()
  }

  /** True once Atlas reports the vector index as queryable. */
  isReady(): boolean {
    return this.ready
  }

  async ensureIndex(): Promise<boolean> {
    const db = mongoose.connection.db
    if (!db) {
      this.logger.warn('MongoDB not connected - skipping vector index check')
      return false
    }

    const collection = db.collection('document_chunks')

    try {
      const existing = (await collection
        .listSearchIndexes()
        .toArray()) as unknown as SearchIndexInfo[]
      const current = existing.find((index) => index.name === VECTOR_INDEX_NAME)

      if (!current) {
        await collection.createSearchIndex({
          name: VECTOR_INDEX_NAME,
          type: 'vectorSearch',
          definition: VECTOR_INDEX_DEFINITION,
        })
        this.logger.log(
          `Creating Atlas Vector Search index "${VECTOR_INDEX_NAME}" (${EMBEDDING_DIM}-dim). ` +
            'It stays non-queryable for a minute or two - retrieval uses the in-process scan until then.',
        )
        return false
      }

      this.ready = current.queryable === true || current.status === 'READY'
      if (this.ready) {
        this.logger.log(`Atlas Vector Search index "${VECTOR_INDEX_NAME}" is ready`)
      } else {
        this.logger.log(
          `Atlas Vector Search index "${VECTOR_INDEX_NAME}" is ${current.status ?? 'not ready'} - using the in-process scan for now`,
        )
      }
      return this.ready
    } catch (error) {
      this.logger.warn(
        `Atlas Vector Search unavailable (${(error as Error).message}) - ` +
          'retrieval will use the in-process cosine scan.',
      )
      return false
    }
  }
}
