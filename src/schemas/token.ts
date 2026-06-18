import { z } from 'zod';

export const CreateTokenSchema = z.object({
  name: z.string().min(1),
  // Read-only scopes by default; consumer tokens are for the pull API.
  scopes: z.array(z.string().min(1)).min(1).default(['jobs:read', 'reviews:read']),
});
export type CreateTokenInput = z.infer<typeof CreateTokenSchema>;
