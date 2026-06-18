import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { logger } from './lib/logger';

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

  // API routes are mounted here in later steps, e.g.:
  //   app.use('/api/v1/auth', authRoutes);
  //   app.use('/api/v1/jobs', jobsRoutes);

  // 404 fallback
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } });
  });

  // Final error handler (replaced by the errors/ module once it exists).
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, 'Unhandled error');
    res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong' } });
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(env.PORT, () => {
    logger.info(`emg-cms-api listening on http://localhost:${env.PORT}`);
  });
}
