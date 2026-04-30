import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CaptchaService } from './captcha.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    JwtModule.register({
      // Empty secret means signatures effectively use a deterministic
      // empty key — AuthService logs an error at boot in that case so the
      // operator notices. We don't throw here so a misconfigured deploy
      // can still serve /api/auth/config and tell the SPA that auth is
      // disabled (when AUTH_ENABLED=false).
      secret: process.env.JWT_SECRET || '__unset__',
      signOptions: { algorithm: 'HS256' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, CaptchaService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
