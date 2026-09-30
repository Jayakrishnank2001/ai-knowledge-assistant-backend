import { Body, Controller, Get, Headers, Patch, Post, UnauthorizedException, UseGuards } from '@nestjs/common'
import { AuthService } from './auth.service'
import { AuthGuard } from './auth.guard'
import { CurrentUser, AuthUserPayload } from '../common/authenticated-request'
import {
  LoginDto,
  RegisterDto,
  SignupStartDto,
  SignupVerifyDto,
  UpdateProfileDto,
} from './dto/auth.dto'

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

  /** OTP signup, step 1: email + password -> sends a 6-digit code. */
  @Post('signup/start')
  signupStart(@Body() dto: SignupStartDto) {
    return this.authService.startSignup(dto)
  }

  /** OTP signup, step 2: verify the code -> creates the user + logs in. */
  @Post('signup/verify')
  signupVerify(@Body() dto: SignupVerifyDto) {
    return this.authService.verifySignup(dto)
  }

  @UseGuards(AuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthUserPayload) {
    return user
  }

  @UseGuards(AuthGuard)
  @Patch('me')
  updateProfile(@CurrentUser() user: AuthUserPayload, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(user.id, dto)
  }

  @UseGuards(AuthGuard)
  @Post('logout')
  logout(@Headers('authorization') authorization?: string) {
    const token = authorization?.replace('Bearer ', '') ?? ''
    if (!token) throw new UnauthorizedException('Missing access token')
    return this.authService.logout(token)
  }
}