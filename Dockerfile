# =============================================================================
#  Web Agent Bridge — Production Dockerfile
#  Multi-stage build for minimal, secure image
#  License: MIT (Open Source)
# =============================================================================

# ── Stage 1: Build (compile native addons) ────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /build

# Install build tools for better-sqlite3 native addon
RUN apk add --no-cache python3 make g++

# Copy package files first (layer cache optimization)
COPY package*.json ./

# Install ALL dependencies (including dev for build)
RUN npm ci

# Copy source
COPY . .

# Rebuild native addons for target platform
RUN npm rebuild better-sqlite3

# Prune dev dependencies
RUN npm prune --omit=dev

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:20-alpine AS production

LABEL org.opencontainers.image.title="Web Agent Bridge"
LABEL org.opencontainers.image.description="Open-source middleware bridging AI agents and websites"
LABEL org.opencontainers.image.url="https://github.com/abokenan444/web-agent-bridge"
LABEL org.opencontainers.image.source="https://github.com/abokenan444/web-agent-bridge"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.version="3.2.0"

# Install runtime dependencies only
RUN apk add --no-cache \
    libstdc++ \
    dumb-init \
    curl \
    && addgroup -g 1001 -S wab \
    && adduser -u 1001 -S wab -G wab

WORKDIR /app

# Copy built artifacts from builder stage
COPY --from=builder --chown=wab:wab /build/node_modules ./node_modules
COPY --chown=wab:wab . .

# Create data directory with correct permissions
RUN mkdir -p /data && chown wab:wab /data

# Switch to non-root user
USER wab

# Environment
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fs http://localhost:3000/api/wab/ping | grep -q '"status":"ok"' || exit 1

# Use dumb-init to handle PID 1 signals properly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "server/index.js"]
