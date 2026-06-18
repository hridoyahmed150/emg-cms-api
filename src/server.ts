import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { logger } from './lib/logger';
import { errorHandler, notFoundHandler } from './middleware/error';
import { authRoutes } from './routes/auth.routes';
import { jobRoutes } from './routes/job.routes';
import { reviewRoutes } from './routes/review.routes';
import { tokenRoutes } from './routes/token.routes';
import { publicRoutes } from './routes/public.routes';
import { organizationRoutes } from './routes/organization.routes';
import { userRoutes } from './routes/user.routes';
import { uploadRoutes } from './routes/upload.routes';
import { deliveryJobsRoutes } from './routes/deliveryJobs.routes';
import { startDeliveryWorker } from './delivery/worker';

/** Build the Express app. Exported so tests can mount it without binding a port. */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger }));

  app.get('/healthz', (_req: Request, res: Response) => {
    res.json({ status: 'ok', env: env.NODE_ENV });
  });

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/jobs', jobRoutes);
  app.use('/api/v1/reviews', reviewRoutes);
  app.use('/api/v1/tokens', tokenRoutes);
  app.use('/api/v1/public', publicRoutes);
  app.use('/api/v1/organizations', organizationRoutes);
  app.use('/api/v1/users', userRoutes);
  app.use('/api/v1/uploads', uploadRoutes);
  app.use('/api/v1/delivery-jobs', deliveryJobsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(env.PORT, () => {
    logger.info(`emg-cms-api listening on http://localhost:${env.PORT}`);
  });
  startDeliveryWorker();
}
