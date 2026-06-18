/** Trigger a CloudCannon rebuild for an Astro client by calling its build hook. */
export async function triggerAstroBuild(buildHookUrl: string): Promise<string> {
  const res = await fetch(buildHookUrl, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`CloudCannon build hook failed: HTTP ${res.status}`);
  }
  return `build hook HTTP ${res.status}`;
}
