import { Module, Logger } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CaptchaService } from './captcha.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      // registerAsync resolves the secret at module init, AFTER process.env
      // is fully populated (covers the env_file path used in production).
      // Hard-fail when AUTH_ENABLED=true but JWT_SECRET is missing so a
      // misconfigured boot cannot fall back to a static placeholder.
      // When AUTH_ENABLED=false the JWT machinery is never exercised
      // (every endpoint short-circuits), so we use an opaque placeholder
      // that has no operational meaning.
      useFactory: () => {
        const secret = (process.env.JWT_SECRET ?? '').trim();
        const authEnabled =
          (process.env.AUTH_ENABLED ?? '').toLowerCase() === 'true';

        if (authEnabled && !secret) {
          new Logger('AuthModule').error(
            'AUTH_ENABLED=true but JWT_SECRET is empty. Refusing to start.',
          );
          throw new Error('JWT_SECRET required when AUTH_ENABLED=true');
        }

        return {
          secret: secret || '__auth_disabled_placeholder__',
          signOptions: { algorithm: 'HS256' },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, CaptchaService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
