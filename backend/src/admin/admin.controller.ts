import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminTokenGuard } from './admin-token.guard';
import { OriginFilteringEnabledGuard } from './origin-filtering.guard';
import { AllowedOriginsService } from './allowed-origins.service';
import type { AllowedOrigin } from './allowed-origins.state';
import { AddOriginDto } from './dto/add-origin.dto';
import { RemoveOriginDto } from './dto/remove-origin.dto';

// Order matters: the filtering-disabled check runs first so callers get a
// clear 403 instead of a token-check failure when the feature is off.
@Controller('admin')
@UseGuards(OriginFilteringEnabledGuard, AdminTokenGuard)
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class AdminController {
  constructor(private readonly origins: AllowedOriginsService) {}

  @Get('origins')
  list(): { origins: AllowedOrigin[] } {
    return { origins: this.origins.listDetailed() };
  }

  @Post('origins')
  @HttpCode(HttpStatus.OK)
  add(
    @Body() dto: AddOriginDto,
  ): { success: boolean; origins: AllowedOrigin[] } {
    const origin = dto.origin.replace(/\/$/, '');
    this.origins.add(origin);
    return { success: true, origins: this.origins.listDetailed() };
  }

  @Delete('origins')
  @HttpCode(HttpStatus.OK)
  remove(
    @Body() dto: RemoveOriginDto,
  ): { success: boolean; origins: AllowedOrigin[] } {
    const origin = dto.origin.replace(/\/$/, '');
    const result = this.origins.remove(origin);
    if (result === 'protected') {
      throw new ForbiddenException(
        'Origin is configured via UI_ORIGIN and cannot be removed at runtime',
      );
    }
    if (result === 'not_found') {
      throw new NotFoundException('Origin not found');
    }
    return { success: true, origins: this.origins.listDetailed() };
  }
}
