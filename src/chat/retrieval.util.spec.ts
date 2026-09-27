import { RawChunk, rankChunks } from './retrieval.util'

/** queryVector is [1, 0], so cosine similarity equals the first component. */
const QUERY = [1, 0]

const chunk = (
  chunkId: string,
  documentId: string,
  firstComponent: number,
  pageNumber = 1,
): RawChunk => ({
  chunkId,
  documentId,
  content: `content of ${chunkId}`,
  pageNumber,
  embedding: [firstComponent, Math.sqrt(1 - firstComponent * firstComponent)],
})

const CANDIDATES: RawChunk[] = [
  chunk('a1', 'docA', 1.0),
  chunk('a2', 'docA', 0.8),
  chunk('a3', 'docA', 0.5, 3),
  chunk('a4', 'docA', 0.3),
  chunk('b1', 'docB', 0.6),
]

describe('rankChunks', () => {
  it('orders chunks by descending score', () => {
    const { ranked } = rankChunks(QUERY, CANDIDATES, {
      minSimilarity: 0,
      topK: 10,
      maxPerDocument: 10,
    })

    expect(ranked.map((entry) => entry.chunkId)).toEqual(['a1', 'a2', 'b1', 'a3', 'a4'])
    expect(ranked[0].score).toBeCloseTo(1)
    expect(ranked[0].pageNumber).toBe(1)
  })

  it('drops every chunk below the similarity floor', () => {
    const { ranked } = rankChunks(QUERY, CANDIDATES, {
      minSimilarity: 0.5,
      topK: 10,
      maxPerDocument: 10,
    })

    expect(ranked.map((entry) => entry.chunkId)).toEqual(['a1', 'a2', 'b1', 'a3'])
  })

  it('caps how many chunks come from one document but keeps the best ones', () => {
    const { ranked } = rankChunks(QUERY, CANDIDATES, {
      minSimilarity: 0,
      topK: 10,
      maxPerDocument: 2,
    })

    expect(ranked.map((entry) => entry.chunkId)).toEqual(['a1', 'a2', 'b1'])
  })

  it('honours topK', () => {
    const { ranked } = rankChunks(QUERY, CANDIDATES, {
      minSimilarity: 0,
      topK: 2,
      maxPerDocument: 10,
    })

    expect(ranked).toHaveLength(2)
  })

  it('counts - and excludes - chunks whose vector width does not match', () => {
    const mismatched: RawChunk[] = [
      ...CANDIDATES,
      { chunkId: 'stale', documentId: 'docC', content: 'old 1536-dim row', pageNumber: 1, embedding: [1, 0, 0] },
    ]

    const { ranked, dimensionMismatches } = rankChunks(QUERY, mismatched, {
      minSimilarity: 0,
      topK: 10,
      maxPerDocument: 10,
    })

    expect(dimensionMismatches).toBe(1)
    expect(ranked.map((entry) => entry.chunkId)).not.toContain('stale')
  })

  it('returns nothing when there are no candidates', () => {
    const { ranked, dimensionMismatches } = rankChunks(QUERY, [], {
      minSimilarity: 0,
      topK: 5,
      maxPerDocument: 5,
    })

    expect(ranked).toEqual([])
    expect(dimensionMismatches).toBe(0)
  })
})
