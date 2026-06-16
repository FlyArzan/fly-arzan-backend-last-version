# ---- Build stage ----
FROM node:22-slim AS builder
WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install all deps (dev deps needed for tsc + tsc-alias)
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --legacy-peer-deps

# Compile TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Production stage ----
FROM node:22-slim AS runner
WORKDIR /app

# OpenSSL required by Prisma at runtime
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install production deps only (postinstall runs prisma generate)
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev --legacy-peer-deps

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

CMD ["node", "dist/index.js"]
