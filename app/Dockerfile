# 构建阶段：编译前端与后端
FROM node:20-alpine AS builder

# 国内/弱网环境可通过 build-arg 切换 registry，默认使用 npmmirror
ARG NPM_REGISTRY=https://registry.npmmirror.com

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm config set registry "${NPM_REGISTRY}" \
  && npm config set fetch-retries 5 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && npm config set fetch-timeout 600000 \
  && npm ci

COPY . .
RUN npm run build

# 运行阶段：生产环境启动
FROM node:20-alpine AS runner

ARG NPM_REGISTRY=https://registry.npmmirror.com

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=29000

COPY package.json package-lock.json ./
RUN npm config set registry "${NPM_REGISTRY}" \
  && npm config set fetch-retries 5 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && npm config set fetch-timeout 600000 \
  && npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/db ./db

RUN mkdir -p uploads

EXPOSE 29000

CMD ["node", "dist/boot.js"]
