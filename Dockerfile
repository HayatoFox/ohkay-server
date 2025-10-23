# Multi-stage build for optimized image size
FROM node:22-slim AS builder

WORKDIR /app

# Install build dependencies for native modules (mediasoup)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    make \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install ALL dependencies (including devDependencies for TypeScript build)
RUN npm ci --verbose

# Copy source code
COPY src ./src

# Build TypeScript using npx to ensure tsc is found
RUN npx tsc

# Production stage
FROM node:22-slim

WORKDIR /app

# Install runtime dependencies for mediasoup
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    make \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev --verbose && npm cache clean --force

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Create logs directory
RUN mkdir -p /app/logs && chown -R node:node /app

# Use non-root user
USER node

# Expose port
EXPOSE 8100

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8100/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application
CMD ["node", "dist/index.js"]
