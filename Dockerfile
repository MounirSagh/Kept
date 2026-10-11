FROM node:22-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo

# ---- build: full workspace, also used for running migrations ----
FROM base AS build
COPY package.json .npmrc pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile
ARG VITE_CLERK_PUBLISHABLE_KEY
RUN pnpm build
RUN pnpm deploy --filter=@kept/api --prod /out/api \
  && pnpm deploy --filter=@kept/worker --prod /out/worker

# ---- api ----
FROM node:22-slim AS api
WORKDIR /app
COPY --from=build /out/api .
USER node
CMD ["node", "dist/index.js"]

# ---- worker ----
FROM node:22-slim AS worker
WORKDIR /app
COPY --from=build /out/worker .
USER node
CMD ["node", "dist/index.js"]

# ---- web ----
FROM nginx:1.29-alpine AS web
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
