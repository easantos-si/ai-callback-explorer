import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AllowedOriginsService } from './admin/allowed-origins.service';
import { isFilteringEnabled } from './admin/allowed-origins.state';
import helmet from 'helmet';
import { json, urlencoded, text, raw } from 'express';

function parseTrustProxy(): boolean | string | string[] {
  const v = (process.env.TRUST_PROXY ?? '').trim();
  if (!v) return false;
  if (v === 'false') return false;
  if (v === 'true') {
    // Refuse the unsafe bare-true; require explicit CIDRs in production.
    new Logger('Bootstrap').warn(
      'TRUST_PROXY=true is unsafe — falling back to loopback only. Set explicit CIDRs (Cloudflare ranges or docker bridge).',
    );
    return ['127.0.0.1', '::1'];
  }
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}


async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.set('trust proxy', parseTrustProxy());

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:'],
          'font-src': ["'self'", 'data:'],
          'connect-src': ["'self'", 'wss:', 'https:'],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'none'"],
          'form-action': ["'none'"],
          'object-src': ["'none'"],
          'upgrade-insecure-requests': [],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      strictTransportSecurity: {
        maxAge: 63_072_000,
        includeSubDomains: true,
        preload: true,
      },
      referrerPolicy: { policy: 'no-referrer' },
      xFrameOptions: { action: 'deny' },
    }),
  );

  const allowedOrigins = app.get(AllowedOriginsService);
  app.enableCors({
    origin: (origin, cb) => {
      // No Origin header → server-to-server callbacks (cloudflared, curl,
      // outras integrações). Permitido para o endpoint de callback público.
      if (!origin) return cb(null, true);
      // isAllowed() short-circuits to true when ORIGIN_FILTERING_ENABLED
      // is off, so this single call covers both modes.
      cb(null, allowedOrigins.isAllowed(origin));
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Accept',
      'X-Session-Id',
      'X-Admin-Token',
      'Authorization',
    ],
    credentials: false,
    maxAge: 86_400,
  });

  // Body parsers — limit applies *after* gzip/deflate inflation.
  const maxPayload = process.env.MAX_PAYLOAD_SIZE || '50mb';
  app.use(json({ limit: maxPayload, inflate: true }));
  app.use(urlencoded({ extended: true, limit: maxPayload }));
  app.use(text({ limit: maxPayload, type: ['text/*'] }));
  app.use(
    raw({
      limit: maxPayload,
      type: ['application/octet-stream'],
    }),
  );

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      disableErrorMessages: process.env.NODE_ENV === 'production',
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  app.enableShutdownHooks();

  const server = app.getHttpServer();
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 10_000;
  server.maxHeadersCount = 100;

  const port = parseInt(process.env.PORT || '3900', 10);
  // Backend stays inside the docker network. Public ingress is the
  // frontend nginx (or cloudflared upstream) — not this listener.
  const host = process.env.LISTEN_HOST || '0.0.0.0';
  await app.listen(port, host);
  logger.log(`Server listening on http://${host}:${port}`);
  if (isFilteringEnabled()) {
    if (allowedOrigins.list().length === 0) {
      logger.warn(
        'ORIGIN_FILTERING_ENABLED=true but UI_ORIGIN is empty — browser CORS requests will be rejected. Set UI_ORIGIN=https://your-host before going public.',
      );
    }
    if (!process.env.ADMIN_TOKEN) {
      logger.warn(
        'ADMIN_TOKEN is empty — Super Mode rejects every request even though origin filtering is enabled.',
      );
    }
  } else {
    logger.warn(
      'ORIGIN_FILTERING_ENABLED=false — every browser origin is accepted. Super Mode is disabled. Flip the flag in .env to enforce an allow list.',
    );
  }
}

bootstrap();
