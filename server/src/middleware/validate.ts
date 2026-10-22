import type { RequestHandler } from 'express';
import mongoose from 'mongoose';
import type { ZodType } from 'zod';
import { notFound } from '../utils/errors.js';

// Express 5 makes req.query read-only, so the parsed query is placed on res.locals.query instead.
export const validateQuery =
  (schema: ZodType): RequestHandler =>
  (req, res, next) => {
    res.locals.query = schema.parse(req.query);
    next();
  };

// A malformed id can never match anything, so answer exactly like a missing resource.
export const validateObjectIdParam =
  (name = 'id'): RequestHandler =>
  (req, _res, next) => {
    if (!mongoose.isValidObjectId(req.params[name])) throw notFound();
    next();
  };

// Validates req.body against a zod schema; replaces it with the parsed (stripped) value
// so only explicitly allowed fields reach controllers (prevents over-posting).
export const validateBody =
  (schema: ZodType): RequestHandler =>
  (req, _res, next) => {
    req.body = schema.parse(req.body);
    next();
  };
