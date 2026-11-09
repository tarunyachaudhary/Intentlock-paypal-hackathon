import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
export const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

export function errorHandler(err, _req, res, _next) {
  if (err instanceof ZodError) return res.status(400).json({ error: 'Invalid request', details: err.flatten().fieldErrors });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.status ? 'Server error' : err.message, ...(err.extra || {}) });
}
