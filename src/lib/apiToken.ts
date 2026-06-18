import crypto from 'node:crypto';

/** SHA-256 hex hash of a plaintext token (only the hash is stored). */
export function hashToken(plaintext: string): string {
  return crypto.createHash('sha256').update(plaintext).digest('hex');
}

/** Generate a consumer (read-only) API token. Plaintext is shown to the user once. */
export function generateConsumerToken(): { plaintext: string; hash: string } {
  const plaintext = `cms_${crypto.randomBytes(32).toString('base64url')}`;
  return { plaintext, hash: hashToken(plaintext) };
}
