# syntax=docker/dockerfile:1
# Images for the API and for Caddy serving the SPA (docs/architecture.md §8.3).
# Build from the repository root, or through compose.yaml:
#   docker build -f docker/Dockerfile --target api .
#   docker build -f docker/Dockerfile --target web .

# The same Node image builds and runs the API, so better-sqlite3's native binary
# (a musl prebuild on Alpine) matches the runtime's libc.
FROM node:26-alpine AS node
# Keep in step with packageManager in package.json.
RUN npm install --global pnpm@12.11.2
WORKDIR /repo

# Dependencies from the lockfile alone: this layer is reused until a dependency changes.
FROM node AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

FROM deps AS build
COPY . .
RUN pnpm install --offline --frozen-lockfile
RUN pnpm --filter @meal-planner/api --filter @meal-planner/web build
# A pruned production node_modules for the API. Hoisted, because the bundle in dist/
# imports the workspace packages' own dependencies (better-sqlite3, drizzle-orm) directly.
RUN pnpm --filter @meal-planner/api deploy --prod --config.node-linker=hoisted /out

FROM node:26-alpine AS api
WORKDIR /app
COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
# Named volumes mounted here start out with these directories' owner.
RUN mkdir /data && chown node:node /data
USER node
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/app.db
EXPOSE 3000
# The healthcheck lives in compose.yaml, because OCI-format images (Podman's default)
# drop a Dockerfile HEALTHCHECK.
ENTRYPOINT ["node", "dist/app/main.js"]

FROM caddy:2.11-alpine AS web
# The caddy binary carries cap_net_bind_service as a file capability. With every
# capability dropped (compose.yaml) exec would fail, and Caddy only binds high ports,
# so remove it. Then run as an unprivileged user.
RUN apk add --no-cache libcap \
    && setcap -r /usr/bin/caddy \
    && apk del libcap \
    && addgroup -S caddy \
    && adduser -S -G caddy caddy \
    && chown -R caddy:caddy /data /config
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
USER caddy
EXPOSE 8080 8443
