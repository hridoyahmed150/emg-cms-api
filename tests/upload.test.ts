import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Role } from '@prisma/client';

// Mock the R2 client so we test validation/sanitize without real Cloudflare creds.
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock('../src/lib/r2', () => ({
  getR2Client: () => ({ send: sendMock }),
  r2Configured: () => true,
}));

import { uploadFile } from '../src/services/upload.service';
import { prisma, withTenant } from '../src/lib/prisma';
import { createApp } from '../src/server';
import { signAccessToken } from '../src/lib/jwt';
import { hashPassword } from '../src/lib/password';

const app = createApp();

async function reset() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Job","Review","Upload","SyncJob","AuditLog","ApiToken","User","Organization" RESTART IDENTITY CASCADE',
  );
}

async function makeOrg() {
  return prisma.organization.create({
    data: { slug: 'up', name: 'up', deliveryTarget: 'ASTRO_PULL', config: {}, features: {}, customFields: {} },
  });
}

function fakeFile(mimetype: string, buffer: Buffer, originalname = 'f'): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname,
    encoding: '7bit',
    mimetype,
    size: buffer.length,
    buffer,
  } as unknown as Express.Multer.File;
}

// Valid 1x1 transparent PNG.
const REAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

beforeAll(reset);
afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await reset();
  sendMock.mockReset();
  sendMock.mockResolvedValue({});
});

describe('Upload validation & SVG sanitize', () => {
  it('rejects unsupported mime types', async () => {
    const org = await makeOrg();
    await expect(
      withTenant({ tenantId: org.id, isSuper: false }, () =>
        uploadFile(org.id, fakeFile('application/pdf', Buffer.from('%PDF-1.4')), null),
      ),
    ).rejects.toThrow(/Unsupported/);
  });

  it('rejects a png mime with non-png bytes (magic-byte mismatch)', async () => {
    const org = await makeOrg();
    await expect(
      withTenant({ tenantId: org.id, isSuper: false }, () =>
        uploadFile(org.id, fakeFile('image/png', Buffer.from('totally not a png')), null),
      ),
    ).rejects.toThrow(/does not match/);
  });

  it('accepts a real PNG, uploads to R2, persists row', async () => {
    const org = await makeOrg();
    const res = await withTenant({ tenantId: org.id, isSuper: false }, () =>
      uploadFile(org.id, fakeFile('image/png', REAL_PNG, 'logo.png'), null),
    );
    expect(res.url).toContain(`/orgs/${org.id}/uploads/`);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const count = await withTenant({ tenantId: org.id, isSuper: false }, () => prisma.upload.count());
    expect(count).toBe(1);
  });

  it('strips <script> from an SVG before storing', async () => {
    const org = await makeOrg();
    const evil = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>',
    );
    await withTenant({ tenantId: org.id, isSuper: false }, () =>
      uploadFile(org.id, fakeFile('image/svg+xml', evil, 'x.svg'), null),
    );
    const putCommand = sendMock.mock.calls[0]?.[0];
    const storedBody = String(putCommand.input.Body);
    expect(storedBody.toLowerCase()).not.toContain('<script');
    expect(storedBody).toContain('rect');
  });
});

// Regression: multer (busboy streams) drops the AsyncLocalStorage tenant context,
// so the controller must re-establish it with withTenant. Before that fix this POST
// 500'd with "Upload.create ran without a tenant context". Exercise the full HTTP path.
describe('Upload HTTP path keeps tenant context (multer + ALS)', () => {
  it('POST /api/v1/uploads persists an Upload row through multer', async () => {
    const org = await makeOrg();
    const user = await prisma.user.create({
      data: {
        email: 'up@test.com',
        name: 'up admin',
        role: 'ADMIN' as Role,
        passwordHash: await hashPassword('pw'),
        organizationId: org.id,
      },
    });
    const token = signAccessToken({ userId: user.id, role: 'ADMIN' as Role, organizationId: org.id });

    const res = await request(app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', REAL_PNG, { filename: 'logo.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.url).toContain(`/orgs/${org.id}/uploads/`);
    expect(sendMock).toHaveBeenCalledTimes(1);

    const count = await withTenant({ tenantId: org.id, isSuper: false }, () => prisma.upload.count());
    expect(count).toBe(1);
  });
});
