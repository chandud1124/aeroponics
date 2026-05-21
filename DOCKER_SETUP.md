# Docker Setup Guide

## Overview
The project is containerized for easy local development and deployment.

## Prerequisites
- Docker Desktop (https://www.docker.com/products/docker-desktop)
- Docker Compose (comes with Docker Desktop)

## Quick Start

### Development (Hot Reload)
```bash
# Start development server with hot module reloading
docker-compose -f docker-compose.dev.yml up

# The app will be available at http://localhost:8080
```

### Production Build
```bash
# Build and run production version
docker-compose up --build

# The app will be available at http://localhost:8080
```

### Stop Containers
```bash
# Stop the running container
docker-compose down

# Remove all containers and volumes (clean slate)
docker-compose down -v
```

## Environment Configuration

### Setup Environment Variables
1. Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```

2. Update `.env.local` with your actual Supabase credentials:
   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=your_anon_key
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_PUBLISHABLE_KEY=your_anon_key
   ```

## Supabase Configuration

### Option 1: Use Cloud Supabase (Recommended)
1. Create a free account at https://supabase.com
2. Create a new project
3. Get your URL and Anon Key from project settings
4. Add them to `.env.local`

### Option 2: Local Supabase Stack
For a complete self-hosted setup:
```bash
# Install Supabase CLI
brew install supabase/tap/supabase

# Start Supabase locally
supabase start

# Get your local credentials and add to .env.local
```

## Debugging

### View Container Logs
```bash
# Development
docker-compose -f docker-compose.dev.yml logs -f

# Production
docker-compose logs -f
```

### Access Container Shell
```bash
# Development
docker exec -it smart-tower-garden-dev sh

# Production
docker exec -it smart-tower-garden sh
```

### Rebuild Container
```bash
docker-compose -f docker-compose.dev.yml up --build --no-cache
```

## Deployment

### Deploy to Cloud Platforms

**AWS ECS:**
```bash
# Tag image for ECR
docker tag smart-tower-garden:latest your-account.dkr.ecr.region.amazonaws.com/smart-tower-garden:latest

# Push to ECR
docker push your-account.dkr.ecr.region.amazonaws.com/smart-tower-garden:latest
```

**Google Cloud Run:**
```bash
# Build and push
docker buildx build --platform linux/amd64 -t gcr.io/your-project/smart-tower-garden .
docker push gcr.io/your-project/smart-tower-garden
```

**Heroku:**
```bash
heroku container:push web
heroku container:release web
```

## Ports
- **8080**: Web application (dashboard)
- API endpoints available at `/api/*` paths

## Performance Notes
- Development container uses hot module reloading for fast iterations
- Production container builds optimized bundles (~343KB gzipped client, ~1MB server)
- Both use Alpine Linux for minimal image size

## Troubleshooting

**Port 8080 already in use:**
```bash
# Change port in docker-compose.yml
# Or kill process using 8080
lsof -ti:8080 | xargs kill -9
```

**Environment variables not loading:**
- Ensure `.env.local` exists in project root
- Check `env_file` section in docker-compose.yml points to correct file
- Restart container: `docker-compose down && docker-compose up`

**Network issues:**
```bash
# Inspect network
docker network inspect smart-tower-garden-main_tower-network

# Rebuild network
docker network prune
docker-compose down && docker-compose up
```
