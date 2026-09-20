import { Injectable } from '@nestjs/common'
import { DatabaseService } from '../database/database.service'
import { buildChunkSeeds, embedText } from './embedding.util'

@Injectable()
export class ChunksService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Simulates text-extraction + chunking for an uploaded PDF.
   * In a real RAG app this would parse the PDF, split by paragraphs/sections,
   * call an embedding model, and store the vectors in a vector index.
   */
  async generateForDocument(
    documentId: string,
    fileName: string,
  ): Promise<{ chunkCount: number; pageCount: number }> {
    const seeds = buildChunkSeeds(fileName)
    if (seeds.length === 0) return { chunkCount: 0, pageCount: 0 }

    await this.db.chunks.insertMany(
      seeds.map((seed) => ({
        documentId,
        content: seed.content,
        pageNumber: seed.pageNumber,
        chunkIndex: seed.chunkIndex,
        embedding: embedText(seed.content),
      })),
    )

    const pageCount = seeds.reduce((max, seed) => Math.max(max, seed.pageNumber), 1)
    return { chunkCount: seeds.length, pageCount }
  }

  async removeForDocument(documentId: string): Promise<void> {
    await this.db.chunks.deleteMany({ documentId })
  }
}