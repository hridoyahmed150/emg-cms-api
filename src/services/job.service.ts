import { Prisma, prisma } from '../lib/prisma';
import { NotFoundError, BadRequestError } from '../errors/AppError';
import { validateResourceMeta } from './meta.helper';
import { markContentChanged } from './delivery.service';
import { readFile } from '../delivery/bitbucket.client';
import type { CreateJobInput, UpdateJobInput, ListJobsQuery } from '../schemas/job';

export async function listJobs(query: ListJobsQuery) {
  const where: Prisma.JobWhereInput = {};
  if (query.status) where.status = query.status;
  if (query.type) where.type = query.type;
  if (query.q) where.title = { contains: query.q, mode: 'insensitive' };

  const [items, total] = await Promise.all([
    prisma.job.findMany({
      where,
      orderBy: { posted: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.job.count({ where }),
  ]);
  return { items, total, page: query.page, limit: query.limit };
}

export async function getJob(id: number) {
  const job = await prisma.job.findFirst({ where: { id } });
  if (!job) throw new NotFoundError('Job not found');
  return job;
}

export async function createJob(orgId: number, input: CreateJobInput) {
  const meta = await validateResourceMeta(orgId, 'jobs', input.meta);
  const job = await prisma.job.create({
    data: {
      organizationId: orgId, // also enforced by the tenant extension
      slug: input.slug,
      title: input.title,
      type: input.type,
      location: input.location,
      posted: input.posted,
      status: input.status,
      meta,
    },
  });
  await markContentChanged(orgId);
  return job;
}

export async function updateJob(orgId: number, id: number, input: UpdateJobInput) {
  const data: Prisma.JobUpdateManyMutationInput = {};
  if (input.slug !== undefined) data.slug = input.slug;
  if (input.title !== undefined) data.title = input.title;
  if (input.type !== undefined) data.type = input.type;
  if (input.location !== undefined) data.location = input.location;
  if (input.posted !== undefined) data.posted = input.posted;
  if (input.status !== undefined) data.status = input.status;
  if (input.meta !== undefined) data.meta = await validateResourceMeta(orgId, 'jobs', input.meta);

  const res = await prisma.job.updateMany({ where: { id }, data });
  if (res.count === 0) throw new NotFoundError('Job not found');
  await markContentChanged(orgId);
  return getJob(id);
}

export async function deleteJob(orgId: number, id: number) {
  const res = await prisma.job.deleteMany({ where: { id } });
  if (res.count === 0) throw new NotFoundError('Job not found');
  await markContentChanged(orgId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Reverse-import: seed jobs from the org's repo jobs.json (onboarding) — dedupe by slug.
// Mirrors review.service's reverse-import; jobs key on slug (no content-hash needed).
// ─────────────────────────────────────────────────────────────────────────────

/** Hard cap on a single reverse-import (the repo file bypasses the HTTP schema). */
const MAX_REPO_IMPORT = 500;
const JOB_STATUSES = ['active', 'expired', 'draft'] as const;

interface ImportJobItem {
  slug: string;
  title: string;
  type: string;
  location: string;
  posted?: string | number;
  status: string;
}

const asString = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** kebab-case slug from an arbitrary string (matches CreateJobSchema's slug rule). */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toPostedDate(p?: string | number): Date {
  if (p == null || p === '') return new Date();
  // Numbers below ~1e11 are unix seconds → ms; otherwise a ms epoch or parseable date string.
  const d = typeof p === 'number' ? new Date(p < 1e11 ? p * 1000 : p) : new Date(p);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Defensive parser for a repo's jobs.json → import items. Accepts a bare array or a
 * `{ jobs: [...] }` wrapper, and tolerates alternate field names. `slug` is derived from
 * slug → id → slugified title (EIS-TX uses `id`, not `slug`). Entries without a title are
 * dropped (so a reviews.json accidentally pointed here yields 0 jobs); type defaults to
 * full-time, status to active. Exported for unit testing.
 */
export function parseJobsFile(parsed: unknown): ImportJobItem[] {
  const arr: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).jobs)
      ? ((parsed as Record<string, unknown>).jobs as unknown[])
      : [];

  const items: ImportJobItem[] = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    // Deliberately NOT falling back to `r.name`: a review row has `name` (not `title`), so a
    // reviews.json mistakenly pointed at jobsPath yields 0 jobs instead of bogus name-titled jobs.
    const title = asString(r.title ?? r.position ?? r.role ?? r.jobTitle);
    if (!title) continue;
    const slug = slugify(asString(r.slug ?? r.id) || title);
    if (!slug) continue;
    const type = asString(r.type ?? r.employmentType) || 'full-time';
    const location = asString(r.location ?? r.place);
    const postedRaw = r.posted ?? r.date ?? r.datePosted;
    const posted = typeof postedRaw === 'string' || typeof postedRaw === 'number' ? postedRaw : undefined;
    const statusRaw = asString(r.status);
    const status = (JOB_STATUSES as readonly string[]).includes(statusRaw) ? statusRaw : 'active';
    items.push({ slug, title, type, location, posted, status });
  }
  return items;
}

/** Bulk insert jobs, deduped by (organizationId, slug) via createMany({ skipDuplicates }). */
export async function importJobs(orgId: number, items: ImportJobItem[]) {
  const rows = items.map((it) => ({
    organizationId: orgId,
    slug: it.slug,
    title: it.title,
    type: it.type,
    location: it.location,
    posted: toPostedDate(it.posted),
    status: it.status,
    // meta omitted → DB default "{}"
  }));
  const result = rows.length
    ? await prisma.job.createMany({ data: rows, skipDuplicates: true })
    : { count: 0 };
  if (result.count > 0) await markContentChanged(orgId);
  return { received: rows.length, inserted: result.count, skipped: rows.length - result.count };
}

/** Read `Organization.config.git` (Organization is NOT tenant-scoped). */
async function getGitConfig(
  orgId: number,
): Promise<{ repo?: string; branch?: string; jobsPath?: string } | null> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { config: true } });
  const git = org?.config && typeof org.config === 'object' ? (org.config as Record<string, unknown>).git : undefined;
  return git && typeof git === 'object' ? (git as { repo?: string; branch?: string; jobsPath?: string }) : null;
}

