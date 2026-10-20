import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';

export const logger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : (process.env.LOG_LEVEL ?? 'info'),
  // Never log credentials or tokens.
  redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', 'password', '*.password'],
  ...(isDev ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
});
