import rateLimit from 'express-rate-limit';

/** Brute-force protection for the login endpoint: 5 attempts / 15 min / IP. */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
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
