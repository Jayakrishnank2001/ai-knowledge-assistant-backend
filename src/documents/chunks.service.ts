import { Injectable, Logger } from '@nestjs/common'
import { DatabaseService } from '../database/database.service'
import { EmbeddingProviderFactory } from '../providers/embedding.provider'
import { PageText, chunkPages } from './embedding.util'

@Injectable()
export class ChunksService {
  private readonly logger = new Logger(ChunksService.name)

  constructor(
    private readonly db: DatabaseService,
    private readonly embeddingFactory: EmbeddingProviderFactory,
  ) {}

  /**
   * Chunks the extracted text of one document and stores one embedded row per
   * chunk in `document_chunks`.
   *
   * The provider comes from the factory rather than being hardcoded: whatever
   * embeds a document here must also embed the search query later, otherwise
   * the two vectors live in different spaces and every score is meaningless.
   */
  async generateForDocument(
    documentId: string,
    pages: PageText[],
  ): Promise<{ chunkCount: number; pageCount: number }> {
    const pageCount = pages.length
    const seeds = chunkPages(pages)
    if (seeds.length === 0) {
      return { chunkCount: 0, pageCount }
    }

    const provider = this.embeddingFactory.getProvider()
    const vectors = await provider.embedDocuments(seeds.map((seed) => seed.content))

    if (vectors.length !== seeds.length) {
      throw new Error(
        `Embedding provider "${provider.name}" returned ${vectors.length} vector(s) for ${seeds.length} chunk(s)`,
      )
    }

    await this.db.chunks.insertMany(
      seeds.map((seed, index) => ({
        documentId,
        content: seed.content,
        pageNumber: seed.pageNumber,
        chunkIndex: seed.chunkIndex,
        embedding: vectors[index],
      })),
    )

    this.logger.log(
      `Indexed ${seeds.length} chunk(s) over ${pageCount} page(s) using ${provider.name} (${provider.dimensions}-dim)`,
    )
    return { chunkCount: seeds.length, pageCount }
  }

  async removeForDocument(documentId: string): Promise<void> {
    await this.db.chunks.deleteMany({ documentId })
  }
}
