import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { HttpError } from './error.middleware.js';

export function requireAuth(req, _res, next) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return next(new HttpError(401, 'Sign in required'));
  try { req.userId = jwt.verify(h.slice(7), env.JWT_SECRET).sub; next(); }
  catch { next(new HttpError(401, 'Session expired. Sign in again.')); }
}
