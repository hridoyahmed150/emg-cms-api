import { env } from '../config/env';

/**
 * Commit a single file to a Bitbucket repo via the REST API (one commit per call).
 *
 * Used to publish an org's data file (e.g. src/data/reviews.json) to its CloudCannon
 * repo — the commit is what triggers a CloudCannon rebuild (CloudCannon has no
 * tokenless build webhook). One workspace-level app password covers every repo in
 * the workspace, so credentials are global CMS env, not per-org.
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
  const { BITBUCKET_WORKSPACE: workspace, BITBUCKET_USERNAME: user, BITBUCKET_APP_PASSWORD: pass } = env;
  if (!workspace || !user || !pass) {
    throw new Error('Bitbucket not configured (BITBUCKET_WORKSPACE/USERNAME/APP_PASSWORD)');
  }

  const url = `${env.BITBUCKET_API_BASE}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repo)}/src`;
  const body = new URLSearchParams();
  body.set(path, content); // field name = the file's repo path → creates/updates that file
  body.set('message', message);
  body.set('branch', branch);

  const auth = Buffer.from(`${user}:${pass}`).toString('base64');
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
