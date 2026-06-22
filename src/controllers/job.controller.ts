import type { Request, Response } from 'express';
import { validated } from '../middleware/validate';
import * as jobService from '../services/job.service';
import { BadRequestError } from '../errors/AppError';
import type { CreateJobInput, UpdateJobInput, ListJobsQuery } from '../schemas/job';

function requireTenant(req: Request): number {
  if (req.tenantId == null) {
    throw new BadRequestError('Organization context required (super admin: pass ?orgId).');
  }
  return req.tenantId;
}

function parseId(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new BadRequestError('Invalid id');
  return id;
}

export async function list(req: Request, res: Response): Promise<void> {
  const query = validated<ListJobsQuery>(req, 'query');
  res.json(await jobService.listJobs(query));
}

export async function get(req: Request, res: Response): Promise<void> {
  res.json(await jobService.getJob(parseId(req)));
}

export async function create(req: Request, res: Response): Promise<void> {
  const orgId = requireTenant(req);
  const input = validated<CreateJobInput>(req, 'body');
  res.status(201).json(await jobService.createJob(orgId, input));
}

export async function update(req: Request, res: Response): Promise<void> {
  const orgId = requireTenant(req);
  const input = validated<UpdateJobInput>(req, 'body');
  res.json(await jobService.updateJob(orgId, parseId(req), input));
}

export async function remove(req: Request, res: Response): Promise<void> {
  const orgId = requireTenant(req);
  await jobService.deleteJob(orgId, parseId(req));
  res.status(204).send();
}

/** Reverse-import the org's existing jobs.json from its Bitbucket repo (onboarding seed). */
export async function importFromRepo(req: Request, res: Response): Promise<void> {
  const orgId = requireTenant(req);
  res.json(await jobService.importJobsFromRepo(orgId));
}
