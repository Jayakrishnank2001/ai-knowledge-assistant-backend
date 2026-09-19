import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common'
import { Request } from 'express'
import { AuthService } from './auth.service'
import { AuthGuard } from './auth.guard'
import { LoginDto, RegisterDto } from './dto/auth.dto'

interface AuthenticatedRequest extends Request {
  user: { id: string; email: string; name: string }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto)
  }

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto)
  }

  @UseGuards(AuthGuard)
  @Get('me')
  me(@Req() request: AuthenticatedRequest) {
    // request.user was populated by AuthGuard
    return request.user
  }

  @UseGuards(AuthGuard)
  @Post('logout')
  logout(@Req() request: AuthenticatedRequest) {
    const token = request.headers.authorization?.replace('Bearer ', '') ?? ''
    return this.authService.logout(token)
  }
}