import { Module } from '@nestjs/common';
import { CallbackController } from './callback.controller';
import { CallbackService } from './callback.service';
import { CallbackGateway } from './callback.gateway';
import { SessionModule } from '../session/session.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [SessionModule, AuthModule],
  controllers: [CallbackController],
  providers: [CallbackService, CallbackGateway],
})
export class CallbackModule {}
