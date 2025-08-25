# syntax=docker/dockerfile:1.8

FROM node:20-alpine
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate && pnpm config set store-dir /app/.pnpm-store

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

COPY services/ingestion-service/package.json services/ingestion-service/
RUN pnpm -C services/ingestion-service install --frozen-lockfile=false

COPY services/ingestion-service/ services/ingestion-service/
RUN pnpm -C services/ingestion-service build

WORKDIR /app/services/ingestion-service
EXPOSE 4010
CMD ["node", "dist/index.js"]
