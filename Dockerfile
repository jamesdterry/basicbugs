FROM node:22-slim

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app

# better-sqlite3 ships prebuilt binaries for node:22-slim, so no toolchain needed.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public
COPY scripts ./scripts

EXPOSE 8080

USER node
CMD ["node", "server/index.js"]
