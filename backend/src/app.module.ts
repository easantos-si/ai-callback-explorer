import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { CallbackModule } from './callback/callback.module';
import { SessionModule } from './session/session.module';
import { SecurityHeadersMiddleware } from './common/middleware/security-headers.middleware';

@Module({
  imports: [CallbackModule, SessionModule],
  controllers: [],
  providers: [],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SecurityHeadersMiddleware).forRoutes('*');
  }
}
