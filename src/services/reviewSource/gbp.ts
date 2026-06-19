import { env } from '../../config/env';
import { BadRequestError } from '../../errors/AppError';
import { decryptSecret } from '../../lib/crypto';
import type { NormalizedReview, ReviewSource, ReviewsConfig } from './types';

/**
 * Google Business Profile (GBP) — returns ALL reviews for a managed location.
 * Reviews live on the legacy v4 endpoint; requires an OAuth access token with the
 * `business.manage` scope. The agency account (a location manager) authorizes once;
 * its refresh token is stored encrypted per org in config.reviews.gbpRefreshTokenEncrypted.
 * Docs: https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews
 */
const STAR_MAP: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

interface GbpReview {
  reviewId?: string;
  reviewer?: { displayName?: string; profilePhotoUrl?: string };
  starRating?: string; // 'ONE'..'FIVE'
  comment?: string;
  createTime?: string; // RFC3339
}

interface GbpReviewsResponse {
  reviews?: GbpReview[];
  nextPageToken?: string;
}

function mapReview(r: GbpReview): NormalizedReview {
  const parsed = r.createTime ? Date.parse(r.createTime) : NaN;
  return {
    externalId: r.reviewId ?? '',
    name: r.reviewer?.displayName ?? 'Anonymous',
    rating: STAR_MAP[r.starRating ?? ''] ?? 0,
    text: r.comment ?? '',
    time: Number.isFinite(parsed) ? parsed : Date.now(),
    avatar: r.reviewer?.profilePhotoUrl ?? null,
    reviewUrl: null,
  };
}

async function getAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID ?? '',
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new BadRequestError(`Google OAuth token error ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new BadRequestError('Google OAuth returned no access token.');
  return data.access_token;
}

export class GbpSource implements ReviewSource {
  constructor(private readonly cfg: ReviewsConfig) {}

  async fetch(): Promise<NormalizedReview[]> {
    const { gbpAccountId, gbpLocationId, gbpRefreshTokenEncrypted } = this.cfg;
    if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
      throw new BadRequestError('Google OAuth client is not configured on the server.');
    }
    if (!gbpAccountId || !gbpLocationId) {
      throw new BadRequestError('GBP account/location id not configured for this organization.');
    }
    if (!gbpRefreshTokenEncrypted) {
      throw new BadRequestError('GBP is not authorized for this organization (missing refresh token).');
    }

    const accessToken = await getAccessToken(decryptSecret(gbpRefreshTokenEncrypted));
    const out: NormalizedReview[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(
        `https://mybusiness.googleapis.com/v4/accounts/${gbpAccountId}/locations/${gbpLocationId}/reviews`,
      );
      url.searchParams.set('pageSize', '50');
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) {
        const body = await res.text();
        throw new BadRequestError(`GBP API error ${res.status}: ${body.slice(0, 300)}`);
      }
      const data = (await res.json()) as GbpReviewsResponse;
      for (const r of data.reviews ?? []) {
        const mapped = mapReview(r);
        if (mapped.externalId) out.push(mapped);
      }
      pageToken = data.nextPageToken;
    } while (pageToken);

    return out;
  }
}
