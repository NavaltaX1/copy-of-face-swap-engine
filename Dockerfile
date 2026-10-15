# syntax=docker/dockerfile:1.7

# Multi-stage build for the face swap engine.
#
#   base    - node + pnpm, shared by every stage
#   deps    - full dependency install (dev deps included; the build needs them)
#   build   - compiles the client (vite) and bundles the server (esbuild)
#   migrate - drizzle-kit, which is a devDependency and so cannot live in runtime
#   runtime - production dependencies plus dist/, running as a non-root user
#
# Targets are explicit so `docker compose` can run migrations from the same
# source tree without shipping drizzle-kit in the serving image.

ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS base
WORKDIR /app
# corepack pins pnpm to the version in package.json's packageManager field, so
# the image resolves dependencies the same way a developer's machine does.
RUN corepack enable pnpm
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH


FROM base AS deps
# patches/ is copied with the manifests because pnpm.patchedDependencies
# references it during install; without it the install fails on wouter.
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile


FROM deps AS build
# VITE_* values are read by the client bundle at build time, not at runtime:
# setting them in docker-compose `environment` has no effect on the shipped
# JavaScript, so they are build args and must be passed to `docker build`.
ARG VITE_APP_ID=""
ARG VITE_FRONTEND_FORGE_API_URL=""
ARG VITE_FRONTEND_FORGE_API_KEY=""
ARG VITE_OAUTH_PORTAL_URL=""
ENV VITE_APP_ID=$VITE_APP_ID \
    VITE_FRONTEND_FORGE_API_URL=$VITE_FRONTEND_FORGE_API_URL \
    VITE_FRONTEND_FORGE_API_KEY=$VITE_FRONTEND_FORGE_API_KEY \
    VITE_OAUTH_PORTAL_URL=$VITE_OAUTH_PORTAL_URL

COPY . .
# Produces dist/public (client assets) and dist/index.js (server bundle).
RUN pnpm run build


# Migrations need drizzle-kit, a devDependency. Running them from the build
# stage keeps the runtime image free of the toolchain.
FROM build AS migrate
CMD ["pnpm", "run", "db:push"]


FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
# The server bundle is built with --packages=external, so node_modules is still
# required at runtime - production dependencies only.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# dist/index.js resolves its static files relative to its own directory
# (dist/public), so the whole dist tree is copied as one unit.
COPY --from=build /app/dist ./dist

# The node image ships an unprivileged `node` user; nothing here needs root.
USER node

EXPOSE 3000

# Readiness, not liveness: this reports whether the dependencies the app needs
# are actually reachable, which is what `depends_on: service_healthy` should
# gate on. start-period covers first boot; retries tolerate a slow database.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
