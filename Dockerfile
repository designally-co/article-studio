# syntax=docker/dockerfile:1

# Article Studio's production image: linux/amd64, Node 22, Next.js standalone.
# Built, tested and pushed by .github/workflows/release.yml, and deployed as
# docs/deploy-nas.md describes. Nothing in this file, or in any layer it
# produces, is a secret: runtime values come from Portainer.
#
# EVERY STAGE BUILDS FOR THE TARGET PLATFORM, NOT $BUILDPLATFORM. `npm ci`
# installs sharp's native binaries for the platform it runs on, so installing
# dependencies on an ARM builder and copying them into an amd64 image ships
# binaries that cannot load. The release runner is amd64, so this costs no
# emulation there.

# ---- deps ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- builder ----
FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# src/auth.ts refuses a production build without Google credentials, so this
# one command gets placeholders. They are not credentials, they are not kept in
# the image's environment, and the real values are read at runtime.
RUN AUTH_GOOGLE_ID=build-placeholder AUTH_GOOGLE_SECRET=build-placeholder npm run build

# ---- runner ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

# The commit this image was built from, reported by /api/health.
ARG APP_COMMIT_SHA=""
ENV APP_COMMIT_SHA=$APP_COMMIT_SHA

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# SHARP'S NATIVE PACKAGES, WHOLE. The standalone file tracer copies sharp's
# `.node` binding but not the libvips library it links against, which is why
# sharp never loaded on Vercel. Generated images go through sharp with no
# fallback, and /api/health counts it towards `ok`, so the image carries all of
# @img rather than whatever the tracer found.
COPY --from=builder /app/node_modules/@img ./node_modules/@img

# The migration command, so a release is migrated by the same immutable image
# that serves it. The server never migrates on start in production: the stack
# sets SKIP_DB_MIGRATE=1, and docs/deploy-nas.md has the one-off command.
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts/migrate.ts ./scripts/migrate.ts
COPY --from=builder /app/node_modules/postgres ./node_modules/postgres
COPY --from=builder /app/node_modules/drizzle-orm ./node_modules/drizzle-orm

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "server.js"]
