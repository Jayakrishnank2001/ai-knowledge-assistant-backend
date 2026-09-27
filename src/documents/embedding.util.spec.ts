import {
  EMBEDDING_DIM,
  chunkPages,
  cosineSimilarity,
  embedText,
  similarityLabel,
} from './embedding.util'

describe('cosineSimilarity', () => {
  it('returns 0 - not NaN - when the dimensions differ', () => {
    // This is the bug that silently emptied the prompt: a 3072-dim Gemini query
    // compared against a 1536-dim stored chunk used to produce NaN, and every
    // `score >= minSimilarity` check then failed.
    const query = new Array<number>(3072).fill(0)
    query[0] = 1
    const stored = new Array<number>(1536).fill(0)
    stored[0] = 1

    const score = cosineSimilarity(query, stored)

    expect(Number.isNaN(score)).toBe(false)
    expect(score).toBe(0)
  })

  it('returns 1 for identical vectors and 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('normalises raw vectors, so magnitude does not matter', () => {
    expect(cosineSimilarity([10, 0], [5, 0])).toBeCloseTo(1)
    expect(cosineSimilarity([3, 3], [7, 7])).toBeCloseTo(1)
  })

  it('returns 0 for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0)
  })
})

describe('embedText', () => {
  it('returns a unit-length vector of EMBEDDING_DIM', () => {
    const vector = embedText('paid parental leave')

    expect(vector).toHaveLength(EMBEDDING_DIM)
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
    expect(norm).toBeCloseTo(1, 5)
  })

  it('scores related text above unrelated text', () => {
    const query = embedText('How many weeks of paid parental leave are available?')
    const related = embedText(
      'Eligible employees may take 16 weeks of paid parental leave following the birth or adoption of a child.',
    )
    const unrelated = embedText('Passwords must be at least 12 characters long and include a symbol.')

    expect(cosineSimilarity(query, related)).toBeGreaterThan(cosineSimilarity(query, unrelated))
  })
})

describe('chunkPages', () => {
  const answer =
    'Eligible employees may take 16 weeks of paid parental leave following the birth or adoption of a child.'

  it('numbers chunks sequentially and keeps the source page', () => {
    const seeds = chunkPages([
      { pageNumber: 1, text: 'First page text.' },
      { pageNumber: 2, text: 'Second page text.' },
    ])

    expect(seeds.map((seed) => seed.chunkIndex)).toEqual([0, 1])
    expect(seeds.map((seed) => seed.pageNumber)).toEqual([1, 2])
  })

  it('splits a long page but keeps a sentence intact', () => {
    const filler = 'Employees should contact People Operations. '.repeat(40)
    const seeds = chunkPages([{ pageNumber: 3, text: `${filler}${answer} More trailing text.` }])

    expect(seeds.length).toBeGreaterThan(1)
    expect(seeds.every((seed) => seed.pageNumber === 3)).toBe(true)
    expect(seeds.some((seed) => seed.content.includes(answer))).toBe(true)
  })

  it('never starts or ends a chunk in the middle of a word', () => {
    // Every chunk edge must fall on a word boundary of the source text: the
    // first and last token of each chunk must exist as whole words in the
    // flattened source. (The old chunker produced chunks starting with
    // "arental leave ..." - the tail of a split "parental".)
    const escapeRegExp = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const source =
      'Policy version 2.4 is effective January 1, 2026. ' +
      'Eligible employees may take 16 weeks of paid parental leave following the birth or adoption of a child. '.repeat(
        30,
      ) +
      'Trailing sentence about payroll and team coverage.'
    const flat = source.replace(/\s+/g, ' ').trim()
    const seeds = chunkPages([{ pageNumber: 1, text: source }])

    expect(seeds.length).toBeGreaterThan(1)
    for (const seed of seeds) {
      const tokens = seed.content.split(/\s+/)
      for (const edge of [tokens[0], tokens[tokens.length - 1]]) {
        const wholeWord = new RegExp(`(^|\\s)${escapeRegExp(edge)}(\\s|$)`)
        expect(wholeWord.test(flat)).toBe(true)
      }
    }
  })

  it('flattens PDF layout line breaks so wrapped sentences stay searchable', () => {
    const seeds = chunkPages([{ pageNumber: 1, text: 'Parental\nleave   is\n 16 weeks.' }])

    expect(seeds).toHaveLength(1)
    expect(seeds[0].content).toBe('Parental leave is 16 weeks.')
  })

  it('skips pages with no usable text', () => {
    const seeds = chunkPages([
      { pageNumber: 1, text: '   \n  ' },
      { pageNumber: 2, text: 'Real content.' },
    ])

    expect(seeds).toHaveLength(1)
    expect(seeds[0].pageNumber).toBe(2)
  })
})

describe('similarityLabel', () => {
  it('never prints a NaN percentage', () => {
    expect(similarityLabel(NaN)).toBe('No match')
    expect(similarityLabel(Infinity)).toBe('No match')
  })

  it('formats a normal score as a match percentage', () => {
    expect(similarityLabel(0.82)).toBe('82% match')
  })
})
