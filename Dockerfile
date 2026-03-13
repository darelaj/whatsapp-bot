# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install native build tools for sharp + git (required by some npm deps)
RUN apk add --no-cache python3 make g++ ffmpeg git

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Runtime stage
FROM node:20-alpine

WORKDIR /app

# ffmpeg is required for animated sticker conversion
RUN apk add --no-cache ffmpeg

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app .

# Auth session is persisted via a volume mounted at /app/auth_info_baileys
VOLUME ["/app/auth_info_baileys"]

ENV NODE_ENV=production

CMD ["node", "bot.js"]
