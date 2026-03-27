import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { json, urlencoded } from 'express';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  // Trust proxy (important when behind nginx)
  if (process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', true);
  }

  // Helmet security headers
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // CORS
  const corsOrigin = process.env.CORS_ORIGIN || '*';
  app.enableCors({
    origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((s) => s.trim()),
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'X-Session-Id'],
    credentials: true,
    maxAge: 86400,
  });

  // Body parsing with size limit
  const maxPayload = process.env.MAX_PAYLOAD_SIZE || '50mb';
  app.use(json({ limit: maxPayload }));
  app.use(urlencoded({ extended: true, limit: maxPayload }));

  // Global prefix for API routes — health is excluded via controller
  app.setGlobalPrefix('api');

  // Global filters and interceptors
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  const port = parseInt(process.env.PORT || '3900', 10);
  await app.listen(port, '0.0.0.0');
  logger.log(`Server listening on http://0.0.0.0:${port}`);
}

bootstrap();
