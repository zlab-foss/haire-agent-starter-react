# Multi-stage Dockerfile for Next.js (Node 18 + pnpm)
# Builds the app in a lightweight builder stage and produces a minimal runtime image.

### Builder
FROM node:18-bullseye-slim AS builder
WORKDIR /app

# Install build-time dependencies (pnpm via corepack) and cache installs
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
RUN pnpm install --frozen-lockfile

# Copy the rest of the sources and build
COPY . .
RUN pnpm build

### Runner
FROM node:18-bullseye-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Optional: enable corepack/pnpm in runtime if you prefer using 'pnpm start'
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate || true

# Copy only what's needed to run the built app
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000

# Start the Next.js server, binding to 0.0.0.0
CMD ["pnpm", "start"]
