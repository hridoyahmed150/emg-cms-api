/**
 * Provider-abstracted Google reviews ingestion.
 *
 * Each adapter (Places API, GBP API) turns a provider response into a list of
 * `NormalizedReview`. The caller (review.service `refreshReviews`) dedupes by
 * `externalId` and inserts via `createMany({ skipDuplicates: true })`, so the
 * CMS accumulates reviews over cycles even when a provider only returns a few
 * per call. No server-side scraping — official APIs only.
 */

export type ReviewSourceKind = 'manual' | 'places' | 'gbp';

/** Per-organization review config, stored at `Organization.config.reviews`. */
export interface ReviewsConfig {
  source?: ReviewSourceKind;
  // Google Places (New)
  placeId?: string;
  googleMapsUrl?: string;
  // Google Business Profile (GBP)
  gbpAccountId?: string;
  gbpLocationId?: string;
  gbpRefreshTokenEncrypted?: string; // AES-256-GCM (see lib/crypto)
  // Display + cadence (defaults in REVIEWS_DEFAULTS)
  minRating?: number;
  limit?: number;
  syncEveryDays?: number;
  lastRefreshedAt?: number; // unix ms
}

/** Provider-neutral review, ready for dedupe + storage. */
export interface NormalizedReview {
  externalId: string; // stable provider review id — the dedupe key
  name: string;
  rating: number; // 1..5
  text: string;
  time: number; // unix ms
  avatar?: string | null;
  reviewUrl?: string | null;
}

export interface ReviewSource {
  /** Fetch the current set of reviews from the external provider. */
  fetch(): Promise<NormalizedReview[]>;
}

export const REVIEWS_DEFAULTS = {
  minRating: 5,
  limit: 20,
  syncEveryDays: 15,
} as const;
