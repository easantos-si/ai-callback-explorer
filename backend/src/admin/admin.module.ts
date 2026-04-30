import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AllowedOriginsService } from './allowed-origins.service';
import { OriginFilteringEnabledGuard } from './origin-filtering.guard';

@Module({
  controllers: [AdminController],
  providers: [AllowedOriginsService, OriginFilteringEnabledGuard],
  exports: [AllowedOriginsService],
})
export class AdminModule {}
