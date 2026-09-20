import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import bcrypt from 'bcryptjs'
import { DatabaseService } from '../database/database.service'
import { LoginDto, RegisterDto, UpdateProfileDto } from './dto/auth.dto'

const BCRYPT_ROUNDS = 10
/** bcrypt hashes always start with $2a/$2b/$2y - anything else is a legacy plaintext row. */
const BCRYPT_PREFIX = '$2'
const DEFAULT_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

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

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
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