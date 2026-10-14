# ----------------------------------------------------
# Stage 1: Build stage
# ----------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install dependencies first for optimal Docker layer caching
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy application source code
COPY . .

# Set Nitro preset to node-server and build the application
ENV NITRO_PRESET=node-server
RUN pnpm build

# ----------------------------------------------------
# Stage 2: Production runtime stage
# ----------------------------------------------------
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Copy only the compiled standalone Nitro server and public assets
COPY --from=builder /app/.output ./.output

EXPOSE 3000

# Start the standalone server
CMD ["node", ".output/server/index.mjs"]
