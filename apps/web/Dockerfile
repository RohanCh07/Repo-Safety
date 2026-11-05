# Builds the API + worker image. Run with docker compose (see docker-compose.yml at the repo root).
FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/web/server/package.json apps/web/server/
COPY apps/web/frontend/package.json apps/web/frontend/
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @repo-safety/web-server...
COPY packages/core packages/core
COPY apps/web apps/web
RUN pnpm --filter @repo-safety/core build && pnpm --filter @repo-safety/web-server build \
 && pnpm deploy --filter @repo-safety/web-server --prod --legacy /out

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production PUBLIC_DIR=/app/public
COPY --from=build /out .
COPY apps/web/frontend/public ./public
# Scans never execute repo code, but the process still runs without root.
USER node
EXPOSE 8080
CMD ["node", "dist/api.js"]
