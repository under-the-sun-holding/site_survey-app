# ============================================================
# backend/Dockerfile
#
# Multi-stage build for the Site Survey Express backend.
#
# Stage 1 (builder) — installs all deps and compiles TypeScript.
# Stage 2 (runtime) — copies only the compiled output and
#                     production deps so the image stays lean.
# ============================================================

# ── Stage 1: build ────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache bash git

# Copy dependency manifests first for layer-caching
COPY package.json package-lock.json ./

# Install ALL deps (including devDeps such as typescript / ts-jest)
RUN npm ci

# Copy the source tree and compile
COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ── Stage 2: runtime ─────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

RUN apk add --no-cache bash git

# Only copy production-relevant manifests
COPY package.json package-lock.json ./

# Install ONLY production deps
RUN npm ci --omit=dev

# Copy compiled output from the builder stage
COPY --from=builder /app/dist ./dist

# Create the uploads directory so multer can write to it
RUN mkdir -p uploads

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "dist/index.js"]
