#!/usr/bin/env node
/**
 * R2 smoke test: upload a sample SVG to the bucket, read it back, print the URL.
 * Mirrors src/lib/r2.ts client config. Run from the emg-cms-api dir:
 *   node scripts/r2-smoke-test.mjs
 * Needs R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY in .env (plus account/bucket/endpoint).
 */
import 'dotenv/config';
import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  R2_ENDPOINT,
  R2_PUBLIC_BASE,
} = process.env;

if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
  console.error('✖ Missing R2 creds. Set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET in .env');
  process.exit(1);
}

const endpoint = R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const s3 = new S3Client({
  region: 'auto',
  endpoint,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40">
  <rect width="120" height="40" rx="6" fill="#0376b9"/>
  <text x="60" y="26" font-family="sans-serif" font-size="16" fill="#fff" text-anchor="middle">EMG CMS</text>
</svg>`;

const key = `orgs/0/uploads/r2-smoke-${Date.now()}.svg`;

const main = async () => {
  console.log(`Endpoint : ${endpoint}`);
  console.log(`Bucket   : ${R2_BUCKET}`);
  console.log(`Key      : ${key}\n`);

  console.log('→ PutObject…');
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: SVG,
      ContentType: 'image/svg+xml',
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  console.log('  ✅ uploaded');

  console.log('→ HeadObject…');
  const head = await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  console.log(`  ✅ exists — ${head.ContentLength} bytes, ${head.ContentType}`);

  console.log('→ GetObject…');
  const got = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  const body = await got.Body.transformToString();
  console.log(`  ✅ read back ${body.length} chars (matches: ${body === SVG})`);

  if (R2_PUBLIC_BASE) {
    const url = `${R2_PUBLIC_BASE.replace(/\/$/, '')}/${key}`;
    console.log(`\n→ Public fetch ${url}`);
    try {
      const res = await fetch(url);
      console.log(`  ${res.ok ? '✅' : '✖'} HTTP ${res.status} (public read ${res.ok ? 'works' : 'NOT enabled?'})`);
    } catch (e) {
      console.log(`  ✖ ${e.message}`);
    }
  } else {
    console.log('\n(ℹ R2_PUBLIC_BASE not set — skipped public-URL check. Enable the bucket Public Dev URL to serve files.)');
  }

  console.log('\n🎉 R2 smoke test passed.');
};

main().catch((e) => {
  console.error(`\n✖ R2 test failed: ${e.name}: ${e.message}`);
  if (/SignatureDoesNotMatch|InvalidAccessKeyId|Unauthorized|403/.test(`${e.name}${e.message}`)) {
    console.error('  → Check the Access Key ID / Secret (R2 API token with Object Read & Write).');
  }
  if (/NoSuchBucket|404/.test(`${e.name}${e.message}`)) {
    console.error(`  → Check the bucket name (R2_BUCKET=${R2_BUCKET}).`);
  }
  process.exit(1);
});
