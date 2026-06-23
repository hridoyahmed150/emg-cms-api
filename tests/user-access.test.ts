import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type { Role } from '@prisma/client';
import { createApp } from '../src/server';
import { prisma, withTenant } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/password';
import { signAccessToken, signRefreshToken } from '../src/lib/jwt';

const app = createApp();
const STRONG_PW = 'StrongPass123!';

async function reset() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Job","Review","Upload","SyncJob","AuditLog","ApiToken","User","Organization" RESTART IDENTITY CASCADE',
  );
}

async function makeSuper(email = 'super@test.com') {
  const user = await prisma.user.create({
    data: { email, name: 'Super', role: 'SUPER_ADMIN' as Role, passwordHash: await hashPassword(STRONG_PW) },
  });
  const token = signAccessToken({ userId: user.id, role: 'SUPER_ADMIN' as Role, organizationId: null });
  return { user, token };
}

async function makeOrgAdmin(slug = 'orga') {
  const org = await prisma.organization.create({
    data: { slug, name: slug, deliveryTarget: 'ASTRO_PULL', config: {}, features: {}, customFields: {} },
  });
  const user = await prisma.user.create({
    data: {
      email: `${slug}@test.com`,
      name: `${slug} admin`,
      role: 'ADMIN' as Role,
      passwordHash: await hashPassword(STRONG_PW),
      organizationId: org.id,
    },
  });
  const token = signAccessToken({ userId: user.id, role: 'ADMIN' as Role, organizationId: org.id });
  return { org, user, token };
}

beforeAll(reset);
afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});
beforeEach(reset);

describe('User management is SUPER_ADMIN-only', () => {
  it('ADMIN gets 403 on every /users route', async () => {
    const { org, user, token } = await makeOrgAdmin();
    const auth = { Authorization: `Bearer ${token}` };

    expect((await request(app).get('/api/v1/users').set(auth)).status).toBe(403);
    expect((await request(app).get(`/api/v1/users/${user.id}`).set(auth)).status).toBe(403);
    expect(
      (await request(app).post('/api/v1/users').set(auth).send({
        email: 'x@test.com',
        name: 'X',
        role: 'ADMIN',
        organizationId: org.id,
        password: STRONG_PW,
      })).status,
    ).toBe(403);
    expect((await request(app).patch(`/api/v1/users/${user.id}`).set(auth).send({ name: 'Y' })).status).toBe(403);
    expect((await request(app).delete(`/api/v1/users/${user.id}`).set(auth)).status).toBe(403);
  });

  it('SUPER_ADMIN can list and create users', async () => {
    const { token } = await makeSuper();
    const { org } = await makeOrgAdmin();

    const list = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);

    const created = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'new@test.com', name: 'New', role: 'ADMIN', organizationId: org.id, password: STRONG_PW });
    expect(created.status).toBe(201);
    expect(created.body.email).toBe('new@test.com');
  });
});

describe('Password policy', () => {
  it('rejects a weak password with 422', async () => {
    const { token } = await makeSuper();
    const { org } = await makeOrgAdmin();
    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'weak@test.com', name: 'Weak', role: 'ADMIN', organizationId: org.id, password: '11111111' });
    expect(res.status).toBe(422);
  });
});

