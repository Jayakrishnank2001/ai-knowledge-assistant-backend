import { cosineSimilarity } from '../documents/embedding.util'

/** A chunk as stored in `document_chunks`, with its stored embedding. */
export interface RawChunk {
  chunkId: string
  documentId: string
  content: string
  pageNumber: number
  embedding: number[]
}

/** A chunk that survived scoring, ready to become prompt context + a citation. */
export interface ScoredChunk {
  chunkId: string
  documentId: string
  content: string
  pageNumber: number
  score: number
}

export interface RankOptions {
  /** Minimum cosine similarity a chunk must reach to be usable. */
  minSimilarity: number
  /** Maximum number of chunks handed to the LLM. */
  topK: number
  /** Maximum chunks taken from any single document, to keep sources diverse. */
  maxPerDocument: number
}

export interface RankResult {
  ranked: ScoredChunk[]
  /** Candidates skipped because their vector width did not match the query. */
  dimensionMismatches: number
}

/**
 * Scores candidate chunks and selects the ones that go into the prompt.
 *
 * Both the Atlas Vector Search path and the in-process fallback funnel through
 * here, so they rank *identically* - Atlas is only used to fetch a candidate
 * set quickly, never to decide the final scores. That also means we do not
 * depend on how Atlas normalises its own `vectorSearchScore`.
 */
export function rankChunks(
  queryVector: number[],
  candidates: RawChunk[],
  options: RankOptions,
): RankResult {
  let dimensionMismatches = 0
  const scored: ScoredChunk[] = []

  for (const candidate of candidates) {
    if (candidate.embedding.length !== queryVector.length) {
      dimensionMismatches += 1
      continue
    }
    const score = cosineSimilarity(queryVector, candidate.embedding)
    if (!Number.isFinite(score)) continue
    scored.push({
      chunkId: candidate.chunkId,
      documentId: candidate.documentId,
      content: candidate.content,
      pageNumber: candidate.pageNumber,
      score,
    })
  }

  scored.sort((a, b) => b.score - a.score)

  const perDocument = new Map<string, number>()
  const ranked: ScoredChunk[] = []

  for (const chunk of scored) {
    // `scored` is sorted, so once we drop below the floor nothing else qualifies.
    if (chunk.score < options.minSimilarity) break

    const used = perDocument.get(chunk.documentId) ?? 0
    if (used >= options.maxPerDocument) continue

    perDocument.set(chunk.documentId, used + 1)
    ranked.push(chunk)
    if (ranked.length >= options.topK) break
  }

  return { ranked, dimensionMismatches }
}
