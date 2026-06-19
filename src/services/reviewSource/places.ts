import { env } from '../../config/env';
import { BadRequestError } from '../../errors/AppError';
import type { NormalizedReview, ReviewSource, ReviewsConfig } from './types';

/**
 * Google Places API (New) — Place Details `reviews` field.
 * Returns up to 5 reviews ("most relevant"; newest not guaranteed). Combined with
 * cumulative dedupe storage this keeps the CMS current and growing past 5 over cycles.
 * Docs: https://developers.google.com/maps/documentation/places/web-service/place-details
 */
const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places';

interface PlacesReview {
  name?: string; // 'places/{placeId}/reviews/{reviewId}'
  rating?: number;
  text?: { text?: string };
  originalText?: { text?: string };
  publishTime?: string; // RFC3339
  googleMapsUri?: string;
  authorAttribution?: { displayName?: string; uri?: string; photoUri?: string };
}

function mapReview(r: PlacesReview): NormalizedReview {
  const parsed = r.publishTime ? Date.parse(r.publishTime) : NaN;
  return {
    externalId: r.name ?? '',
    name: r.authorAttribution?.displayName ?? 'Anonymous',
    rating: typeof r.rating === 'number' ? r.rating : 0,
    text: r.text?.text ?? r.originalText?.text ?? '',
    time: Number.isFinite(parsed) ? parsed : Date.now(),
    avatar: r.authorAttribution?.photoUri ?? null,
    reviewUrl: r.googleMapsUri ?? r.authorAttribution?.uri ?? null,
  };
}

/**
 * Best-effort: a `maps.app.goo.gl/...` short link rarely carries a Place ID, so the
 * reliable path is an explicit `config.reviews.placeId`. This only catches URLs that
 * happen to include a `place_id` query param after redirect resolution.
 */
async function resolvePlaceIdFromUrl(mapsUrl?: string): Promise<string | null> {
  if (!mapsUrl) return null;
  try {
    const res = await fetch(mapsUrl, { redirect: 'follow' });
    return new URL(res.url).searchParams.get('place_id');
  } catch {
    return null;
  }
}

export class GooglePlacesSource implements ReviewSource {
  constructor(private readonly cfg: ReviewsConfig) {}

  async fetch(): Promise<NormalizedReview[]> {
    if (!env.GOOGLE_MAPS_API_KEY) {
      throw new BadRequestError('GOOGLE_MAPS_API_KEY is not configured on the server.');
    }
    const placeId = this.cfg.placeId ?? (await resolvePlaceIdFromUrl(this.cfg.googleMapsUrl));
    if (!placeId) {
      throw new BadRequestError(
        "No Place ID for this organization. Set config.reviews.placeId (Google's Place ID Finder).",
      );
    }

    const res = await fetch(`${PLACES_ENDPOINT}/${encodeURIComponent(placeId)}`, {
      headers: {
        'X-Goog-Api-Key': env.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'reviews',
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new BadRequestError(`Google Places API error ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { reviews?: PlacesReview[] };
    return (data.reviews ?? []).map(mapReview).filter((r) => r.externalId !== '');
  }
}
