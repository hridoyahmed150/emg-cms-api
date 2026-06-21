import { z } from 'zod';

/**
 * Shared password-strength policy (used for user creation and any password change).
 * Min 10 chars, at least two distinct character classes, and not a single repeated
 * character. Intentionally pragmatic rather than draconian — tune in one place.
 */
export const PasswordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .refine((p) => new Set(p).size >= 2, 'Password is too weak (avoid a single repeated character)')
  .refine(
    (p) => {
      let classes = 0;
      if (/[a-z]/.test(p)) classes++;
      if (/[A-Z]/.test(p)) classes++;
      if (/\d/.test(p)) classes++;
      if (/[^A-Za-z0-9]/.test(p)) classes++;
      return classes >= 2;
    },
    'Password must include at least two of: lowercase, uppercase, number, symbol',
  );
