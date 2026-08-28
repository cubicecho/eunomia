# Build context is the repo root (see docker-compose.yml).
FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# @eunomia/gql generates the resolver types and the dashboard's SDK from
# schema.graphql on install, so its prepare script has to be here before
# `npm ci` runs it. No sources yet at that point — it says so and skips, and
# the explicit codegen below does the real work once they land.
COPY packages/gql/package.json packages/gql/
COPY packages/gql/scripts packages/gql/scripts
RUN npm ci

COPY tsconfig.base.json schema.graphql ./
COPY packages packages
COPY apps/server apps/server
COPY apps/web apps/web

# Not in git: regenerated here, from the schema and the operations just copied.
RUN npm run codegen:types

# The server serves the built dashboard on non-/graphql paths (see WEB_DIST).
RUN npm run build -w @eunomia/web
ENV WEB_DIST=/app/apps/web/dist

WORKDIR /app/apps/server
EXPOSE 4000
# `start` applies committed drizzle migrations, then boots the server.
CMD ["npm", "run", "start"]
