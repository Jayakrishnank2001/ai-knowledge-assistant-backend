import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { Request } from 'express'

export interface AuthUserPayload {
  id: string
  email: string
  name: string
  workspaceName?: string
}

export interface AuthenticatedRequest extends Request {
  user: AuthUserPayload
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUserPayload => {
    return ctx.switchToHttp().getRequest<AuthenticatedRequest>().user
  },
)

