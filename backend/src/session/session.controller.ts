import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SessionService } from './session.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('sessions')
@UseGuards(JwtAuthGuard)
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  create(@Body() dto: CreateSessionDto): Record<string, unknown> {
    const session = this.sessionService.createSession(dto.label);
    return {
      success: true,
      session,
    };
  }

  @Get(':id/validate')
  validate(@Param('id') id: string): Record<string, unknown> {
    const valid = this.sessionService.validateSession(id);
    if (!valid) {
      throw new NotFoundException('Session not found or expired');
    }
    this.sessionService.touchSession(id);
    return { success: true, valid: true };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string): Record<string, unknown> {
    const deleted = this.sessionService.deleteSession(id);
    if (!deleted) {
      throw new NotFoundException('Session not found');
    }
    return { success: true };
  }
}
