# Build context is the repo root (see docker-compose.yml).
FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN npm ci

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server

WORKDIR /app/apps/server
EXPOSE 4000
# `start` pushes the drizzle schema (creates/updates tables) then boots the server.
CMD ["npm", "run", "start"]
