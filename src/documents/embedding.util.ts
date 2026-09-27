/**
 * Pure, dependency-free helpers shared by the indexing and retrieval paths:
 * chunking, the mock "embedding" model, and vector maths.
 *
 * The real embedding model lives in `src/providers/embedding.provider.ts`.
 * `embedText` below is only the offline MOCK used when no GEMINI_API_KEY is
 * configured - it is a deterministic hashed bag-of-words, NOT semantic.
 */

/**
 * The single source of truth for vector width.
 *
 * Both providers must produce exactly this many numbers, because the Atlas
 * Vector Search index is built with a fixed `numDimensions`. The Gemini
 * provider passes this value as `outputDimensionality`, and the mock hashes
 * into this many slots.
 */
export const EMBEDDING_DIM = 1536

/** Roughly 250-300 words: big enough for context, small enough to stay focused. */
export const CHUNK_TARGET_CHARS = 1000

/** Repeated between neighbours so an answer straddling a boundary stays whole. */
export const CHUNK_OVERLAP_CHARS = 200

export interface PageText {
  pageNumber: number
  text: string
}

export interface ChunkSeed {
  content: string
  pageNumber: number
  chunkIndex: number
}

/** Common English stopwords - they carry no semantic signal. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'so', 'yet', 'of', 'to', 'for',
  'in', 'on', 'at', 'by', 'with', 'from', 'as', 'into', 'onto', 'over', 'under',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did',
  'can', 'could', 'would', 'should', 'will', 'shall', 'may', 'might', 'must',
  'have', 'has', 'had', 'not', 'no', 'yes', 'how', 'what', 'when', 'where',
  'who', 'why', 'which', 'this', 'that', 'these', 'those', 'there', 'here',
  'it', 'its', 'they', 'them', 'their', 'your', 'you', 'we', 'our', 'us',
  'i', 'he', 'she', 'his', 'her', 'me', 'my', 'all', 'each', 'some', 'any',
  'more', 'most', 'other', 'such', 'only', 'own', 'same', 'than', 'too', 'very',
])

/** Crude singularisation so "password" and "passwords" hash to the same slot. */
function normalizeToken(token: string): string | null {
  let word = token.toLowerCase()
  if (STOPWORDS.has(word)) return null
  if (word.length > 4 && word.endsWith('ies')) word = `${word.slice(0, -3)}y`
  else if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) {
    word = word.slice(0, -1)
  }
  return word
}

/** L2-normalized, stopword-free bag-of-hashed-words vector. */
export function embedText(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIM).fill(0)
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? []

  for (const token of tokens) {
    const word = normalizeToken(token)
    if (!word) continue
    let hash = 2166136261 // FNV-1a 32-bit
    for (let i = 0; i < word.length; i++) {
      hash ^= word.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    const index = Math.abs(hash) % EMBEDDING_DIM
    vector[index] += 1
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  return norm > 0 ? vector.map((value) => value / norm) : vector
}

/**
 * Cosine similarity for two raw (NOT pre-normalized) vectors.
 *
 * Returns 0 - never NaN - when the dimensions differ, so a stale vector from
 * another embedding model degrades to "no match" instead of poisoning every
 * score in the ranking. Callers can surface the mismatch via a dimension check.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0
  if (a.length === 0 || a.length !== b.length) return 0

  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) return 0
  return dot / denominator
}

/** Nice "98% match" style label from a cosine score (-1..1). */
export function similarityLabel(score: number): string {
  if (!Number.isFinite(score)) return 'No match'
  const pct = Math.min(99, Math.max(1, Math.round(score * 100)))
  return `${pct}% match`
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/**
 * Splits one oversized run of text into pieces of at most `target` chars,
 * cutting only after a sentence-ending mark followed by whitespace, so neither
 * a sentence nor an individual word is ever split across chunks.
 * Consecutive pieces share `overlap` chars.
 */
function splitLongText(text: string, target: number, overlap: number): string[] {
  const pieces: string[] = []
  let start = 0

  while (start < text.length) {
    let end = Math.min(start + target, text.length)

    if (end < text.length) {
      const window = text.slice(start, end)
      // Sentence boundaries only: ". ", "! " or "? " (period must be followed
      // by whitespace so version numbers like "2.4" or "1.5" never count).
      const sentenceEnd = [...window.matchAll(/[.!?]\s+/g)].map((match) =>
        match.index === undefined ? -1 : match.index + match[0].length,
      )
      const boundary = sentenceEnd.length > 0 ? Math.max(...sentenceEnd) : -1
      // Only honour the boundary if it does not shrink the chunk too much.
      // Otherwise take the whole window - never fall back to cutting the
      // middle of a word (a mid-word seam breaks both embedding and lexical
      // matching for the two halves).
      if (boundary > target * 0.5) end = start + boundary
    }

    const piece = text.slice(start, end).trim()
    if (piece) pieces.push(piece)
    if (end >= text.length) break
    // Next window backtracks over the previous tail to preserve context, but
    // restarts at a word boundary so no chunk ever begins mid-word.
    let next = Math.max(end - overlap, start + 1)
    while (next < end && !/\s/.test(text[next - 1])) next++
    start = next
  }

  return pieces
}

/**
 * Turns extracted page text into the chunks that get embedded and stored.
 *
 * Line breaks in a PDF come from *layout* wrapping rather than from sentences,
 * so each page is first flattened to single-spaced prose and then cut on
 * sentence boundaries. `pageNumber` is carried through so citations stay
 * accurate, and `chunkIndex` is sequential across the whole document.
 */
export function chunkPages(
  pages: PageText[],
  target: number = CHUNK_TARGET_CHARS,
  overlap: number = CHUNK_OVERLAP_CHARS,
): ChunkSeed[] {
  const seeds: ChunkSeed[] = []

  for (const page of pages) {
    const flat = page.text.replace(/\s+/g, ' ').trim()
    if (!flat) continue

    for (const piece of splitLongText(flat, target, overlap)) {
      seeds.push({ content: piece, pageNumber: page.pageNumber, chunkIndex: seeds.length })
    }
  }

  return seeds
}
