ARG NODE_VERSION=24.15.0
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@10.22.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --strict-peer-dependencies
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN pnpm typecheck && pnpm build

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir bench-results && chown node:node bench-results
USER node
ENTRYPOINT ["node", "--expose-gc", "dist/index.js"]
