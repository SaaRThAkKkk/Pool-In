import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { logger } from './utils/logger.js';
import { createApiRouter } from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import type { Env } from './config/env.js';
import type { SmsProvider } from './services/sms/index.js';

export type AppConfig = Pick<Env, 'CLIENT_ORIGIN' | 'JWT_SECRET' | 'JWT_EXPIRES_DAYS' | 'NODE_ENV'>;

export interface AppOptions {
  sms: SmsProvider;
  rateLimitEnabled?: boolean;
}

export function createApp(env: AppConfig, opts: AppOptions): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: env.CLIENT_ORIGIN.split(',').map((o) => o.trim()),
      credentials: true,
    }),
  );
  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use(
    '/api',
    createApiRouter({
      token: { JWT_SECRET: env.JWT_SECRET, JWT_EXPIRES_DAYS: env.JWT_EXPIRES_DAYS, NODE_ENV: env.NODE_ENV },
      rateLimitEnabled: opts.rateLimitEnabled ?? env.NODE_ENV !== 'test',
      sms: opts.sms,
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
