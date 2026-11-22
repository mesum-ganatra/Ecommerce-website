import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

/** An error the client is allowed to see. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Not signed in') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have permission to do this') => new AppError(403, 'forbidden', message);
export const notFound = (message = 'Not found') => new AppError(404, 'not_found', message);
export const conflict = (message: string) => new AppError(409, 'conflict', message);

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_error',
        message: 'Some fields are not valid',
        details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }
  // multer: file too large
  if (typeof err === 'object' && err && (err as { code?: string }).code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: { code: 'file_too_large', message: 'That file is too large' } });
    return;
  }
  // Mongo duplicate key (unique index)
  if (typeof err === 'object' && err && (err as { code?: number }).code === 11000) {
    const fields = Object.keys((err as { keyPattern?: object }).keyPattern ?? {}).filter((f) => f !== 'storeId');
    const nice = fields.map((f) => (f === 'variants.sku' ? 'SKU' : f));
    res.status(409).json({ error: { code: 'duplicate', message: `Already in use: ${nice.join(', ') || 'value'}` } });
    return;
  }
  if (typeof err === 'object' && err && (err as { name?: string }).name === 'ValidationError') {
    res.status(400).json({ error: { code: 'validation_error', message: (err as Error).message } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong' } });
};
