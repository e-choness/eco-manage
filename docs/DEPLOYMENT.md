# 🚀 Deployment Guide

## Prerequisites

- Docker & Docker Compose
- Node.js 18+
- MongoDB (or Docker image)
- Git
- SSL certificate (for HTTPS)

---

## Development Deployment

### Docker Compose (Local)

```bash
# Clone repository
git clone https://github.com/e-choness/EcoManage.git
cd EcoManage

# Start all services
docker compose up

# Verify services
docker compose ps

# Seed database
docker compose exec server npm run seed

# Stop services
docker compose down
```

**Services**:
- Frontend: http://localhost:5173
- Backend: http://localhost:3000
- MongoDB: localhost:27017

---

## Production Deployment

### 1. Environment Configuration

Create `.env` files for production:

**server/.env.production**
```env
# Server
PORT=3000
NODE_ENV=production

# JWT
JWT_SECRET=your_super_secret_long_key_here_min_32_chars
JWT_REFRESH_SECRET=your_refresh_secret_key_here_min_32_chars
JWT_EXPIRY=900
JWT_REFRESH_EXPIRY=604800

# Database
DATABASE_URL=mongodb+srv://user:password@cluster.mongodb.net/ecomanage?retryWrites=true&w=majority

# LLM Service
OPENAI_API_KEY=sk-your-openai-api-key

# CORS & Security
CORS_ORIGIN=https://yourdomain.com
SECURE_COOKIES=true
TRUST_PROXY=1

# Logging
LOG_LEVEL=info
```

**client/.env.production**
```env
VITE_API_URL=https://api.yourdomain.com
VITE_ENV=production
```

### 2. Database Setup

#### Option A: MongoDB Atlas (Recommended)

1. Create cluster at https://www.mongodb.com/cloud/atlas
2. Create database user
3. Configure IP whitelist
4. Get connection string
5. Update DATABASE_URL in .env

#### Option B: Self-Hosted MongoDB

```bash
# Create persistent MongoDB container
docker run -d \
  --name ecomanage-mongo \
  -e MONGO_INITDB_ROOT_USERNAME=admin \
  -e MONGO_INITDB_ROOT_PASSWORD=securepassword \
  -v mongo-data:/data/db \
  -p 27017:27017 \
  mongo:7
```

### 3. Build Docker Images

```bash
# Build all images
docker build -t ecomanage-client ./client
docker build -t ecomanage-server ./server

# Tag for registry
docker tag ecomanage-client your-registry/ecomanage-client:1.0.0
docker tag ecomanage-server your-registry/ecomanage-server:1.0.0

# Push to registry
docker push your-registry/ecomanage-client:1.0.0
docker push your-registry/ecomanage-server:1.0.0
```

### 4. Production Docker Compose

**docker-compose.prod.yml**
```yaml
version: '3.8'

services:
  client:
    image: your-registry/ecomanage-client:1.0.0
    ports:
      - "80:5173"
    environment:
      - VITE_API_URL=https://api.yourdomain.com
    restart: always
    networks:
      - ecomanage-network

  server:
    image: your-registry/ecomanage-server:1.0.0
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - DATABASE_URL=${DATABASE_URL}
      - JWT_SECRET=${JWT_SECRET}
      - JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
    restart: always
    networks:
      - ecomanage-network
    depends_on:
      - mongodb

  mongodb:
    image: mongo:7
    environment:
      - MONGO_INITDB_ROOT_USERNAME=${MONGO_USER}
      - MONGO_INITDB_ROOT_PASSWORD=${MONGO_PASSWORD}
    volumes:
      - mongo-data:/data/db
    restart: always
    networks:
      - ecomanage-network

networks:
  ecomanage-network:
    driver: bridge

volumes:
  mongo-data:
```

### 5. SSL/TLS Setup with Nginx

