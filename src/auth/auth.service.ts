import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import bcrypt from 'bcryptjs'
import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import { DatabaseService } from '../database/database.service'
import { MailService } from './mail.service'
import {
  LoginDto,
  RegisterDto,
  SignupStartDto,
  SignupVerifyDto,
  UpdateProfileDto,
} from './dto/auth.dto'

const BCRYPT_ROUNDS = 10
/** bcrypt hashes always start with $2a/$2b/$2y - anything else is a legacy plaintext row. */
const BCRYPT_PREFIX = '$2'
const DEFAULT_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** How long a signup code stays valid. */
const OTP_TTL_MS = 10 * 60 * 1000
/** Wrong guesses allowed before the pending signup is thrown away. */
const MAX_OTP_ATTEMPTS = 5

/** sha256 of the 6-digit code - what gets stored in signup_otps.codeHash. */
function hashOtp(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

/**
 * The signup form only asks for email + password, so the required display
 * name is derived from the email: "john.doe@example.com" -> "John Doe".
 */
function nameFromEmail(email: string): string {
  const local = email.split('@')[0]
  const words = local.split(/[._\-+]+/).filter(Boolean)
  if (words.length === 0) return local
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

/** Minimal slice of a hydrated mongoose document the auth logic needs. */
interface StoredUser {
  _id: { toString(): string }
  email: string
  password: string
  name: string
  workspaceName?: string
}

interface JwtPayload {
  sub: string
  email: string
  exp?: number
}

/** A row from `signup_otps` - a signup waiting for its email code. */
interface PendingSignup {
  _id: { toString(): string }
  email: string
  codeHash: string
  passwordHash: string
  expiresAt: Date
  attempts: number
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly mailer: MailService,
  ) {}

  async login(dto: LoginDto) {
    const user = (await this.db.users.findOne({
      email: dto.email.toLowerCase(),
    })) as StoredUser | null
    if (!user || !(await this.passwordMatches(dto.password, user))) {
      throw new UnauthorizedException('Invalid email or password')
    }
    return this.createSession(user)
  }

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase()
    if (await this.db.users.exists({ email })) {
      throw new ConflictException('An account with this email already exists')
    }
    try {
      const user = (await this.db.users.create({
        email,
        password: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
        name: dto.name,
        workspaceName: 'Acme knowledge base',
      })) as StoredUser
      return this.createSession(user)
    } catch (error) {
      // Handle a race between the exists() check and the insert (code 11000)
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('An account with this email already exists')
      }
      throw error
    }
  }

  /**
   * Verify a signed token and return the logged-in user.
   * Tokens are stateless, so this is where the signature, expiry and the
   * logout revocation list are all enforced.
   */
  async me(token: string) {
    const payload = this.verifyToken(token)

    if (await this.db.revokedTokens.exists({ token })) {
      throw new UnauthorizedException('Session has been logged out')
    }

    const user = (await this.db.users.findById(payload.sub)) as StoredUser | null
    if (!user) {
      throw new UnauthorizedException('Invalid or expired session')
    }
    return this.publicUser(user)
  }

  /**
   * Revoke a token so it stops working immediately. The row lives in MongoDB
   * and carries a TTL index, so it is deleted automatically once the JWT
   * itself would have expired.
   */
  async logout(token: string) {
    try {
      const payload = this.jwt.verify<JwtPayload>(token)
      const expiresAt = payload.exp
        ? new Date(payload.exp * 1000)
        : new Date(Date.now() + DEFAULT_TOKEN_TTL_MS)
      await this.db.revokedTokens.updateOne(
        { token },
        { $set: { token, expiresAt } },
        { upsert: true },
      )
    } catch {
      // already invalid or expired - there is nothing left to revoke
    }
    return { success: true }
  }

  /** Update the logged-in user's profile. Only provided fields change. */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const updates: Record<string, unknown> = {}

    if (dto.name !== undefined) updates.name = dto.name.trim()
    if (dto.workspaceName !== undefined) updates.workspaceName = dto.workspaceName.trim()

    if (dto.email !== undefined) {
      const email = dto.email.toLowerCase()
      const existing = (await this.db.users.findOne({ email })) as StoredUser | null
      if (existing && existing._id.toString() !== userId) {
        throw new ConflictException('That email is already in use')
      }
      updates.email = email
    }

    if (Object.keys(updates).length === 0) {
      throw new BadRequestException('Nothing to update')
    }

    try {
      const user = (await this.db.users.findByIdAndUpdate(
        userId,
        { $set: updates },
        { new: true },
      )) as StoredUser | null
      if (!user) {
        throw new UnauthorizedException('Invalid or expired session')
      }
      return this.publicUser(user)
    } catch (error) {
      // unique index race on email
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('That email is already in use')
      }
      throw error
    }
  }

  /**
   * Step 1 of the OTP signup.
   *
   * Rejects taken emails, then stores a pending signup (fresh code, hashed
   * password, 10-minute expiry) and emails the code. Calling it again for
   * the same email just issues a new code, which doubles as "resend".
   * Returns `devOtp` only when SMTP is unconfigured (local dev fallback).
   */
  async startSignup(dto: SignupStartDto) {
    const email = dto.email.toLowerCase()
    if (await this.db.users.exists({ email })) {
      throw new ConflictException('An account with this email already exists')
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS)
    const expiresAt = new Date(Date.now() + OTP_TTL_MS)

    try {
      await this.db.signupOtps.updateOne(
        { email },
        { $set: { email, codeHash: hashOtp(code), passwordHash, expiresAt, attempts: 0 } },
        { upsert: true },
      )
    } catch (error) {
      // two "start" calls racing on the same email hit the unique index
      if ((error as { code?: number }).code === 11000) {
        await this.db.signupOtps.updateOne(
          { email },
          { $set: { email, codeHash: hashOtp(code), passwordHash, expiresAt, attempts: 0 } },
        )
      } else {
        throw error
      }
    }

    const devOtp = await this.mailer.sendSignupOtp({ to: email, code })
    return devOtp
      ? { success: true, message: 'Verification code sent', devOtp }
      : { success: true, message: 'Verification code sent to your email' }
  }

  /**
   * Step 2 of the OTP signup: check the emailed code, then create the user
   * and start a session in one go - a verified signup logs the user in.
   */
  async verifySignup(dto: SignupVerifyDto) {
    const email = dto.email.toLowerCase()
    const pending = (await this.db.signupOtps.findOne({ email })) as PendingSignup | null
    if (!pending) {
      throw new BadRequestException('No signup in progress for this email - request a new code')
    }

    if (pending.expiresAt.getTime() <= Date.now()) {
      await this.db.signupOtps.deleteOne({ _id: pending._id })
      throw new BadRequestException('That code has expired - request a new one')
    }

    // compare sha256 hashes in constant time
    const provided = Buffer.from(hashOtp(dto.otp), 'hex')
    const stored = Buffer.from(pending.codeHash, 'hex')
    const correct = provided.length === stored.length && timingSafeEqual(provided, stored)

    if (!correct) {
      const attempts = pending.attempts + 1
      if (attempts >= MAX_OTP_ATTEMPTS) {
        await this.db.signupOtps.deleteOne({ _id: pending._id })
        throw new BadRequestException('Too many incorrect attempts - request a new code')
      }
      await this.db.signupOtps.updateOne({ _id: pending._id }, { $set: { attempts } })
      throw new BadRequestException('Incorrect code')
    }

    // the code is valid - materialise the account and log the user in
    if (await this.db.users.exists({ email })) {
      await this.db.signupOtps.deleteOne({ _id: pending._id })
      throw new ConflictException('An account with this email already exists')
    }
    try {
      const user = (await this.db.users.create({
        email,
        password: pending.passwordHash,
        name: nameFromEmail(email),
        workspaceName: 'Acme knowledge base',
      })) as StoredUser
      await this.db.signupOtps.deleteOne({ _id: pending._id })
      return this.createSession(user)
    } catch (error) {
      // handle a race with another verify (code 11000)
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('An account with this email already exists')
      }
      throw error
    }
  }

  /**
   * Accepts bcrypt hashes and - for rows created before hashing was added -
   * plaintext passwords, which are upgraded to a hash on first login.
   */
  private async passwordMatches(plain: string, user: StoredUser): Promise<boolean> {
    if (user.password.startsWith(BCRYPT_PREFIX)) {
      return bcrypt.compare(plain, user.password)
    }
    if (user.password !== plain) return false
    await this.db.users.updateOne(
      { _id: user._id },
      { $set: { password: await bcrypt.hash(plain, BCRYPT_ROUNDS) } },
    )
    return true
  }

  private verifyToken(token: string): JwtPayload {
    try {
      return this.jwt.verify<JwtPayload>(token)
    } catch {
      throw new UnauthorizedException('Invalid or expired session')
    }
  }

  private createSession(user: StoredUser) {
    const token = this.jwt.sign({ sub: user._id.toString(), email: user.email })
    return { token, user: this.publicUser(user) }
  }

  private publicUser(user: StoredUser) {
    return {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      workspaceName: user.workspaceName ?? 'Acme knowledge base',
    }
  }
}