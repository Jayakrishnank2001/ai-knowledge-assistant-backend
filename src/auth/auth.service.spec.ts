import { BadRequestException, ConflictException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import bcrypt from 'bcryptjs'
import { createHash } from 'node:crypto'
import { DatabaseService } from '../database/database.service'
import { AuthService } from './auth.service'
import { MailService } from './mail.service'

const hashOtp = (code: string) => createHash('sha256').update(code).digest('hex')

describe('AuthService - OTP signup', () => {
  let service: AuthService
  let db: {
    users: {
      exists: jest.Mock
      findOne: jest.Mock
      create: jest.Mock
      updateOne: jest.Mock
    }
    signupOtps: {
      updateOne: jest.Mock
      findOne: jest.Mock
      deleteOne: jest.Mock
    }
  }
  let mailer: { sendSignupOtp: jest.Mock }
  /** The most recent code the "email" delivered (mailer mock echoes it back). */
  let lastCode: () => string

  beforeEach(() => {
    db = {
      users: { exists: jest.fn(), findOne: jest.fn(), create: jest.fn(), updateOne: jest.fn() },
      signupOtps: { updateOne: jest.fn(), findOne: jest.fn(), deleteOne: jest.fn() },
    }
    mailer = {
      sendSignupOtp: jest.fn().mockImplementation(async (mail: { code: string }) => mail.code),
    }
    lastCode = () => mailer.sendSignupOtp.mock.calls.at(-1)![0].code

    service = new AuthService(
      db as unknown as DatabaseService,
      new JwtService({ secret: 'test-secret', signOptions: { expiresIn: '1h' } }),
      mailer as unknown as MailService,
    )
  })

  describe('startSignup', () => {
    it('stores a pending signup with hashed code + hashed password and emails the code', async () => {
      db.users.exists.mockResolvedValue(false)

      const result = await service.startSignup({
        email: 'Jane.Doe@Example.com',
        password: 'secret123',
      })

      expect(result).toEqual({
        success: true,
        message: 'Verification code sent',
        devOtp: expect.any(String),
      })
      expect(mailer.sendSignupOtp).toHaveBeenCalledTimes(1)

      const code = lastCode()
      expect(code).toMatch(/^\d{6}$/)

      expect(db.signupOtps.updateOne).toHaveBeenCalledTimes(1)
      const [filter, update, options] = db.signupOtps.updateOne.mock.calls[0]
      expect(filter).toEqual({ email: 'jane.doe@example.com' })
      expect(options).toEqual({ upsert: true })
      // nothing readable is stored - only hashes
      expect(update.$set.codeHash).toBe(hashOtp(code))
      expect(update.$set.codeHash).not.toBe(code)
      expect(await bcrypt.compare('secret123', update.$set.passwordHash)).toBe(true)
      expect(update.$set.attempts).toBe(0)
      expect(update.$set.expiresAt.getTime()).toBeGreaterThan(Date.now())
    })

    it('rejects an email that already has an account', async () => {
      db.users.exists.mockResolvedValue(true)

      await expect(
        service.startSignup({ email: 'taken@example.com', password: 'secret123' }),
      ).rejects.toThrow(ConflictException)
      expect(mailer.sendSignupOtp).not.toHaveBeenCalled()
      expect(db.signupOtps.updateOne).not.toHaveBeenCalled()
    })

    it('omits devOtp when the mailer does not echo the code (real SMTP)', async () => {
      db.users.exists.mockResolvedValue(false)
      mailer.sendSignupOtp.mockResolvedValue(null)

      const result = await service.startSignup({
        email: 'jane@example.com',
        password: 'secret123',
      })
      expect(result).toEqual({ success: true, message: 'Verification code sent to your email' })
    })
  })

  describe('verifySignup', () => {
    const pendingRow = (code: string, overrides: Record<string, unknown> = {}) => ({
      _id: { toString: () => 'otp-id' },
      email: 'jane@example.com',
      codeHash: hashOtp(code),
      passwordHash: '$2b$10$hashedpasswordplaceholderhashedpasswordplaceholder',
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
      ...overrides,
    })

    beforeEach(() => {
      db.users.exists.mockResolvedValue(false)
      db.users.create.mockImplementation(async (doc: Record<string, unknown>) => ({
        _id: { toString: () => 'new-user-id' },
        ...doc,
      }))
      db.signupOtps.deleteOne.mockResolvedValue({ deletedCount: 1 })
    })

    it('creates the user, clears the pending row and returns a session', async () => {
      const code = '123456'
      db.signupOtps.findOne.mockResolvedValue(pendingRow(code))

      const session = await service.verifySignup({ email: 'jane@example.com', otp: code })

      expect(db.users.create).toHaveBeenCalledTimes(1)
      const created = db.users.create.mock.calls[0][0]
      expect(created.email).toBe('jane@example.com')
      expect(created.name).toBe('Jane') // derived from the email local part
      expect(created.password).toBe(pendingRow(code).passwordHash) // carried over, still a hash
      expect(db.signupOtps.deleteOne).toHaveBeenCalledTimes(1)

      expect(session.token).toEqual(expect.any(String))
      expect(session.user).toEqual({
        id: 'new-user-id',
        email: 'jane@example.com',
        name: 'Jane',
        workspaceName: 'Acme knowledge base',
      })
      // and the returned token is a valid JWT for this user
      const payload = await new JwtService({ secret: 'test-secret' }).verifyAsync<{
        sub: string
      }>(session.token)
      expect(payload.sub).toBe('new-user-id')
    })

    it('rejects an incorrect code and counts the attempt', async () => {
      db.signupOtps.findOne.mockResolvedValue(pendingRow('123456'))

      await expect(
        service.verifySignup({ email: 'jane@example.com', otp: '999999' }),
      ).rejects.toThrow('Incorrect code')

      expect(db.signupOtps.updateOne).toHaveBeenCalledWith(
        { _id: expect.anything() },
        { $set: { attempts: 1 } },
      )
      expect(db.users.create).not.toHaveBeenCalled()
    })

    it('destroys the pending signup after too many wrong attempts', async () => {
      db.signupOtps.findOne.mockResolvedValue(pendingRow('123456', { attempts: 4 }))

      await expect(
        service.verifySignup({ email: 'jane@example.com', otp: '000000' }),
      ).rejects.toThrow('Too many incorrect attempts')
      expect(db.signupOtps.deleteOne).toHaveBeenCalledTimes(1)
      expect(db.users.create).not.toHaveBeenCalled()
    })

    it('rejects an expired code and clears it', async () => {
      db.signupOtps.findOne.mockResolvedValue(
        pendingRow('123456', { expiresAt: new Date(Date.now() - 1_000) }),
      )

      await expect(
        service.verifySignup({ email: 'jane@example.com', otp: '123456' }),
      ).rejects.toThrow('expired')
      expect(db.signupOtps.deleteOne).toHaveBeenCalledTimes(1)
      expect(db.users.create).not.toHaveBeenCalled()
    })

    it('rejects verification when no signup is in progress', async () => {
      db.signupOtps.findOne.mockResolvedValue(null)

      await expect(
        service.verifySignup({ email: 'ghost@example.com', otp: '123456' }),
      ).rejects.toThrow('No signup in progress')
    })

    it('rejects when the account already exists at verify time', async () => {
      db.signupOtps.findOne.mockResolvedValue(pendingRow('123456'))
      db.users.exists.mockResolvedValue(true)

      await expect(
        service.verifySignup({ email: 'jane@example.com', otp: '123456' }),
      ).rejects.toThrow(ConflictException)
      expect(db.users.create).not.toHaveBeenCalled()
      expect(db.signupOtps.deleteOne).toHaveBeenCalledTimes(1)
    })

    it('turns a duplicate-key race on user creation into a conflict', async () => {
      db.signupOtps.findOne.mockResolvedValue(pendingRow('123456'))
      db.users.create.mockRejectedValue({ code: 11000 })

      await expect(
        service.verifySignup({ email: 'jane@example.com', otp: '123456' }),
      ).rejects.toThrow(ConflictException)
    })

    it('rejects malformed codes', async () => {
      db.signupOtps.findOne.mockResolvedValue(pendingRow('123456'))

      await expect(
        service.verifySignup({ email: 'jane@example.com', otp: '12ab56' }),
      ).rejects.toThrow(BadRequestException)
      expect(db.users.create).not.toHaveBeenCalled()
    })
  })

  describe('SignupVerifyDto validation (enforced by the global ValidationPipe)', () => {
    it('accepts a 6-digit code and rejects anything else', async () => {
      const { validate } = await import('class-validator')
      const { SignupVerifyDto } = await import('./dto/auth.dto')

      const ok = Object.assign(new SignupVerifyDto(), {
        email: 'jane@example.com',
        otp: '123456',
      })
      expect(await validate(ok)).toHaveLength(0)

      for (const badOtp of ['12345', '1234567', '12ab56', '']) {
        const bad = Object.assign(new SignupVerifyDto(), {
          email: 'jane@example.com',
          otp: badOtp,
        })
        const violations = await validate(bad)
        expect(violations.map((v) => v.property)).toContain('otp')
      }
    })
  })
})
