# Hosted portfolio demo image (portfolio plan Phase 2).
# better-sqlite3 is a native module — it installs its prebuilt linux binary
# during `npm ci` inside the image, so the deploy host never compiles anything.
# Litestream rides along to replicate the owner DB to object storage (R2);
# scripts/start.sh restores-then-replicates when LITESTREAM_REPLICA_URL is set.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1

ARG LITESTREAM_VERSION=v0.3.13
# Auto-populated by BuildKit (amd64 on Fly/Render builders, arm64 on an
# Apple-silicon local build) — declaring a default would override it.
ARG TARGETARCH
ADD https://github.com/benbjohnson/litestream/releases/download/${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-${TARGETARCH}.deb /tmp/litestream.deb
# ca-certificates: node:22-slim ships no system CA store (Node bundles its own),
# but litestream is a Go binary and needs it to verify the bucket's TLS cert.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && dpkg -i /tmp/litestream.deb && rm /tmp/litestream.deb

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/.next ./.next
COPY next.config.js ./
COPY litestream.yml /etc/litestream.yml
COPY scripts/start.sh ./scripts/start.sh
RUN chmod +x scripts/start.sh

EXPOSE 3000
CMD ["./scripts/start.sh"]
