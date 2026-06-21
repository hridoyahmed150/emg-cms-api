import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/password';

/**
 * Idempotent bootstrap script to create (or ensure) a user — primarily for
 * provisioning SUPER_ADMINs out-of-band. Reads credentials from env so no
 * secret is committed:
 *
 *   SA_EMAIL=foo@bar.com SA_PASSWORD='secret123' SA_NAME='Foo' \
 *   SA_ROLE=SUPER_ADMIN npx tsx prisma/create-user.ts
 *
 * Target a specific DB by prefixing DATABASE_URL=... (e.g. the Render external URL).
 * Re-running with the same email updates name/role/password (does not duplicate).
 */
async function main() {
  const email = process.env.SA_EMAIL?.toLowerCase().trim();
  const password = process.env.SA_PASSWORD;
  const name = process.env.SA_NAME?.trim() || 'Admin';
  const role = (process.env.SA_ROLE || 'SUPER_ADMIN') as 'SUPER_ADMIN' | 'ADMIN';

  if (!email || !password) {
    throw new Error('SA_EMAIL and SA_PASSWORD are required');
  }
  if (password.length < 8) {
    throw new Error('SA_PASSWORD must be at least 8 characters');
  }
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') {
    throw new Error(`SA_ROLE must be SUPER_ADMIN or ADMIN (got "${role}")`);
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.upsert({
    where: { email },
    update: { name, role, passwordHash },
    create: {
      email,
      name,
      role,
      passwordHash,
      // SUPER_ADMIN has no org; an ADMIN created this way is org-less unless you set one later.
      organizationId: null,
    },
  });

  // eslint-disable-next-line no-console
  console.log(`OK: ${role} user ensured -> id=${user.id} email=${user.email} name=${user.name}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
