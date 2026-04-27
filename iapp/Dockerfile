# NoxGuard iApp — Multi-stage Docker build
# Stage 1: Build TypeScript → JavaScript
# Stage 2: Lean production image (no dev deps)
#
# iExec requires the entrypoint to be /app/start
# and the image to be non-root (UID 1000)

# ── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency files first (layer caching)
COPY package.json tsconfig.json ./

# Install all dependencies including devDeps
RUN npm install --frozen-lockfile

# Copy source
COPY src ./src

# Compile TypeScript
RUN npm run build

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:20-alpine AS production

# Security: run as non-root (iExec requirement)
RUN addgroup -S noxguard && adduser -S noxguard -G noxguard

WORKDIR /app

# Copy only production artifacts
COPY package.json ./
RUN npm install --omit=dev --frozen-lockfile

# Copy compiled JavaScript from builder
COPY --from=builder /app/dist ./dist

# iExec mounts volumes at these paths — create them as non-root
RUN mkdir -p /iexec_in /iexec_out && \
    chown -R noxguard:noxguard /iexec_in /iexec_out /app

# Switch to non-root user
USER noxguard

# iExec entrypoint convention
CMD ["node", "dist/index.js"]
