import { ServiceUnavailableException } from '@nestjs/common'
import { MailService } from './mail.service'

describe('MailService', () => {
  const RESEND_ENV = ['RESEND_API_KEY', 'MAIL_FROM'] as const
  const saved: Record<string, string | undefined> = {}
  const realFetch = global.fetch

  beforeEach(() => {
    for (const key of RESEND_ENV) saved[key] = process.env[key]
  })

  afterEach(() => {
    for (const key of RESEND_ENV) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
    global.fetch = realFetch
    jest.restoreAllMocks()
  })

  describe('dev fallback (RESEND_API_KEY not configured)', () => {
    it('returns the code and never calls the Resend API', async () => {
      delete process.env.RESEND_API_KEY
      const fetchMock = jest.fn()
      global.fetch = fetchMock as never

      const service = new MailService()
      await expect(
        service.sendSignupOtp({ to: 'jane@example.com', code: '123456' }),
      ).resolves.toBe('123456')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('is a hard error in production', async () => {
      delete process.env.RESEND_API_KEY
      const prev = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'
      try {
        const service = new MailService()
        await expect(
          service.sendSignupOtp({ to: 'jane@example.com', code: '123456' }),
        ).rejects.toThrow(ServiceUnavailableException)
      } finally {
        if (prev === undefined) delete process.env.NODE_ENV
        else process.env.NODE_ENV = prev
      }
    })
  })

  describe('with RESEND_API_KEY configured', () => {
    const configureResend = () => {
      process.env.RESEND_API_KEY = 're_test_key'
      process.env.MAIL_FROM = 'Nexa AI <noreply@example.com>'
    }

    it('POSTs the code to Resend and resolves with null (no dev hint)', async () => {
      configureResend()
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 } as never)
      global.fetch = fetchMock as never

      const service = new MailService()
      await expect(
        service.sendSignupOtp({ to: 'jane@example.com', code: '654321' }),
      ).resolves.toBeNull()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0] as [
        string,
        { method: string; headers: Record<string, string>; body: string },
      ]
      expect(url).toBe('https://api.resend.com/emails')
      expect(init.method).toBe('POST')
      expect(init.headers.Authorization).toBe('Bearer re_test_key')

      const payload = JSON.parse(init.body) as Record<string, unknown>
      expect(payload.from).toBe('Nexa AI <noreply@example.com>')
      expect(payload.to).toEqual(['jane@example.com'])
      expect(payload.subject).toContain('signup code')
      expect(payload.text).toContain('654321')
    })

    it('turns a Resend rejection into a clean 503 without leaking provider details', async () => {
      configureResend()
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'invalid api key: re_live_secret',
      }) as never

      const service = new MailService()
      await expect(
        service.sendSignupOtp({ to: 'jane@example.com', code: '123456' }),
      ).rejects.toThrow(ServiceUnavailableException)

      await expect(
        service.sendSignupOtp({ to: 'jane@example.com', code: '123456' }),
      ).rejects.toThrow('Could not send the verification email')
      // the raw provider error must never reach the client
      await expect(
        service.sendSignupOtp({ to: 'jane@example.com', code: '123456' }),
      ).rejects.not.toThrow(/re_live_secret|401/)
    })

    it('turns a network failure into a clean 503', async () => {
      configureResend()
      global.fetch = jest.fn().mockRejectedValue(new Error('fetch failed')) as never

      const service = new MailService()
      await expect(
        service.sendSignupOtp({ to: 'jane@example.com', code: '123456' }),
      ).rejects.toThrow(ServiceUnavailableException)
    })
  })
})
