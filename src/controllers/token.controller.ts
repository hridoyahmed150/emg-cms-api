import type { Request, Response } from 'express';
import { validated } from '../middleware/validate';
import { parseId, requireTenant } from '../lib/http';
import * as tokenService from '../services/token.service';
import type { CreateTokenInput } from '../schemas/token';

export async function create(req: Request, res: Response): Promise<void> {
  const orgId = requireTenant(req);
  const input = validated<CreateTokenInput>(req, 'body');
  res.status(201).json(await tokenService.createConsumerToken(orgId, input));
}

export async function list(req: Request, res: Response): Promise<void> {
  res.json(await tokenService.listTokens(req.tenantId ?? null, Boolean(req.isSuper)));
}

export async function revoke(req: Request, res: Response): Promise<void> {
  await tokenService.revokeToken(req.tenantId ?? null, Boolean(req.isSuper), parseId(req));
  res.status(204).send();
}