**nginx.conf**
```nginx
upstream backend {
  server server:3000;
}

upstream frontend {
  server client:5173;
}

# Redirect HTTP to HTTPS
server {
  listen 80;
  server_name yourdomain.com www.yourdomain.com;
  return 301 https://$server_name$request_uri;
}

# HTTPS configuration
server {
  listen 443 ssl http2;
  server_name yourdomain.com www.yourdomain.com;

  # SSL certificates
  ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

  # Security headers
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "SAMEORIGIN" always;
  add_header X-XSS-Protection "1; mode=block" always;

  # Gzip compression
  gzip on;
  gzip_min_length 1000;
  gzip_proxied any;
  gzip_types text/plain text/css text/xml text/javascript 
             application/x-javascript application/xml+rss 
             application/json application/javascript;

  # Frontend
  location / {
    proxy_pass http://frontend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
  }

  # API
  location /api/ {
    proxy_pass http://backend;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # CORS headers
    add_header 'Access-Control-Allow-Origin' 'https://yourdomain.com' always;
    add_header 'Access-Control-Allow-Credentials' 'true' always;
  }
}
```

### 6. Deploy with Docker Compose

```bash
# Start production stack
docker compose -f docker-compose.prod.yml up -d

# View logs
docker compose -f docker-compose.prod.yml logs -f

# Seed production database
docker compose -f docker-compose.prod.yml exec server npm run seed:prod

# Stop services
docker compose -f docker-compose.prod.yml down
```

---

## Cloud Platform Deployment

### AWS Elastic Container Service (ECS)

1. **Create ECR repositories**
   ```bash
   aws ecr create-repository --repository-name ecomanage-client
   aws ecr create-repository --repository-name ecomanage-server
   ```

2. **Push images to ECR**
   ```bash
   aws ecr get-login-password | docker login --username AWS --password-stdin [YOUR_ACCOUNT_ID].dkr.ecr.[REGION].amazonaws.com
   docker tag ecomanage-client:1.0.0 [YOUR_ACCOUNT_ID].dkr.ecr.[REGION].amazonaws.com/ecomanage-client:1.0.0
   docker push [YOUR_ACCOUNT_ID].dkr.ecr.[REGION].amazonaws.com/ecomanage-client:1.0.0
   ```

3. **Create ECS task definitions and services**
4. **Configure load balancer**
5. **Enable auto-scaling**

### Google Cloud Run

```bash
# Deploy backend to Cloud Run
gcloud run deploy ecomanage-server \
  --image gcr.io/PROJECT_ID/ecomanage-server:1.0.0 \
  --platform managed \
  --region us-central1 \
  --set-env-vars DATABASE_URL=$DATABASE_URL,JWT_SECRET=$JWT_SECRET

# Deploy frontend to Cloud Run
gcloud run deploy ecomanage-client \
  --image gcr.io/PROJECT_ID/ecomanage-client:1.0.0 \
  --platform managed \
  --region us-central1
```

### Heroku

```bash
# Login
heroku login

# Create apps
heroku create ecomanage-server
heroku create ecomanage-client

# Set environment variables
heroku config:set -a ecomanage-server DATABASE_URL=...
heroku config:set -a ecomanage-server JWT_SECRET=...

# Deploy
git push heroku main
```

---

## Monitoring & Logging

### Application Monitoring

```bash
# Monitor resource usage
docker stats

# View application logs
docker compose logs -f server
docker compose logs -f client

# Structured logging (optional)
npm install winston pino
```

### Database Monitoring

```bash
# Connect to MongoDB
mongosh

# Check database stats
db.stats()

# Check collection sizes
db.devices.stats()

# Check indexes
db.devices.getIndexes()
```

### Performance Monitoring

```bash
# Application Performance Monitoring (APM)
npm install elastic-apm-node  # For Elastic APM
npm install newrelic          # For New Relic

# Monitor uptime and availability
# - Uptime Robot
# - New Relic Synthetics
# - DataDog Synthetic Monitoring
```

---

## Scaling Strategies

### Horizontal Scaling

