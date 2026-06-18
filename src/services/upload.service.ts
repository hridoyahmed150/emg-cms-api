import crypto from 'node:crypto';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import DOMPurify from 'isomorphic-dompurify';
import { prisma } from '../lib/prisma';
import { getR2Client } from '../lib/r2';
import { env } from '../config/env';
import { ValidationError, NotFoundError, BadRequestError } from '../errors/AppError';

const ALLOWED: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};
const MAX_SIZE = 2 * 1024 * 1024;

export async function uploadFile(
  orgId: number,
  file: Express.Multer.File | undefined,
  userId: number | null,
) {
  if (!file) throw new ValidationError('No file provided (form field name must be "file")');
  if (file.size > MAX_SIZE) throw new ValidationError('File too large (max 2MB)');

  const ext = ALLOWED[file.mimetype];
  if (!ext) throw new ValidationError(`Unsupported file type: ${file.mimetype}`);

  let buffer = file.buffer;
  if (file.mimetype === 'image/svg+xml') {
    // SVG is XML/text — sanitize to strip <script>, on* handlers, etc. (XSS defense).
    const clean = DOMPurify.sanitize(buffer.toString('utf-8'), {
      USE_PROFILES: { svg: true, svgFilters: true },
    });
    buffer = Buffer.from(clean, 'utf-8');
  } else {
    // Don't trust the client MIME — verify by magic bytes.
    const { fileTypeFromBuffer } = await import('file-type');
    const detected = await fileTypeFromBuffer(buffer);
    if (!detected || detected.mime !== file.mimetype) {
      throw new ValidationError('File content does not match its declared type');
    }
  }

  if (!env.R2_BUCKET || !env.R2_PUBLIC_BASE) {
    throw new BadRequestError('File storage (R2) is not configured on the server');
  }

  const key = `orgs/${orgId}/uploads/${crypto.randomUUID()}${ext}`;
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: file.mimetype,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );

  const publicUrl = `${env.R2_PUBLIC_BASE.replace(/\/$/, '')}/${key}`;
  const upload = await prisma.upload.create({
    data: {
      organizationId: orgId, // also enforced by the tenant extension
      uploadedBy: userId,
      r2Key: key,
      publicUrl,
      mimeType: file.mimetype,
      sizeBytes: buffer.length,
      originalName: file.originalname,
    },
  });
  return { id: upload.id, url: publicUrl, mimeType: upload.mimeType, sizeBytes: upload.sizeBytes };
}

export async function deleteUpload(id: number) {
  const upload = await prisma.upload.findFirst({ where: { id } });
  if (!upload) throw new NotFoundError('Upload not found');
  if (env.R2_BUCKET) {
    try {
      await getR2Client().send(
        new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: upload.r2Key }),
      );
    } catch {
      // Ignore R2 delete failures — the DB row is the source of truth for the CMS.
    }
  }
  await prisma.upload.deleteMany({ where: { id } });
}
