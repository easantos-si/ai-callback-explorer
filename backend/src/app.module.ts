import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { CallbackModule } from './callback/callback.module';
import { SessionModule } from './session/session.module';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { SecurityHeadersMiddleware } from './common/middleware/security-headers.middleware';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1_000, limit: 20 },
      { name: 'long', ttl: 60_000, limit: 200 },
    ]),
    AuthModule,
    CallbackModule,
    SessionModule,
    AdminModule,
  ],
  controllers: [],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SecurityHeadersMiddleware).forRoutes('*');
  }
}
