import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { randomUUID } from 'crypto'
import { DatabaseService } from '../database/database.service'
import { LoginDto, RegisterDto, UpdateProfileDto } from './dto/auth.dto'

/** Minimal slice of a hydrated mongoose document the session logic needs. */
interface StoredUser {
  _id: { toString(): string }
  email: string
  password: string
  name: string
  workspaceName?: string
}

@Injectable()
export class AuthService {
  /** token -> userId. Swapped for JWT / Redis sessions in a real app. */
  private readonly sessions = new Map<string, string>()

  constructor(private readonly db: DatabaseService) {}

  async login(dto: LoginDto) {
    const user = (await this.db.users.findOne({ email: dto.email.toLowerCase() })) as StoredUser | null
    if (!user || user.password !== dto.password) {
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
        password: dto.password,
        name: dto.name,
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

  /** Verify a bearer token and return the logged-in user (throws if invalid). */
  async me(token: string) {
    const user = await this.findByToken(token)
    return this.publicUser(user)
  }

  async logout(token: string) {
    this.sessions.delete(token)
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

  private async findByToken(token: string): Promise<StoredUser> {
    const userId = this.sessions.get(token)
    if (!userId) {
      throw new UnauthorizedException('Invalid or expired session')
    }
    const user = (await this.db.users.findById(userId)) as StoredUser | null
    if (!user) {
      throw new UnauthorizedException('Invalid or expired session')
    }
    return user
  }

  private createSession(user: StoredUser) {
    const token = `token_${randomUUID()}`
    this.sessions.set(token, user._id.toString())
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