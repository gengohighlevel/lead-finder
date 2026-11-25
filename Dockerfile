# Lead Finder as a container. The library and backups live in the /data volume, never in the image.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && apt-get clean
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npx next build

FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && apt-get clean
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000 \
    LEADS_DB=/data/leads.db BACKUP_DIR=/data/backups OUTREACH_POLICY_FILE=/data/outreach-policy.json
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && apt-get clean && mkdir -p /data && chown node:node /data
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --chown=node:node public ./public
COPY --chown=node:node package.json next.config.mjs OFFER.md ./
COPY --chown=node:node docs ./docs
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