describe('Last super admin guard', () => {
  it('blocks demoting the only super admin (400)', async () => {
    const { user, token } = await makeSuper();
    const res = await request(app)
      .patch(`/api/v1/users/${user.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'ADMIN' });
    expect(res.status).toBe(400);
  });

  it('allows demoting a super admin when another exists (with an org assigned)', async () => {
    const a = await makeSuper('a@test.com');
    const b = await makeSuper('b@test.com');
    const { org } = await makeOrgAdmin();
    const res = await request(app)
      .patch(`/api/v1/users/${b.user.id}`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ role: 'ADMIN', organizationId: org.id });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('ADMIN');
    expect(res.body.organizationId).toBe(org.id);
  });
});

describe('Role/org consistency (no bricked accounts)', () => {
  it('demoting a super admin without an org is rejected (400)', async () => {
    const a = await makeSuper('a@test.com');
    const b = await makeSuper('b@test.com');
    const res = await request(app)
      .patch(`/api/v1/users/${b.user.id}`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ role: 'ADMIN' });
    expect(res.status).toBe(400);
  });

  it("setting an ADMIN's organizationId to null is rejected (400)", async () => {
    const { token } = await makeSuper();
    const { user } = await makeOrgAdmin();
    const res = await request(app)
      .patch(`/api/v1/users/${user.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ organizationId: null });
    expect(res.status).toBe(400);
  });

  it('promoting an ADMIN to SUPER_ADMIN clears its organizationId', async () => {
    const { token } = await makeSuper();
    const { user } = await makeOrgAdmin();
    const res = await request(app)
      .patch(`/api/v1/users/${user.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'SUPER_ADMIN' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('SUPER_ADMIN');
    expect(res.body.organizationId).toBeNull();
  });
});

describe('Refresh-token invalidation on password change', () => {
  it('old refresh cookie stops working after the password is changed', async () => {
    const { token: superToken } = await makeSuper();
    const { user } = await makeOrgAdmin();

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: STRONG_PW });
    expect(login.status).toBe(200);
    const cookie = login.headers['set-cookie'] as string;
    expect(cookie).toBeTruthy();

    // The refresh works before the password change.
    const before = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(before.status).toBe(200);

    // Super admin resets that user's password -> bumps tokenVersion.
    const changed = await request(app)
      .patch(`/api/v1/users/${user.id}`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ password: 'AnotherStrong9!' });
    expect(changed.status).toBe(200);

    // The OLD refresh cookie is now rejected.
    const after = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(after.status).toBe(401);
  });
});

describe('Audit logging', () => {
  it('writes an auth.login row on successful login', async () => {
    const { user } = await makeOrgAdmin();
    await request(app).post('/api/v1/auth/login').send({ email: user.email, password: STRONG_PW });

    const row = await withTenant({ tenantId: null, isSuper: true }, () =>
      prisma.auditLog.findFirst({ where: { action: 'auth.login', userId: user.id } }),
    );
    expect(row).toBeTruthy();
  });
});

describe('Permissions catalog endpoint', () => {
  it('returns roles + catalog; ADMIN role has no users:* permission', async () => {
    const { token } = await makeOrgAdmin();
    const res = await request(app).get('/api/v1/meta/permissions').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.roles.SUPER_ADMIN).toContain('*');
    expect(res.body.catalog.some((c: { key: string }) => c.key === 'users:read')).toBe(true);
    expect(res.body.roles.ADMIN.some((p: string) => p.startsWith('users:'))).toBe(false);
  });
});

describe('Self-service password change (POST /auth/change-password)', () => {
  async function makeUser() {
    const org = await prisma.organization.create({
      data: { slug: 'cp', name: 'cp', deliveryTarget: 'ASTRO_PULL', config: {}, features: {}, customFields: {} },
    });
    const user = await prisma.user.create({
      data: {
        email: 'cp@test.com',
        name: 'CP',
        role: 'ADMIN' as Role,
        passwordHash: await hashPassword(STRONG_PW),
        organizationId: org.id,
        mustChangePassword: true,
      },
    });
    const access = signAccessToken({ userId: user.id, role: 'ADMIN' as Role, organizationId: org.id });
    return { user, access };
  }

  it('changes password, clears mustChangePassword, rotates the session, invalidates old refresh token', async () => {
    const { user, access } = await makeUser();
    const oldRefresh = signRefreshToken({ userId: user.id, tokenVersion: 0 });

    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${access}`)
      .send({ currentPassword: STRONG_PW, newPassword: 'NewStrongPass456!' });

    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(false);
    expect(res.body.accessToken).toBeTruthy();
    expect(String(res.headers['set-cookie'] ?? '')).toContain('emg_refresh'); // fresh cookie for this session

    // Old refresh token (tokenVersion 0) is now stale → 401.
    const refreshOld = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `emg_refresh=${oldRefresh}`);
    expect(refreshOld.status).toBe(401);

    // New password logs in; old password no longer works.
    expect(
      (await request(app).post('/api/v1/auth/login').send({ email: 'cp@test.com', password: 'NewStrongPass456!' })).status,
    ).toBe(200);
    expect(
      (await request(app).post('/api/v1/auth/login').send({ email: 'cp@test.com', password: STRONG_PW })).status,
    ).toBe(401);
  });

  it('rejects a wrong current password (401), leaving the password unchanged', async () => {
    const { access } = await makeUser();
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${access}`)
      .send({ currentPassword: 'WrongPass999!', newPassword: 'NewStrongPass456!' });
    expect(res.status).toBe(401);
    expect(
      (await request(app).post('/api/v1/auth/login').send({ email: 'cp@test.com', password: STRONG_PW })).status,
    ).toBe(200);
  });

  it('rejects a weak new password (422)', async () => {
    const { access } = await makeUser();
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${access}`)
      .send({ currentPassword: STRONG_PW, newPassword: 'short' });
    expect(res.status).toBe(422);
  });

  it('requires authentication (401 without a token)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: STRONG_PW, newPassword: 'NewStrongPass456!' });
    expect(res.status).toBe(401);
  });
});
