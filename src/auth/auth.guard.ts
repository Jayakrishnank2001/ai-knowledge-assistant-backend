import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { AuthService } from './auth.service'

/**
 * A minimal authentication guard.
 *
 * Guards in NestJS are the equivalent of Angular route guards / HTTP
 * interceptors: they run BEFORE a route handler and decide whether the
 * request is allowed through (return true) or not (throw).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest()
    const header: string = request.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) {
      throw new UnauthorizedException('Missing access token')
    }
    // Attach the current user so route handlers can read request.user
    request.user = this.authService.me(token)
    return true
  }
}