# 🔧 Troubleshooting Guide

Common issues and solutions for EcoManage.

---

## Installation & Setup

### Issue: `npm install` fails

**Symptoms**:
```
npm ERR! code ERESOLVE
npm ERR! ERESOLVE unable to resolve dependency tree
```

**Solutions**:
```bash
# Clear npm cache
npm cache clean --force

# Use legacy peer deps
npm install --legacy-peer-deps

# Delete node_modules and lock file
rm -rf node_modules package-lock.json
npm install

# Use Node 18+ (required)
node --version  # Should be v18+
nvm use 18
```

---

### Issue: Docker won't start

**Symptoms**:
```
docker: unknown server OS: (empty).
Error: No such image: ecomanage-server
```

**Solutions**:
```bash
# Start Docker daemon
docker daemon

# On Mac/Windows, restart Docker Desktop
# Restart Docker: Docker Desktop → Preferences → Reset

# Verify Docker is running
docker ps

# Build images
docker compose build

# Remove conflicting images
docker rmi ecomanage-server:latest
```

---

### Issue: Port 3000 or 5173 already in use

**Symptoms**:
```
Error: listen EADDRINUSE: address already in use :::3000
```

**Solutions**:
```bash
# Find process using port
lsof -i :3000
lsof -i :5173

# Kill process
kill -9 <PID>

# Or change port in docker-compose.yml
ports:
  - "3001:3000"  # Change 3000 to 3001
```

---

## Database Issues

### Issue: MongoDB connection fails

**Symptoms**:
```
MongoServerError: connect ECONNREFUSED 127.0.0.1:27017
```

**Solutions**:
```bash
# Verify MongoDB is running
docker compose ps

# Start MongoDB
docker compose up mongodb -d

# Check connection string
echo $DATABASE_URL

# Test connection
mongosh mongodb://localhost:27017

# If using MongoDB Atlas
# - Check IP whitelist in Atlas console
# - Verify connection string format
# - Check username/password
```

### Issue: Database seed fails

**Symptoms**:
```
Error: no documents in result
MongoParseError: connect ECONNREFUSED
```

**Solutions**:
```bash
# Ensure MongoDB is running
docker compose up mongodb -d
docker compose up server -d

# Wait for MongoDB to be ready (30 seconds)
sleep 30

# Run seed script
cd server
npm run seed

# Check seed data
mongosh
use ecomanage
db.users.findOne()
```

### Issue: "User already exists" error when seeding

**Symptoms**:
```
E11000 duplicate key error
```

**Solutions**:
```bash
# Reset database (clears all data)
cd server
npm run db:reset

# Or manually drop collection
mongosh
use ecomanage
db.users.deleteMany({})

# Then reseed
npm run seed
```

---

## Backend Issues

### Issue: Server won't start

**Symptoms**:
```
Error: Cannot find module 'express'
server is not running
```

**Solutions**:
```bash
# Check dependencies installed
cd server && npm list

# Reinstall if needed
npm install

# Check for missing .env file
cd server && cp .env.example .env

# Verify .env has required variables
echo $JWT_SECRET

# Check Node.js version
node --version  # Should be v18+

# Check for port conflicts
lsof -i :3000
```

### Issue: JWT authentication fails

**Symptoms**:
```
Error: Invalid token
401 Unauthorized
```

**Solutions**:
```bash
# Check token in headers
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/dashboard/overview

# Verify JWT_SECRET is set
echo $JWT_SECRET

# Regenerate token (login again)
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@ecomanage.io","password":"Demo1234!"}'

# Check token expiry
npm install -g jwt-cli
jwt decode <token>
```

### Issue: API returns 404

**Symptoms**:
```
404 Not Found
Cannot POST /api/devices
```

**Solutions**:
```bash
# Check route exists
# - Look in server/src/routes/*.ts
# - Verify route is registered in app.ts

# Check request method
# - GET vs POST vs PUT vs DELETE

# Verify API URL
curl -v http://localhost:3000/api/devices

# Check middleware order
# - Middleware should be registered before routes

# Look at server logs
docker compose logs server
```

