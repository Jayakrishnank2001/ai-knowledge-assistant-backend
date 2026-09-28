import { DatabaseService } from '../database/database.service'
import { OverviewService } from './overview.service'

interface MockOptions {
  /** [total documents, completed documents] returned by the two countDocuments calls. */
  counts?: [number, number]
  /** pageCount values of the scoped, completed documents. */
  pageCounts?: number[]
  questions?: number
  conversations?: { _id: string }[]
  documents?: Record<string, unknown>[]
}

function createMocks(options: MockOptions = {}) {
  const counts = options.counts ?? [0, 0]
  const pageCounts = options.pageCounts ?? []
  const questions = options.questions ?? 0
  const conversations = options.conversations ?? []
  const documents = options.documents ?? []

  const documentsCount = jest
    .fn()
    .mockResolvedValueOnce(counts[0])
    .mockResolvedValueOnce(counts[1])

  // documents.find(scope).sort().limit(5).exec()  AND
  // documents.find(scope, { pageCount: 1 }).exec()
  const documentsExec = jest.fn().mockResolvedValue(documents)
  const documentsLimit = jest.fn().mockReturnValue({ exec: documentsExec })
  const documentsSort = jest.fn().mockReturnValue({ limit: documentsLimit })
  const pagesExec = jest
    .fn()
    .mockResolvedValue(pageCounts.map((pageCount) => ({ pageCount })))
  const documentsFind = jest.fn().mockReturnValue({ sort: documentsSort, exec: pagesExec })

  // conversations.find({ userId }, { _id: 1 }).exec()
  const conversationsExec = jest.fn().mockResolvedValue(conversations)
  const conversationsFind = jest.fn().mockReturnValue({ exec: conversationsExec })

  const messagesCount = jest.fn().mockResolvedValue(questions)

  const db = {
    documents: { countDocuments: documentsCount, find: documentsFind },
    conversations: { find: conversationsFind },
    messages: { countDocuments: messagesCount },
  } as unknown as DatabaseService

  return {
    db,
    documentsCount,
    documentsFind,
    documentsSort,
    documentsLimit,
    pagesExec,
    conversationsFind,
    messagesCount,
  }
}

const sharedScope = (userId: string) => ({ $or: [{ userId: null }, { userId }] })

