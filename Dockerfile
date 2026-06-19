# emg-cms-api — production image.
# Build ON the target VM (docker compose build) so the Prisma query engine matches
# the VM's CPU arch (Oracle Always Free = ARM64 Ampere). Debian slim (not Alpine) +
# openssl so Prisma engines load cleanly.

FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ── Build stage: install all deps, generate client, compile TS ──
FROM base AS build
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

# ── Runtime stage ──
FROM base AS runtime
ENV NODE_ENV=production
# Carry full node_modules (incl. prisma CLI + tsx) so `migrate deploy` / `db seed` work.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
EXPOSE 4000
# Single instance → apply pending migrations on boot, then start (Express + in-process cron).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/server.js"]
