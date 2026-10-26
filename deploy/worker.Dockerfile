# Railway "worker" service: sync, routing, extraction, agent runs, sending.
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo
COPY package.json .npmrc pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile
RUN pnpm turbo run build --filter=@kept/worker...
ENV NODE_ENV=production
CMD ["node", "apps/worker/dist/index.js"]