---

## Frontend Issues

### Issue: Frontend won't start

**Symptoms**:
```
error when starting dev server:
Error: ENOENT: no such file or directory
```

**Solutions**:
```bash
# Check dependencies
cd client && npm list

# Reinstall
npm install

# Clear vite cache
rm -rf .vite
npm run dev

# Check Node version
node --version  # Should be v18+

# Check for port conflicts
lsof -i :5173
```

### Issue: Can't connect to backend API

**Symptoms**:
```
Error: Failed to fetch
CORS policy: No 'Access-Control-Allow-Origin' header
```

**Solutions**:
```bash
# Check backend is running
curl http://localhost:3000/api/dashboard/overview

# Check CORS configuration in server
# - Look for CORS middleware in app.ts
# - Should allow http://localhost:5173 in development

# Check API URL in frontend
echo $VITE_API_URL

# Try without CORS (development only)
# Open browser DevTools → Network tab → Check request headers

# Verify request includes Authorization header
Authorization: Bearer <token>
```

### Issue: Components not rendering

**Symptoms**:
```
Blank page
Content of Service Worker
No errors in console
```

**Solutions**:
```bash
# Clear browser cache
# - Chrome: DevTools → Application → Clear Storage

# Disable service worker
// Comment out in main.tsx
// registerServiceWorker();

# Check React errors in console
# - Open DevTools → Console

# Verify component imports
import { Dashboard } from '@/pages/Dashboard'  // Correct
import Dashboard from '@/pages/Dashboard'      // Wrong (if exported as named export)

# Check for TypeScript errors
npm run type-check

# Rebuild frontend
npm run build

# Try in different browser
```

### Issue: Authentication token not persisting

**Symptoms**:
```
Logged out after page refresh
Tokens not in localStorage
```

**Solutions**:
```bash
# Check localStorage in DevTools
# - Right-click → Inspect → Application → Local Storage

# Verify AuthContext saves tokens
// In AuthContext.tsx
localStorage.setItem('accessToken', token)

# Check browser storage settings
// Some browsers/extensions clear localStorage on exit

# Look for errors in console
// Token might be invalid or null

# Test localStorage manually
localStorage.setItem('test', 'value')
localStorage.getItem('test')
localStorage.removeItem('test')
```

---

## Testing Issues

### Issue: Tests fail locally but pass in CI

**Symptoms**:
```
FAIL: Jest tests timeout
FAIL: Playwright tests fail on element not found
```

**Solutions**:
```bash
# Check Node version (CI may use different version)
node --version

# Increase test timeout
jest.setTimeout(10000)  // 10 seconds

# Update snapshots if needed
npm test -- -u

# Run tests sequentially (not parallel)
npm test -- --runInBand

# Check for flaky tests
npm test -- --forceExit

# Run tests multiple times
for i in {1..5}; do npm test; done
```

### Issue: E2E tests fail intermittently

**Symptoms**:
```
Timeout waiting for element
Element not found
```

**Solutions**:
```bash
# Increase timeout
test('should load', async ({ page }) => {
  // timeout: 30000  // 30 seconds
}, { timeout: 30000 })

# Use explicit waits
await page.waitForURL('/dashboard')
await page.waitForLoadState('networkidle')

# Check selector reliability
// ❌ Brittle
page.locator('.btn-xyz-123')

// ✅ Resilient
page.getByRole('button', { name: /submit/i })

# Run in headed mode to debug
npm run test:headed

# Enable trace for failures
npm test -- --trace on
```

### Issue: Tests pass but coverage is low

**Symptoms**:
```
Coverage below threshold
Lines not covered
```

**Solutions**:
```bash
# Generate coverage report
npm run test:cov

# View coverage HTML
open coverage/lcov-report/index.html

# Add tests for uncovered lines
// Write additional tests targeting low coverage areas

# Check coverage config
// Jest config in package.json or jest.config.js
// Playwright config in playwright.config.ts
```

