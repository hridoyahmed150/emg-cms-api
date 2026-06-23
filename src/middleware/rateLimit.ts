import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

/** Brute-force protection for the login endpoint: 5 attempts / 15 min / IP. */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // The limiter is in-memory and shared across a test file's requests; bypass it under test so
  // suites that perform many logins aren't throttled (no test asserts the 429 path).
  skip: () => env.NODE_ENV === 'test',
  message: {
    error: { code: 'rate_limited', message: 'Too many login attempts. Try again later.' },
  },
});

/** Per-token rate limit for consumer (pull) API tokens: 60 req / min. */
export const consumerApiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: { code: 'rate_limited', message: 'Rate limit exceeded.' },
  },
});
