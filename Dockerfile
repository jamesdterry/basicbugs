FROM node:22-slim

ENV NODE_ENV=production \
    PORT=8080

# ca-certificates + wget to fetch the Litestream release tarball.
# sqlite3 CLI for ops use (BACKUPS.md drill steps, manual restore inspection).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates wget sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Install Litestream (pinned). Replicates /data/basicbugs.sqlite to Tigris.
# Binary is ~15 MB — negligible next to the Node image. linux-amd64 matches
# Fly's standard machine architecture; switch to arm64 if scheduling on
# ARM machines.
ARG LITESTREAM_VERSION=v0.3.13
RUN wget -qO /tmp/litestream.tar.gz \
      "https://github.com/benbjohnson/litestream/releases/download/${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-amd64.tar.gz" \
    && tar -xzf /tmp/litestream.tar.gz -C /usr/local/bin \
    && rm /tmp/litestream.tar.gz \
    && litestream version

WORKDIR /app

# better-sqlite3 ships prebuilt binaries for node:22-slim, so no toolchain needed.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public
COPY scripts ./scripts
COPY litestream.yml ./
COPY docker-entrypoint.sh ./
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 8080

# No USER directive: the Fly volume mounted at /data is root-owned by
# default, so dropping to a non-root user breaks migrations, attachment
# writes, and the entrypoint's restore gate. Firecracker provides the
# isolation boundary; matches HistoricalDip's container.

# Use CMD (not ENTRYPOINT) so fly.toml's `release_command` can override
# this with `node scripts/migrate.js` for migration runs. The entrypoint
# enforces a fail-closed restore gate (never auto-restores — operator
# must touch /data/.allow-restore) and then runs
# `litestream replicate -exec "node server/index.js"` so replication
# runs in lockstep with the app. SIGTERM → node exits → Litestream
# flushes final WAL → Litestream exits. See BACKUPS.md.
CMD ["/app/docker-entrypoint.sh"]
