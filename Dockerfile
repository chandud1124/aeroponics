# Multi-stage build for production
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Copy environment file
COPY .env.local .env 2>/dev/null || true

# Build with environment variables from build args
ARG VITE_SUPABASE_URL=http://localhost:3000
ARG VITE_SUPABASE_PUBLISHABLE_KEY=
ARG SUPABASE_URL=http://localhost:3000
ARG SUPABASE_PUBLISHABLE_KEY=

ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY}
ENV SUPABASE_URL=${SUPABASE_URL}
ENV SUPABASE_PUBLISHABLE_KEY=${SUPABASE_PUBLISHABLE_KEY}

# Build the application
RUN npm run build

# Production runtime
FROM node:20-alpine

WORKDIR /app

# Install serve to run the built app
RUN npm install -g serve

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Expose port
EXPOSE 8080

# Start command
CMD ["serve", "-s", "dist/client", "-l", "8080"]
