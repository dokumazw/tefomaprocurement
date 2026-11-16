import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

/**
 * How a session token is recorded when it is ended: a SHA-256 of the token,
 * never the token itself, so the stored list cannot be replayed.
 */
export function sessionTokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** The bearer token on a request, or null. */
export function bearerToken(authorization: string | undefined): string | null {
  if (!authorization || !authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  return token || null;
}

/** When the token stops working by itself; the JWT's `exp`, or 30 days if it has none. */
export function sessionTokenExpiry(token: string): Date {
  const decoded = jwt.decode(token) as { exp?: number } | null;
  return decoded?.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 30 * 24 * 3_600_000);
}
