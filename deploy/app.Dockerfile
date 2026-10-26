# Railway "app" service: the API, also serving the built web app (one public URL).
# Migrations run as the pre-deploy command (see railway.app.json).
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo
COPY package.json .npmrc pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile
# Baked into the web build: the browser needs it.
ARG VITE_CLERK_PUBLISHABLE_KEY
RUN pnpm turbo run build --filter=@kept/api... --filter=@kept/web...
ENV NODE_ENV=production WEB_DIST=/repo/apps/web/dist
CMD ["node", "apps/api/dist/index.js"]
