import { BadRequestError } from '../../errors/AppError';
import { GooglePlacesSource } from './places';
import { GbpSource } from './gbp';
import type { ReviewSource, ReviewsConfig } from './types';

export * from './types';

/** Build the configured review source adapter for an organization. */
export function createReviewSource(cfg: ReviewsConfig): ReviewSource {
  switch (cfg.source) {
    case 'places':
      return new GooglePlacesSource(cfg);
    case 'gbp':
      return new GbpSource(cfg);
    default:
      throw new BadRequestError(
        `Review source '${cfg.source ?? 'manual'}' has no auto-refresh. Set config.reviews.source to 'places' or 'gbp', or use manual import.`,
      );
  }
}
