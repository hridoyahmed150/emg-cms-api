import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/password';

/**
 * Seed initial data: an EMG super_admin, the EIS-TX organization (tenant zero),
 * and an EIS-TX org admin. Idempotent (upsert by unique key).
 *
 * Default dev passwords — CHANGE before any real deployment.
 */
async function main() {
  const SUPER_EMAIL = 'super@emg.com';
  const ADMIN_EMAIL = 'admin@eis-tx.com';
  const DEV_PASSWORD = 'ChangeMe123!';

  const superHash = await hashPassword(DEV_PASSWORD);
  await prisma.user.upsert({
    where: { email: SUPER_EMAIL },
    update: {},
    create: {
      email: SUPER_EMAIL,
      name: 'EMG Super Admin',
      role: 'SUPER_ADMIN',
      passwordHash: superHash,
    },
  });

  const org = await prisma.organization.upsert({
    where: { slug: 'eis-tx' },
    update: {},
    create: {
      slug: 'eis-tx',
      name: 'EIS Texas',
      deliveryTarget: 'ASTRO_PULL',
      config: {},
      features: { jobs: true, reviews: true },
      customFields: {},
    },
  });

  const adminHash = await hashPassword(DEV_PASSWORD);
  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {},
    create: {
      email: ADMIN_EMAIL,
      name: 'EIS-TX Admin',
      role: 'ADMIN',
      passwordHash: adminHash,
      organizationId: org.id,
    },
  });

  // eslint-disable-next-line no-console
  console.log(
    `Seeded:\n  super_admin: ${SUPER_EMAIL}\n  EIS-TX org id=${org.id} (slug=eis-tx)\n  EIS-TX admin: ${ADMIN_EMAIL}\n  dev password: ${DEV_PASSWORD}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
