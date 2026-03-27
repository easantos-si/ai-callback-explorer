import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  /**
   * Health endpoint — lives outside /api prefix.
   * NestJS global prefix doesn't apply because we use
   * the full path in nginx health checks.
   */
  @Get('/health')
  health(): Record<string, unknown> {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
