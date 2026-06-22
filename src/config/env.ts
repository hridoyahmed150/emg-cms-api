import 'dotenv/config';
import { z } from 'zod';

/**
 * Single source of truth for environment configuration.
 * Validated once at process start — invalid config fails fast (no silent undefineds).
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  // Comma-separated list of allowed origins.
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  // Refresh-cookie SameSite. Use 'none' when the admin web is on a DIFFERENT registrable
  // domain than the API (e.g. *.vercel.app ↔ api.example.com) — 'none' forces Secure.
  // Keep 'lax' when web + API share a registrable domain (cms.x / api.x).
  COOKIE_SAMESITE: z.enum(['lax', 'none', 'strict']).default('lax'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  // 32-byte key as 64 hex chars; required only when encrypting per-org secrets.
  ENCRYPTION_KEY: z.string().optional(),

  // Cloudflare R2 (needed for uploads).
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_BASE: z.string().optional(),
  R2_ENDPOINT: z.string().optional(),

  // Google reviews ingestion (optional — only needed to auto-refresh from Google).
  GOOGLE_MAPS_API_KEY: z.string().optional(), // Places API (New)
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(), // GBP (Business Profile) API
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),

  // Bitbucket (git-commit delivery for CloudCannon Astro sites — commit data files on Publish).
  // Auth = API token with scopes (write:repository) via Basic auth (email:token); app passwords
  // are being removed. One workspace-scoped token covers every repo in the workspace.
  BITBUCKET_WORKSPACE: z.string().optional(),
  BITBUCKET_EMAIL: z.string().optional(),
  BITBUCKET_API_TOKEN: z.string().optional(),
  BITBUCKET_API_BASE: z.string().default('https://api.bitbucket.org/2.0'),

  SENTRY_DSN: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment variables:');
  for (const issue of parsed.error.issues) {
    // eslint-disable-next-line no-console
    console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  /** Parsed list form of CORS_ORIGIN. */
  CORS_ORIGINS: raw.CORS_ORIGIN.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
} as const;

export type Env = typeof env;
