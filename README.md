# emg-cms-api

EMG Agency CMS — REST API. Multi-tenant backend that lets agency clients edit
structured data (jobs, reviews, …) consumed by their Astro and WordPress sites
via a **pull / API-first** model.

> Approved plan: `~/.claude/plans/amar-plan-file-users-hridoyahmed-claude-iridescent-hippo.md`

## Stack

- **Express 5** + TypeScript (CommonJS, NodeNext resolution)
- **Prisma 6** + PostgreSQL
- **Zod 4** for validation / env parsing
- **pino** logging, **helmet** + **cors** security
- Auth: JWT + bcrypt (+ read-only consumer API tokens) — *coming next*
- Files: Cloudflare R2 (S3-compatible) — *coming next*
- Delivery: pull API + node-cron trigger worker — *coming next*

## Tenant isolation (7-layer, core)

All tenant-scoped models (`Job`, `Review`, `Upload`, `SyncJob`, `AuditLog`) are
auto-filtered by `organizationId` through a Prisma client extension
(`src/lib/prisma.ts`) backed by `AsyncLocalStorage`. Queries must run inside a
tenant context (`withTenant(...)`); the extension injects the org filter on
reads + filtered writes and the org id on creates. `findUnique` / `upsert` are
forbidden on tenant models (use `findFirst` + create/update).

## Local setup

1. `npm install`
2. Copy env: `cp .env.example .env` and fill secrets
   (`openssl rand -hex 32` for JWT/encryption keys).
3. Start Postgres (see **Database** below) and set `DATABASE_URL`.
4. `npm run prisma:generate`
5. `npm run prisma:migrate` (creates tables)
6. `npm run db:seed` (super_admin + EIS-TX org) — *coming next*
7. `npm run dev` → http://localhost:4000/healthz

## Database (local)

Pick one:

- **Docker** (recommended, matches `docker-compose.yml`):
  `docker compose up -d postgres`
- **Homebrew Postgres**: `brew install postgresql@16 && brew services start postgresql@16`
- **Neon free** (cloud): create a project, paste its `DATABASE_URL` (no local DB).

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Watch-mode dev server (tsx) |
| `npm run build` / `start` | Compile to `dist/` / run compiled |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:migrate` | Create/apply dev migration |
| `npm run db:seed` | Seed initial data |
| `npm test` | Vitest (incl. tenant-isolation suite) |

## Structure

```
src/
  config/env.ts        Zod-validated environment
  lib/prisma.ts        Prisma client + tenant isolation extension
  lib/logger.ts        pino logger
  server.ts            Express app factory + bootstrap
prisma/schema.prisma   Data model (hybrid core columns + meta JSON)
```
