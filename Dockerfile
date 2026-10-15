# syntax=docker/dockerfile:1.7
# Folio 一体化镜像：构建前端静态文件，由 Node 服务端同时提供 API 与页面。

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
COPY packages/render/package.json packages/render/
COPY packages/ai/package.json packages/ai/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter "!@folio/mobile"

FROM deps AS build
COPY . .
RUN pnpm --filter @folio/web build

FROM base AS runtime
# ffmpeg 用于视频概览合成；不需要时可删掉这一行以缩小镜像
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=8787 \
    FOLIO_DATA_DIR=/data \
    FOLIO_WEB_DIST=/app/apps/web/dist
COPY --from=build /app /app
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@folio/server", "start"]
