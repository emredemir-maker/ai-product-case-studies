# syntax=docker/dockerfile:1

# Build the interface.
FROM node:22-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/package-lock.json web/
RUN npm ci && npm --prefix web ci
COPY tsconfig.json ./
COPY src src
COPY web web
RUN npm --prefix web run build

# The server. It needs git (commit history) and GEO Optimizer (the site audit), which is a
# Python tool installed into its own virtual environment.
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/geo \
    && /opt/geo/bin/pip install --no-cache-dir geo-optimizer-skill
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src src
COPY skills skills
COPY --from=web /app/web/dist web/dist
RUN mkdir /data && chown node:node /data
USER node
# Everything that must survive a restart lives in /data: brand.json, watch.json, the lists,
# mirrored repositories and the tool cache.
ENV CMO_DATA_DIR=/data \
    CMO_BRAND_FILE=/data/brand.json \
    CMO_WATCH_FILE=/data/watch.json \
    CMO_HOST=0.0.0.0 \
    CMO_UI_PORT=4321 \
    CMO_REVIEW_EVERY_HOURS=24 \
    CMO_GEO_COMMAND=/opt/geo/bin/geo \
    HOME=/data
VOLUME /data
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:4321/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["sh", "-c", "exec node_modules/.bin/tsx src/cli.ts ui --every \"$CMO_REVIEW_EVERY_HOURS\""]