1. **Load Balancer**: Distribute traffic across multiple server instances
2. **Database Replication**: MongoDB replica set for high availability
3. **CDN**: Serve static assets from edge locations

### Vertical Scaling

1. **Increase container resources**: CPU, memory limits
2. **Database optimization**: Indexes, query optimization
3. **Caching layer**: Redis for frequently accessed data

---

## Backup & Disaster Recovery

### Database Backups

```bash
# Daily automated backup
0 2 * * * mongodump --uri=mongodb+srv://user:pass@cluster/ecomanage --archive=/backups/ecomanage-$(date +\%Y\%m\%d).archive --gzip

# Restore from backup
mongorestore --archive=/backups/ecomanage-20240507.archive --gzip
```

### Backup Strategy

- **Frequency**: Daily backups
- **Retention**: 30 days local, 90 days offsite
- **Testing**: Monthly restore tests
- **Geographic**: Multi-region backup replication

---

## Security Checklist

- [ ] SSL/TLS certificates configured
- [ ] HTTPS enforced (redirect HTTP)
- [ ] Strong JWT secrets (min 32 chars)
- [ ] Database authentication enabled
- [ ] Environment variables not in git
- [ ] CORS properly configured
- [ ] Rate limiting enabled
- [ ] Security headers configured
- [ ] Input validation on all endpoints
- [ ] SQL injection prevention (Mongoose ODM)
- [ ] XSS protection enabled
- [ ] Regular security updates

---

## Post-Deployment

### 1. Verify Services

```bash
# Check health endpoints
curl https://yourdomain.com/api/health
curl https://yourdomain.com/

# Verify SSL certificate
openssl s_client -connect yourdomain.com:443
```

### 2. Run Smoke Tests

```bash
# E2E tests against production
npm run test:e2e -- --baseURL=https://yourdomain.com
```

### 3. Monitor Performance

```bash
# Check response times
curl -w "@curl-format.txt" -o /dev/null -s https://yourdomain.com/api/dashboard/overview

# Monitor with tools
# - Datadog
# - Prometheus
# - Grafana
```

### 4. Setup Alerts

- Database connection failures
- High error rates
- Slow API responses
- Server resource exhaustion
- Certificate expiry

---

## Troubleshooting Deployment

### Service Won't Start

```bash
# Check logs
docker compose logs server

# Check configuration
echo $DATABASE_URL
echo $JWT_SECRET

# Verify network connectivity
docker exec ecomanage-server ping mongodb
```

### Database Connection Failed

```bash
# Test connection
mongosh $DATABASE_URL

# Verify credentials
# Check IP whitelist (if MongoDB Atlas)
# Check firewall rules
```

### High Memory Usage

```bash
# Check process memory
docker stats

# Optimize Node.js heap
NODE_OPTIONS=--max-old-space-size=512 npm start

# Profile memory leaks
node --inspect app.js
```

---

## Performance Optimization

### Frontend Optimization

```bash
# Build optimization
npm run build

# Analyze bundle size
npm install -g vite-plugin-visualizer

# Enable compression
gzip on;  # In Nginx config
```

### Backend Optimization

```bash
# Enable clustering
npm install pm2 -g
pm2 start server/app.ts -i max

# Database query optimization
db.users.createIndex({ email: 1 })
db.devices.createIndex({ userId: 1 })
```

---

## Version Management

### Release Process

1. **Tag version**: `git tag v1.0.0`
2. **Build images**: `docker build -t ecomanage:1.0.0 .`
3. **Push to registry**: `docker push ecomanage:1.0.0`
4. **Deploy**: Update docker-compose version and redeploy

### Rollback

```bash
# Revert to previous version
docker compose -f docker-compose.prod.yml up -d ecomanage-server:0.9.9
```

---

## Related Documents

- [Architecture Overview](./ARCHITECTURE.md)
- [API Reference](./API_REFERENCE.md)
- [Troubleshooting](./TROUBLESHOOTING.md)

---

[⬆ Back to Top](#-deployment-guide)
