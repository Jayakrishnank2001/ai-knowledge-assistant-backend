import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { randomUUID } from 'crypto'
import { DatabaseService, UserEntity } from '../database/database.service'
import { LoginDto, RegisterDto } from './dto/auth.dto'

@Injectable()
export class AuthService {
  /** token -> userId. Swapped for JWT / Redis sessions in a real app. */
  private readonly sessions = new Map<string, string>()

  constructor(private readonly db: DatabaseService) {}

  login(dto: LoginDto) {
    const user = this.db.users.find((u) => u.email === dto.email.toLowerCase())
    if (!user || user.password !== dto.password) {
      throw new UnauthorizedException('Invalid email or password')
    }
    return this.createSession(user)
  }

  register(dto: RegisterDto) {
    const email = dto.email.toLowerCase()
    if (this.db.users.some((u) => u.email === email)) {
      throw new ConflictException('An account with this email already exists')
    }
    const user: UserEntity = {
      id: this.db.nextId('user'),
      email,
      password: dto.password,
      name: dto.name,
    }
    this.db.users.push(user)
    return this.createSession(user)
  }

  /** Verify a bearer token and return the logged-in user (throws if invalid). */
  me(token: string) {
    const user = this.findByToken(token)
    return { id: user.id, email: user.email, name: user.name }
  }

  logout(token: string) {
    this.sessions.delete(token)
    return { success: true }
  }

  private findByToken(token: string): UserEntity {
    const userId = this.sessions.get(token)
    const user = this.db.users.find((u) => u.id === userId)
    if (!user) {
      throw new UnauthorizedException('Invalid or expired session')
    }
    return user
  }

  private createSession(user: UserEntity) {
    const token = `token_${randomUUID()}`
    this.sessions.set(token, user.id)
    return {
      token,
      user: { id: user.id, email: user.email, name: user.name },
    }
  }
}