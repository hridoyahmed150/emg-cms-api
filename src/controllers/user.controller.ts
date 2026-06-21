import type { Request, Response } from 'express';
import { validated } from '../middleware/validate';
import { parseId } from '../lib/http';
import * as userService from '../services/user.service';
import type { CreateUserInput, UpdateUserInput } from '../schemas/user';

export async function list(req: Request, res: Response): Promise<void> {
  res.json(await userService.listUsers(req.tenantId ?? null, Boolean(req.isSuper)));
}

export async function get(req: Request, res: Response): Promise<void> {
  res.json(await userService.getUser(parseId(req), req.tenantId ?? null, Boolean(req.isSuper)));
}

export async function create(req: Request, res: Response): Promise<void> {
  const input = validated<CreateUserInput>(req, 'body');
  res
    .status(201)
    .json(
      await userService.createUser(
        input,
        req.tenantId ?? null,
        Boolean(req.isSuper),
        req.auth?.userId ?? null,
      ),
    );
}

export async function update(req: Request, res: Response): Promise<void> {
  const input = validated<UpdateUserInput>(req, 'body');
  res.json(
    await userService.updateUser(
      parseId(req),
      input,
      req.tenantId ?? null,
      Boolean(req.isSuper),
      req.auth?.userId ?? null,
    ),
  );
}

export async function remove(req: Request, res: Response): Promise<void> {
  await userService.deleteUser(
    parseId(req),
    req.tenantId ?? null,
    Boolean(req.isSuper),
    req.auth?.userId ?? null,
  );
  res.status(204).send();
}