/**
 * Reverse-import: pull the org's EXISTING jobs.json from its Bitbucket repo INTO the CMS,
 * deduped by slug. Run during onboarding BEFORE the first Publish (Publish overwrites
 * jobs.json). Idempotent — slugs already in the CMS are skipped. Returns the insert summary,
 * or a `note` when there's no file / nothing to import.
 */
export async function importJobsFromRepo(
  orgId: number,
): Promise<{ received: number; inserted: number; skipped: number; note?: string }> {
  const git = await getGitConfig(orgId);
  if (!git?.repo || !git?.jobsPath) {
    throw new BadRequestError(
      'No jobs file configured. Set the Bitbucket repo + Jobs file path (config.git.repo/jobsPath) in org settings first.',
    );
  }
  if (git.jobsPath.includes('..') || git.jobsPath.startsWith('/')) {
    throw new BadRequestError('Invalid git path (must be a repo-relative path without "..").');
  }
  const raw = await readFile({ repo: git.repo, branch: git.branch || 'main', path: git.jobsPath });
  if (raw == null) {
    return { received: 0, inserted: 0, skipped: 0, note: `No ${git.jobsPath} in ${git.repo} — nothing to import.` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestError(`${git.jobsPath} in the repo is not valid JSON.`);
  }
  const items = parseJobsFile(parsed);
  if (items.length === 0) {
    return { received: 0, inserted: 0, skipped: 0, note: `No jobs found in ${git.jobsPath}.` };
  }
  if (items.length > MAX_REPO_IMPORT) {
    throw new BadRequestError(
      `${git.jobsPath} has ${items.length} jobs (max ${MAX_REPO_IMPORT} per import). Trim the file or import in batches.`,
    );
  }
  return importJobs(orgId, items);
}
