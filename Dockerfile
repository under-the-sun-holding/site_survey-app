# ============================================================
# Dockerfile  (project root — used by .devcontainer)
#
# Multi-stage build for the Site Survey Express backend.
#
# Stage 1 (builder) — installs all deps and compiles TypeScript.
# Stage 2 (runtime) — copies only the compiled output and
#                     production deps so the image stays lean.
# ============================================================

# ── Stage 1: build ────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
  bash \
  git \
  ca-certificates \
  wget \
  unzip \
  openjdk-17-jre-headless \
  && rm -rf /var/lib/apt/lists/*

# Copy dependency manifests first for layer-caching
COPY backend/package.json backend/package-lock.json ./

# Install ALL deps (including devDeps such as typescript / ts-jest)
RUN npm ci

# Copy the source tree and compile
COPY backend/tsconfig.json ./
COPY backend/src/ ./src/

RUN npm run build

# ── Stage 2: runtime ─────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
  bash \
  git \
  ca-certificates \
  wget \
  && rm -rf /var/lib/apt/lists/*

# Only copy production-relevant manifests
COPY backend/package.json backend/package-lock.json ./

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
