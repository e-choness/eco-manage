# The sandboxed 3D model converter (P5-02). Debian rather than Alpine: assimp, IfcOpenShell and
# KTX-Software ship glibc builds, for x86-64 and arm64. Run by compose read-only, as a non-root
# user, with no capabilities and only an internal network.
FROM node:26-bookworm-slim

ARG KTX_VERSION=4.4.2
# Set by BuildKit for the platform being built: amd64 or arm64.
ARG TARGETARCH
RUN apt-get update \
 && apt-get install -y --no-install-recommends assimp-utils python3 python3-pip ca-certificates curl \
 && ktx_arch=$([ "$TARGETARCH" = arm64 ] && echo arm64 || echo x86_64) \
 && curl -fsSL -o /tmp/ktx.deb "https://github.com/KhronosGroup/KTX-Software/releases/download/v${KTX_VERSION}/KTX-Software-${KTX_VERSION}-Linux-${ktx_arch}.deb" \
 && apt-get install -y --no-install-recommends /tmp/ktx.deb \
 && pip3 install --no-cache-dir --break-system-packages "ifcopenshell>=0.8,<0.9" \
 && apt-get purge -y curl && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* /tmp/ktx.deb /root/.cache

# Node 25+ no longer bundles corepack, so pnpm comes from npm (the version in package.json).
RUN npm install -g pnpm@12.6.0 && npm cache clean --force
WORKDIR /repo

# Only the converter's dependencies, from the workspace lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/profiles/package.json packages/profiles/
COPY packages/recs/package.json packages/recs/
COPY apps/simulator/package.json apps/simulator/
COPY apps/ingest/package.json apps/ingest/
COPY apps/worker/package.json apps/worker/
COPY apps/rules/package.json apps/rules/
COPY apps/modelconv/package.json apps/modelconv/
RUN pnpm install --frozen-lockfile --filter @ecomanage/modelconv... && rm -rf /root/.local/share/pnpm

COPY apps/modelconv apps/modelconv
WORKDIR /repo/apps/modelconv
ENV NODE_ENV=production PORT=3100
USER node
EXPOSE 3100
CMD ["node_modules/.bin/tsx", "src/server.ts"]
