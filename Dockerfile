# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* bun.lockb* ./
RUN npm install --omit=dev --no-audit --no-fund
RUN cp -R node_modules prod_modules
RUN npm install --no-audit --no-fund

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npx tsc -p tsconfig.build.json

FROM node:20-alpine AS runtime
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app \
 && mkdir -p /app/data && chown -R app:app /app
USER app
COPY --from=deps  /app/prod_modules ./node_modules
# The migrations are ordinary modules under src/db/migrations, so they are
# compiled into dist like everything else and imported by name at boot.
COPY --from=build /app/dist ./dist
COPY public ./public
COPY package.json ./
ENV NODE_ENV=production
EXPOSE 8080
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "dist/index.js"]
