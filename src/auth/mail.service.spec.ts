import { ServiceUnavailableException } from '@nestjs/common'
import { MailService } from './mail.service'

describe('MailService', () => {
  const SMTP_ENV = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'] as const
  const saved: Record<string, string | undefined> = {}

  const setSmtpEnv = () => {
    process.env.SMTP_HOST = 'smtp.example.com'
    process.env.SMTP_PORT = '587'
    process.env.SMTP_USER = 'noreply@example.com'
    process.env.SMTP_PASS = 'secret'
    process.env.SMTP_FROM = 'Nexa AI <noreply@example.com>'
  }

  beforeEach(() => {
    for (const key of SMTP_ENV) saved[key] = process.env[key]
  })

  afterEach(() => {
    for (const key of SMTP_ENV) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
    jest.restoreAllMocks()
  })

  describe('dev fallback (SMTP not configured)', () => {
    it('returns the code and never sends anything', async () => {
      for (const key of SMTP_ENV) delete process.env[key]

      const service = new MailService()
      expect(service.isSmtpConfigured).toBe(false)
      await expect(
        service.sendSignupOtp({ to: 'jane@example.com', code: '123456' }),
      ).resolves.toBe('123456')
    })

    it('is a hard error in production', async () => {
      for (const key of SMTP_ENV) delete process.env[key]
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

  describe('with SMTP configured', () => {
    it('sends the code and resolves with null (no dev hint)', async () => {
      setSmtpEnv()
      const service = new MailService()
      expect(service.isSmtpConfigured).toBe(true)

      const sendMail = jest
        .spyOn(service['transporter']!, 'sendMail')
        .mockResolvedValue(undefined as never)

      await expect(
        service.sendSignupOtp({ to: 'jane@example.com', code: '654321' }),
      ).resolves.toBeNull()

      expect(sendMail).toHaveBeenCalledTimes(1)
      const payload = sendMail.mock.calls[0][0] as Record<string, unknown>
      expect(payload.to).toBe('jane@example.com')
      expect(payload.from).toBe('Nexa AI <noreply@example.com>')
      expect(payload.subject).toContain('signup code')
      expect(payload.text).toContain('654321')
    })

    it('turns an SMTP rejection into a clean 503 without leaking SMTP details', async () => {
      setSmtpEnv()
      const service = new MailService()
      jest.spyOn(service['transporter']!, 'sendMail').mockRejectedValue(
        new Error('535 5.7.8 Username and Password not accepted. a92af1059eb24-smtp.gmail.com') as never,
      )

      await expect(
        service.sendSignupOtp({ to: 'jane@example.com', code: '123456' }),
      ).rejects.toThrow(ServiceUnavailableException)

      await expect(
        service.sendSignupOtp({ to: 'jane@example.com', code: '123456' }),
      ).rejects.toThrow('Could not send the verification email')
      // the raw provider error must never reach the client
      await expect(
        service.sendSignupOtp({ to: 'jane@example.com', code: '123456' }),
      ).rejects.not.toThrow(/535|gmail/)
    })
  })
})
