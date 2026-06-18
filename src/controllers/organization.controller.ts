import type { Request, Response } from 'express';
import { validated } from '../middleware/validate';
import { parseId } from '../lib/http';
import * as orgService from '../services/organization.service';
import type { CreateOrganizationInput, UpdateOrganizationInput } from '../schemas/organization';

export async function list(_req: Request, res: Response): Promise<void> {
  res.json(await orgService.listOrganizations());
}

export async function get(req: Request, res: Response): Promise<void> {
  res.json(await orgService.getOrganization(parseId(req)));
}

export async function create(req: Request, res: Response): Promise<void> {
  const input = validated<CreateOrganizationInput>(req, 'body');
  res.status(201).json(await orgService.createOrganization(input));
}

export async function update(req: Request, res: Response): Promise<void> {
  const input = validated<UpdateOrganizationInput>(req, 'body');
  res.json(await orgService.updateOrganization(parseId(req), input));
}

export async function remove(req: Request, res: Response): Promise<void> {
  await orgService.deleteOrganization(parseId(req));
  res.status(204).send();
}
