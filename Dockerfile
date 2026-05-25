# korea-finance-mcp — Fly.io 배포용 (HTTP/Streamable transport)
# stdio entry (src/index.ts)는 컨테이너 외부에서 미사용. http entry (src/http.ts) 전용.

# ============================================================
# Stage 1: build
# ============================================================
FROM node:20-alpine AS builder

WORKDIR /app

# 의존성 먼저 (캐시 최적화)
COPY package.json package-lock.json* ./
RUN npm ci

# 소스 복사 + 빌드
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ============================================================
# Stage 2: runtime
# ============================================================
FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

# production 의존성만
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# 빌드 산출물 + 정적 자원
COPY --from=builder /app/dist ./dist
COPY ecos-key-100.json ecos-tables.json* ./

# 비루트 사용자 (보안)
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 8080

# 헬스체크 (Fly.io [http_service.checks]와 일치)
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

# HTTP entry (stdio entry는 사용 안 함)
CMD ["node", "dist/http.js"]
