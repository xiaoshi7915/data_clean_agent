# 构建阶段：编译前端与后端
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# 运行阶段：生产环境启动
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=29000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/db ./db

RUN mkdir -p uploads

EXPOSE 29000

CMD ["node", "dist/boot.js"]
