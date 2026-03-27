import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { SessionService } from './session.service';

@Controller('sessions')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() body: Record<string, unknown>): Record<string, unknown> {
    const label = body?.label;

    if (label !== undefined && label !== null) {
      if (typeof label !== 'string' || label.length > 200) {
        throw new BadRequestException(
          'Label must be a string with max 200 characters',
        );
      }
    }

    const session = this.sessionService.createSession(
      typeof label === 'string' ? label : undefined,
    );

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
