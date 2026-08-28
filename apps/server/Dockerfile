# Build context is the repo root (see docker-compose.yml).
FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY tsconfig.base.json ./
COPY apps/server apps/server
COPY apps/web apps/web

# The server serves the built dashboard on non-/graphql paths (see WEB_DIST).
RUN npm run build -w @eunomia/web
ENV WEB_DIST=/app/apps/web/dist

WORKDIR /app/apps/server
EXPOSE 4000
# `start` applies committed drizzle migrations, then boots the server.
CMD ["npm", "run", "start"]