describe('OverviewService', () => {
  describe('stats', () => {
    it('reports the counters for the caller', async () => {
      const mocks = createMocks({
        counts: [4, 3],
        pageCounts: [7, 5],
        conversations: [{ _id: 'conv-1' }],
        questions: 2,
      })
      const service = new OverviewService(mocks.db)

      await expect(service.stats('user-a')).resolves.toEqual({
        documents: 4,
        pages: 12,
        processedPercent: 75,
        conversations: 1,
        questionsAnswered: 2,
      })
    })

    it('counts only the caller documents plus the shared knowledge base', async () => {
      const mocks = createMocks()
      const service = new OverviewService(mocks.db)

      await service.stats('user-a')

      // the regression this guards: an unscoped countDocuments() listed every
      // account's uploads on the dashboard
      expect(mocks.documentsCount).toHaveBeenNthCalledWith(1, sharedScope('user-a'))
      expect(mocks.documentsCount).toHaveBeenNthCalledWith(2, {
        ...sharedScope('user-a'),
        status: 'completed',
      })
      expect(mocks.documentsCount).not.toHaveBeenCalledWith()
    })

    it('reads page counts through a scoped query that casts the user id', async () => {
      const mocks = createMocks({ pageCounts: [3] })
      const service = new OverviewService(mocks.db)

      await service.stats('user-a')

      // an aggregation $match would not get this casting and would sum nothing
      expect(mocks.documentsFind).toHaveBeenCalledWith(
        { ...sharedScope('user-a'), status: 'completed' },
        { pageCount: 1 },
      )
    })

    it('sums the page counts of the scoped documents', async () => {
      const mocks = createMocks({ counts: [2, 2], pageCounts: [4, 5] })
      const service = new OverviewService(mocks.db)

      const stats = await service.stats('user-a')

      expect(stats.pages).toBe(9)
      expect(stats.processedPercent).toBe(100)
    })

    it('looks up conversations by user id - never all conversations', async () => {
      const mocks = createMocks({ conversations: [{ _id: 'conv-1' }] })
      const service = new OverviewService(mocks.db)

      await service.stats('user-a')

      expect(mocks.conversationsFind).toHaveBeenCalledWith({ userId: 'user-a' }, { _id: 1 })
    })

    it('counts answered questions only inside the caller own conversations', async () => {
      const mocks = createMocks({
        conversations: [{ _id: 'conv-1' }, { _id: 'conv-2' }],
        questions: 5,
      })
      const service = new OverviewService(mocks.db)

      const stats = await service.stats('user-a')

      expect(mocks.messagesCount).toHaveBeenCalledWith({
        conversationId: { $in: ['conv-1', 'conv-2'] },
        role: 'assistant',
      })
      // never the global "count every assistant message" query
      expect(mocks.messagesCount).not.toHaveBeenCalledWith({ role: 'assistant' })
      expect(stats.questionsAnswered).toBe(5)
    })

    it('reports zero questions and skips the message query when there are no conversations', async () => {
      const mocks = createMocks({ conversations: [] })
      const service = new OverviewService(mocks.db)

      const stats = await service.stats('user-a')

      expect(stats.conversations).toBe(0)
      expect(stats.questionsAnswered).toBe(0)
      expect(mocks.messagesCount).not.toHaveBeenCalled()
    })

    it('avoids dividing by zero when the user has no documents', async () => {
      const mocks = createMocks({ counts: [0, 0], pageCounts: [] })
      const service = new OverviewService(mocks.db)

      await expect(service.stats('user-a')).resolves.toMatchObject({
        documents: 0,
        pages: 0,
        processedPercent: 0,
      })
    })

    it('scopes each caller separately', async () => {
      const mocks = createMocks()
      const service = new OverviewService(mocks.db)

      await service.stats('user-a')
      await service.stats('user-b')

      expect(mocks.documentsCount).toHaveBeenNthCalledWith(1, sharedScope('user-a'))
      expect(mocks.documentsCount).toHaveBeenNthCalledWith(3, sharedScope('user-b'))
      expect(mocks.conversationsFind).toHaveBeenNthCalledWith(1, { userId: 'user-a' }, { _id: 1 })
      expect(mocks.conversationsFind).toHaveBeenNthCalledWith(2, { userId: 'user-b' }, { _id: 1 })
    })
  })

  describe('recentDocuments', () => {
    it('filters by the caller scope, newest first, limited to five', async () => {
      const mocks = createMocks()
      const service = new OverviewService(mocks.db)

      await service.recentDocuments('user-a')

      expect(mocks.documentsFind).toHaveBeenCalledWith(sharedScope('user-a'))
      // the regression this guards: a bare find() returned every user's uploads
      expect(mocks.documentsFind).not.toHaveBeenCalledWith()
      expect(mocks.documentsSort).toHaveBeenCalledWith({ uploadedAt: -1 })
      expect(mocks.documentsLimit).toHaveBeenCalledWith(5)
    })

    it('maps stored rows to the dashboard shape', async () => {
      const uploadedAt = new Date(Date.now() - 2 * 86_400_000)
      const mocks = createMocks({
        documents: [
          {
            _id: { toString: () => 'doc-1' },
            fileName: 'leave-policy.pdf',
            pageCount: 3,
            status: 'completed',
            uploadedAt,
          },
        ],
      })
      const service = new OverviewService(mocks.db)

      await expect(service.recentDocuments('user-a')).resolves.toEqual([
        {
          id: 'doc-1',
          name: 'leave-policy.pdf',
          pages: 3,
          daysAgo: 2,
          status: 'completed',
        },
      ])
    })
  })
})
