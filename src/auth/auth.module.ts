import { Module } from '@nestjs/common'
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { AuthGuard } from './auth.guard'
import { MailService } from './mail.service'

// secret/sign options come from .env (loaded in main.ts before bootstrap)
const signOptions: JwtModuleOptions['signOptions'] = {
  // env values are plain strings, while the `ms` types expect a literal like '7d'
  expiresIn: (process.env.JWT_EXPIRES_IN ?? '7d') as NonNullable<
    JwtModuleOptions['signOptions']
  >['expiresIn'],
}

@Module({
  imports: [JwtModule.register({ secret: process.env.JWT_SECRET, signOptions })],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, MailService],
  // exported so guard-protected modules can resolve AuthGuard + its dependency
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}