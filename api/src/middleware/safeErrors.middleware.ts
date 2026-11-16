import type { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger.js';

/**
 * Keeps raw database and network errors off the screen.
 *
 * Many controllers answer a failure with the error's own message. For a
 * database error that message names the database (the production one
 * included), the collection and the index, and it means nothing to the
 * person who sees it. A duplicate document number once reached a user as
 * "E11000 duplicate key error collection: sourceline-production-...". This
 * replaces such a message with plain words before it leaves; the original
 * still goes to the server log for whoever investigates.
 *
 * Messages written for people pass through untouched: only text that looks
 * like it came from the driver or the network is replaced.
 */
const RAW_ERROR_PATTERNS: RegExp[] = [
  /E11000/,
  /dup key/i,
  /\bMongo[A-Za-z]*Error\b/,
  /\bMongoose\b/,
  /buffering timed out/i,
  /Cast to [A-Za-z]+ failed/,
  /\bcollection: \S+/,
  /\bindex: \S+/,
  /\b(sourceline|fossil|fosssil)-(procure|development|staging|production)\S*/i,
  /\bECONN(REFUSED|RESET)\b|\bENOTFOUND\b|\bETIMEDOUT\b|getaddrinfo/,
  /\bat \S+ \(.*:\d+:\d+\)/
];

export function looksLikeRawError(message: string): boolean {
  return RAW_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

const DUPLICATE_MESSAGE =
  'That was saved by someone else at the same moment, or it already exists. Please try again.';
const GENERIC_MESSAGE =
  'Something went wrong on our side. Please try again, and tell your administrator if it keeps happening.';

export function keepRawErrorsOffScreen(req: Request, res: Response, next: NextFunction): void {
  const send = res.json.bind(res);

  res.json = ((body: unknown) => {
    const failed = body && typeof body === 'object' && (body as { success?: unknown }).success === false;
    const message = failed ? (body as { message?: unknown }).message : undefined;

    if (typeof message === 'string' && looksLikeRawError(message)) {
      const duplicate = /E11000|dup key/i.test(message);
      logger.warn('Raw error message withheld from the response', {
        path: `${req.method} ${req.originalUrl}`,
        status: res.statusCode,
        message
      });
      // A duplicate is a conflict, not a server fault.
      if (duplicate && res.statusCode >= 500) res.status(409);
      const { stack: _stack, ...rest } = body as Record<string, unknown>;
      return send({ ...rest, message: duplicate ? DUPLICATE_MESSAGE : GENERIC_MESSAGE });
    }

    return send(body);
  }) as Response['json'];

  next();
}
