# Production images for a hosted demo (infra/deploy, docs/deploy/oracle.md), for amd64 and arm64:
#   --target web   the built web app, served by nginx, which also proxies /api and /cdn
#   --target app   every Node service (api, ingest, rules, worker, simulator); compose picks the
#                  service with working_dir and command
# The model converter has its own sandbox image (apps/modelconv/Dockerfile). Built by
# .github/workflows/images.yml, or on the server with `docker compose build`.

FROM node:26-alpine AS pnpm
# Node 25+ no longer bundles corepack, so pnpm comes from npm (the version in package.json).
RUN npm install -g pnpm@12.6.0 && npm cache clean --force
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/ingest/package.json apps/ingest/
COPY apps/rules/package.json apps/rules/
COPY apps/worker/package.json apps/worker/
COPY apps/simulator/package.json apps/simulator/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/profiles/package.json packages/profiles/
COPY packages/recs/package.json packages/recs/

FROM pnpm AS web-build
RUN pnpm install --frozen-lockfile --filter @ecomanage/web...
COPY packages packages
COPY apps/web apps/web
# A demo build shows the demo account on the sign-in page.
ARG VITE_DEMO=true
ENV VITE_DEMO=$VITE_DEMO
RUN pnpm --filter @ecomanage/web build

FROM nginx:1.29-alpine AS web
COPY infra/deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /repo/apps/web/dist /usr/share/nginx/html

FROM pnpm AS app
# The services' dependencies; tsx runs the TypeScript sources, as in development. Not --prod:
# the shared packages take mongoose as a peer, which the workspace provides from their dev
# dependencies.
RUN pnpm install --frozen-lockfile \
      --filter @ecomanage/api... --filter @ecomanage/ingest... --filter @ecomanage/rules... \
      --filter @ecomanage/worker... --filter @ecomanage/simulator... \
 && rm -rf /root/.local/share/pnpm /root/.cache
COPY packages packages
COPY apps/api apps/api
COPY apps/ingest apps/ingest
COPY apps/rules apps/rules
COPY apps/worker apps/worker
COPY apps/simulator apps/simulator
ENV NODE_ENV=production
# The simulator keeps its counters here (a volume, which takes this owner when first created).
RUN mkdir /state && chown node:node /state
USER node
