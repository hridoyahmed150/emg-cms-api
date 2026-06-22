import { env } from '../config/env';

/**
 * Commit a single file to a Bitbucket repo via the REST API (one commit per call).
 *
 * Used to publish an org's data file (e.g. src/data/reviews.json) to its CloudCannon
 * repo — the commit is what triggers a CloudCannon rebuild (CloudCannon has no
 * tokenless build webhook). Auth = an API token with scopes (write:repository) via
 * Basic auth (email:token) — app passwords are being removed. One workspace-scoped
 * token covers every repo, so credentials are global CMS env, not per-org.
 *
 * POST /2.0/repositories/{workspace}/{repo}/src
 *   form-encoded: {repoPath}=<content>, message=<msg>, branch=<branch>
 */
export async function commitFile(opts: {
  repo: string;
  branch: string;
  path: string;
  content: string;
  message: string;
}): Promise<string> {
  const { repo, branch, path, content, message } = opts;
  const { BITBUCKET_WORKSPACE: workspace, BITBUCKET_EMAIL: email, BITBUCKET_API_TOKEN: apiToken } = env;
  if (!workspace || !email || !apiToken) {
    throw new Error('Bitbucket not configured (BITBUCKET_WORKSPACE/EMAIL/API_TOKEN)');
  }

  const url = `${env.BITBUCKET_API_BASE}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repo)}/src`;
  const body = new URLSearchParams();
  body.set(path, content); // field name = the file's repo path → creates/updates that file
  body.set('message', message);
  body.set('branch', branch);

  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64'); // Basic auth: Atlassian email + API token
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Bitbucket commit failed: HTTP ${res.status} ${detail.slice(0, 200)}`);
  }
  // 201 Created — the new commit URL is returned in the Location header.
  return res.headers.get('location') ?? `committed ${path}@${branch}`;
}

/**
 * Read a single file from a Bitbucket repo via the REST API. Returns the raw file
 * text, or `null` when the file/branch does not exist (404). The inverse of
 * commitFile: used by reverse-import to pull a repo's EXISTING data file
 * (e.g. src/data/reviews.json) INTO the CMS, so the CMS becomes the superset before
 * the first Publish overwrites it. Same Basic (email:token) auth — the API token's
 * read:repository scope covers this (write does NOT imply read).
 *
 * GET /2.0/repositories/{workspace}/{repo}/src/{branch}/{path}
 */
export async function readFile(opts: {
  repo: string;
  branch: string;
  path: string;
}): Promise<string | null> {
  const { repo, branch, path } = opts;
  const { BITBUCKET_WORKSPACE: workspace, BITBUCKET_EMAIL: email, BITBUCKET_API_TOKEN: apiToken } = env;
  if (!workspace || !email || !apiToken) {
    throw new Error('Bitbucket not configured (BITBUCKET_WORKSPACE/EMAIL/API_TOKEN)');
  }

  // {path} may contain slashes — encode each segment but keep the separators.
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const url = `${env.BITBUCKET_API_BASE}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repo)}/src/${encodeURIComponent(branch)}/${encodedPath}`;

  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });

  if (res.status === 404) return null; // file or branch absent — caller treats as "nothing to import"
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Bitbucket read failed: HTTP ${res.status} ${detail.slice(0, 200)}`);
  }
  return res.text();
}