---

## Performance Issues

### Issue: Dashboard loads slowly

**Symptoms**:
```
Page takes 5+ seconds to load
High CPU usage
```

**Solutions**:
```bash
# Check Network tab in DevTools
// - API responses might be slow

// Profile performance
npm run build

// Check bundle size
npm install -g vite-plugin-visualizer

// Optimize images
// Compress PNG/JPG files

// Enable code splitting
// React lazy loading

// Check database queries
// Look at MongoDB indexes

// Monitor server logs
docker compose logs server -f
```

### Issue: High memory usage

**Symptoms**:
```
Process memory growing
Application crashes after running for hours
```

**Solutions**:
```bash
# Check Node process memory
ps aux | grep node

# Monitor with Docker
docker stats

# Enable heap snapshots
node --inspect app.ts

# Check for memory leaks
// Look for objects not being garbage collected

// Profile with Chrome DevTools
// chrome://inspect

# Restart process periodically
// Add to cron for daily restart
0 2 * * * docker restart ecomanage-server
```

---

## Network Issues

### Issue: Can't connect to remote database

**Symptoms**:
```
ECONNREFUSED
Connection timeout
```

**Solutions**:
```bash
# Test connectivity
mongosh --uri=$DATABASE_URL

# Check firewall rules
// AWS Security Group, GCP Firewall, etc.
// Allow inbound on port 27017 from your IP

# Verify connection string format
// mongodb+srv://user:password@cluster.mongodb.net/database

# Check MongoDB Atlas IP whitelist
// https://cloud.mongodb.com/v2/xxx/security/network/access

# Test DNS resolution
nslookup cluster.mongodb.net
```

---

## Git & Version Control Issues

### Issue: Merge conflicts

**Symptoms**:
```
CONFLICT: Merge conflict in file.ts
```

**Solutions**:
```bash
# Update branch with upstream
git fetch upstream
git rebase upstream/main

# Resolve conflicts manually
# Edit conflicting files and remove markers:
# <<<<<<<
# =======
# >>>>>>>

# Stage resolved files
git add <file>

# Continue rebase
git rebase --continue

# Or abort if too complex
git rebase --abort
```

### Issue: Committed secret/password

**Symptoms**:
```
Accidentally committed .env file or API key
```

**Solutions**:
```bash
# Remove file from Git history (use git-filter-repo)
brew install git-filter-repo
git filter-repo --path .env --invert-paths

# Rotate secrets immediately!
// Change API keys, passwords, tokens

# Add to .gitignore
echo ".env" >> .gitignore
git add .gitignore
git commit -m "Add .env to gitignore"

# Force push (carefully!)
git push --force-with-lease
```

---

## Deployment Issues

### Issue: Services won't start in production

**Symptoms**:
```
Error: Cannot connect to MongoDB
Service keeps restarting
```

**Solutions**:
```bash
# Check logs
docker compose logs -f server

# Verify environment variables
docker compose exec server env | grep DATABASE_URL

# Test database connection
docker compose exec server curl mongosh $DATABASE_URL

# Verify image exists
docker image ls

# Recreate services
docker compose down
docker compose up -d
```

---

## Getting Help

If your issue isn't listed:

1. **Check logs first**:
   ```bash
   docker compose logs -f
   docker compose logs server
   docker compose logs client
   ```

2. **Enable debug mode**:
   ```bash
   DEBUG=* npm run dev
   LOG_LEVEL=debug npm start
   ```

3. **Report issue on GitHub**:
   - Include error messages
   - Provide reproduction steps
   - Share system info (OS, Node version, Docker version)

4. **Contact support**:
   - Email: support@ecomanage.io
   - Slack: #ecomanage-support (coming soon)

---

## Related Documents

- [Deployment Guide](./DEPLOYMENT.md)
- [Testing Guide](./TESTING.md)
- [Architecture Overview](./ARCHITECTURE.md)

---

[⬆ Back to Top](#-troubleshooting-guide)
