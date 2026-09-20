/**
 * Tiny deterministic "embedding" + chunking helpers.
 *
 * This is a MOCK embedding model for the MVP: identical text always produces
 * the identical vector, and texts sharing words receive vectors that point in
 * similar directions (so cosine similarity works). In a real RAG app you would
 * replace `embedText` with an embedding API (OpenAI text-embedding-3-small,
 * Cohere embed, ...) and `buildChunkSeeds` with a real PDF text extractor +
 * chunker that also stores page numbers.
 */

export const EMBEDDING_DIM = 1536 // mirrors a real embedding model (e.g. OpenAI text-embedding-3-small)
export const MIN_SIMILARITY = 0.12

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

/** Cosine similarity between two L2-normalized vectors (0..1). */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB) || 1
  return dot / denominator
}

/** Nice "98% match" style label from a similarity score (0..1). */
export function similarityLabel(score: number): string {
  const pct = Math.min(99, Math.max(1, Math.round(score * 100)))
  return `${pct}% match`
}

// ---------------------------------------------------------------------------
// Chunk content sources. Matching real filenames gives rich, realistic text;
// any other upload falls back to a small generated summary.
// ---------------------------------------------------------------------------

interface ContentPoolEntry {
  fileName: string
  pages: string[]
}

const CONTENT_POOL: ContentPoolEntry[] = [
  {
    fileName: 'Employee Handbook.pdf',
    pages: [
      'Working hours: the standard working hours are 9:00 AM to 5:00 PM, Monday to Friday. Employees are also allowed a 1-hour lunch break and may request flexible or remote working arrangements through HR.',
      'Remote work: employees may request flexible or fully remote working arrangements through HR. Approval depends on role and team requirements.',
      'Annual leave: employees receive 24 days of paid annual leave per year. All leave requests should be submitted at least two weeks in advance.',
    ],
  },
  {
    fileName: 'Leave Policy.pdf',
    pages: [
      'Annual leave entitlement: employees are entitled to 24 days of paid annual leave per year according to the leave policy. Leave requests should be submitted through the leave portal at least two weeks in advance.',
      'Leave carry-over: leave can be carried over subject to policy limits. Special leave and parental leave requests are reviewed by HR on a case-by-case basis.',
    ],
  },
  {
    fileName: 'IT Security Guide.pdf',
    pages: [
      'Password requirements: passwords must be at least 12 characters long and include upper/lowercase letters, a number and a symbol. Multi-factor authentication (MFA) is mandatory for all corporate accounts.',
      'Credential security: never share credentials with anyone. Suspicious login activity must be reported to the IT security team within 24 hours.',
    ],
  },
  {
    fileName: 'Company Overview.pdf',
    pages: [
      'Company overview: the company builds AI-powered enterprise knowledge tools that help teams turn internal documents into searchable, answerable knowledge bases.',
      'Mission: founded with a mission to make organisational knowledge accessible, the company serves enterprise customers across multiple industries.',
    ],
  },
]

function genericPages(fileName: string): string[] {
  const base = fileName.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ')
  return [
    `This document (${fileName}) contains information relevant to your knowledge base. The full text has been processed, chunked and indexed for retrieval.`,
    `Key facts from this document should be checked against the original source. The knowledge assistant references this document when answering related questions. (${base || 'Related material'})`,
  ]
}

/**
 * Produces the one-chunk-per-page seeds for a document. Real filenames that
 * appear in CONTENT_POOL get meaningful pages; everything else gets a small
 * generated summary so uploads are immediately searchable.
 */
export function buildChunkSeeds(fileName: string): ChunkSeed[] {
  const entry = CONTENT_POOL.find(
    (pool) => pool.fileName.toLowerCase() === fileName.toLowerCase(),
  )
  const pages = entry ? entry.pages : genericPages(fileName)
  return pages.map((content, index) => ({
    content,
    pageNumber: index + 1,
    chunkIndex: index,
  }))
}