import { decryptSecret } from '../lib/crypto';

/**
 * Ping a WordPress site's cache-bust webhook (the EMG CMS Connector plugin) so it
 * purges its transient cache and re-pulls fresh data. The shared secret is stored
 * encrypted (AES-256-GCM) on the org config and decrypted just-in-time here.
 */
export async function triggerWordpressCacheBust(
  url: string,
  secretEncrypted?: string | null,
): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secretEncrypted) headers['X-EMG-Secret'] = decryptSecret(secretEncrypted);
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ source: 'emg-cms' }),
  });
  if (!res.ok) {
    throw new Error(`WordPress cache-bust failed: HTTP ${res.status}`);
  }
  return `cache-bust HTTP ${res.status}`;
}
