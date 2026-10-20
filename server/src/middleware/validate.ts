import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

// Validates req.body against a zod schema; replaces it with the parsed (stripped) value
// so only explicitly allowed fields reach controllers (prevents over-posting).
export const validateBody =
  (schema: ZodType): RequestHandler =>
  (req, _res, next) => {
    req.body = schema.parse(req.body);
    next();
  };
