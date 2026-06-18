import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../errors/AppError';

type Source = 'body' | 'query' | 'params';

/**
 * Validate one request source with a Zod schema. Parsed (and coerced) output is
 * stored on `req.validated[source]` — note `req.query` is read-only in Express 5,
 * so controllers must read the validated copy, not the raw source.
 */
export function validate(schema: z.ZodType, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const data = source === 'body' ? req.body : source === 'query' ? req.query : req.params;
    const result = schema.safeParse(data);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      next(new ValidationError('Validation failed', details));
      return;
    }
    req.validated = { ...(req.validated ?? {}), [source]: result.data };
    next();
  };
}

/** Typed accessor for validated inputs inside controllers. */
export function validated<T>(req: Request, source: Source): T {
  return (req.validated?.[source] ?? {}) as T;
}
