# 🤝 Contributing Guide

Thank you for your interest in contributing to EcoManage! This document provides guidelines and instructions for contributing.

---

## Code of Conduct

We are committed to providing a welcoming and inspiring community for all. Please read and follow our Code of Conduct:

- Be respectful and inclusive
- Welcome diverse perspectives
- Focus on constructive criticism
- Report inappropriate behavior to maintainers

---

## Getting Started

### 1. Fork & Clone

```bash
# Fork the repository on GitHub
# Clone your fork
git clone https://github.com/YOUR_USERNAME/EcoManage.git
cd EcoManage

# Add upstream remote
git remote add upstream https://github.com/e-choness/EcoManage.git
```

### 2. Setup Development Environment

```bash
# Install dependencies
cd server && npm install
cd ../client && npm install
cd ../e2e && npm install

# Setup environment variables
cd server && cp .env.example .env

# Start services
docker compose up

# Run tests to verify setup
npm test (in each directory)
```

### 3. Create Feature Branch

```bash
# Fetch latest changes
git fetch upstream

# Create feature branch from main
git checkout -b feature/your-feature-name upstream/main
```

---

## Development Workflow

### Code Style

#### TypeScript/JavaScript

```typescript
// ✅ GOOD: Clear, readable, typed
const calculateSavings = (production: number, costPerKwh: number): number => {
  return production * costPerKwh;
};

// ❌ BAD: Unclear, no types
const calc = (prod, cost) => prod * cost;
```

#### Formatting

```bash
# Check code style
npm run lint

# Auto-fix issues
npm run lint:fix

# Format code
npm run format
```

#### Comments

```typescript
// ✅ GOOD: Explains WHY, not WHAT
// We use UTC to avoid timezone issues in global deployment
const date = new Date();

// ❌ BAD: Obvious from code
// Get the current date
const date = new Date();
```

### Git Commit Messages

**Format**: `type(scope): subject`

```
feat(auth): add JWT refresh token mechanism
fix(dashboard): resolve data loading race condition
docs(api): update endpoint documentation
test(devices): add unit tests for device model
refactor(services): extract common validation logic
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `test`: Test additions/changes
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `chore`: Build, CI, dependencies

**Guidelines**:
- Use imperative mood ("add" not "added")
- Don't capitalize first letter
- Keep subject under 50 characters
- Add detailed description after blank line
- Reference issues: "fixes #123"

### Example

```
feat(analytics): add LLM-powered insights

- Integrate Claude API for data analysis
- Add insights endpoint to analytics route
- Cache insights for 24 hours
- Add tests for insight generation

Fixes #45
```

---

## Testing Requirements

### Before Submitting PR

All changes must include tests:

```bash
# Backend tests
cd server && npm test

# Frontend tests
cd client && npm test

# E2E tests (manual, required for UI changes)
cd e2e && npm test
```

### Test Coverage

- **Backend**: Minimum 80% coverage
- **Frontend**: Minimum 75% coverage
- **E2E**: All user-facing changes tested

### Writing Tests

#### Backend (Jest)

```typescript
describe('DevicesService', () => {
  describe('getDevices', () => {
    it('should return all devices for a user', async () => {
      // Arrange
      const userId = 'user123';
      const mockDevices = [{ _id: 'dev1', name: 'Solar Panel' }];
      jest.spyOn(Device, 'find').mockResolvedValue(mockDevices);

      // Act
      const result = await devicesService.getDevices(userId);

      // Assert
      expect(result).toEqual(mockDevices);
      expect(Device.find).toHaveBeenCalledWith({ userId });
    });
  });
});
```

#### Frontend (Vitest + React Testing Library)

```typescript
describe('Dashboard', () => {
  it('should display loading state initially', () => {
    render(<Dashboard />);
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });

  it('should display data after loading', async () => {
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText(/Current Power/i)).toBeInTheDocument();
    });
  });
});
```

#### E2E (Playwright)

```typescript
test('user can login and view dashboard', async ({ page }) => {
  // Navigate to login
  await page.goto('/login');

  // Fill form
  await page.fill('input[type="email"]', 'test@example.com');
  await page.fill('input[type="password"]', 'Password123!');

  // Submit
  await page.click('button:has-text("Sign In")');

  // Verify navigation
  await expect(page).toHaveURL('/dashboard');
  await expect(page.locator('text=Dashboard')).toBeVisible();
});
```

---

## Documentation Requirements

### Code Documentation

```typescript
/**
 * Calculate energy savings based on production and cost.
 * 
 * @param production - kWh produced
 * @param costPerKwh - Cost per kilowatt-hour
 * @returns Total savings in currency
 * 
 * @example
 * const savings = calculateSavings(100, 0.12); // $12
 */
export const calculateSavings = (
  production: number,
  costPerKwh: number
): number => {
  return production * costPerKwh;
};
```

### API Documentation

Update `docs/API_REFERENCE.md` for new endpoints:

```markdown
### Get User Profile

\`\`\`http
GET /api/users/profile
Authorization: Bearer <ACCESS_TOKEN>
\`\`\`

**Response** (200 OK)
\`\`\`json
{
  "status": "success",
  "data": { ... }
}
\`\`\`
```

### README Updates

Update relevant sections if adding features or changing setup.

---

## Pull Request Process

### 1. Push Branch

```bash
git push origin feature/your-feature-name
```

### 2. Create Pull Request

**PR Title**: Use same format as commit messages
```
feat(auth): add JWT refresh token mechanism
```

**PR Description**:
```markdown
## Description
Brief explanation of changes.

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [x] Documentation update

## Testing
- [x] Unit tests added
- [x] Integration tests added
- [x] E2E tests added
- [x] All tests passing

## Checklist
- [x] Code follows style guidelines
- [x] No console.log or debugging code
- [x] Updated documentation
- [x] No new warnings generated
- [x] Tested in multiple browsers

## Related Issues
Fixes #123
```

### 3. Code Review

- Respond to reviewer feedback promptly
- Make requested changes in new commits
- Re-request review after changes
- Be open to suggestions and improvements

### 4. Merge

Once approved and all checks pass:
- Maintainer merges PR
- Your branch is deleted
- Your contribution is celebrated 🎉

---

## Project Structure

```
EcoManage/
├── client/                 # Frontend React app
│   ├── src/
│   │   ├── pages/         # Page components
│   │   ├── components/    # Reusable components
│   │   ├── contexts/      # Global state
│   │   ├── api/           # API client
│   │   └── __tests__/     # Tests
│   └── package.json
├── server/                # Backend Node.js app
│   ├── src/
│   │   ├── routes/        # API routes
│   │   ├── controllers/   # Request handlers
│   │   ├── services/      # Business logic
│   │   ├── models/        # Data models
│   │   └── tests/         # Tests
│   └── package.json
├── e2e/                   # End-to-end tests
│   ├── tests/             # Playwright tests
│   └── package.json
└── docs/                  # Documentation
```

---

## Common Tasks

### Adding a New API Endpoint

1. **Create route** in `server/src/routes/`
2. **Create controller** in `server/src/controllers/`
3. **Create service** in `server/src/services/` (business logic)
4. **Add tests** in `server/src/tests/`
5. **Update API docs** in `docs/API_REFERENCE.md`
6. **Update database schema** if needed in `docs/DATABASE.md`

### Adding a New Page

1. **Create component** in `client/src/pages/`
2. **Add route** in `client/src/App.tsx`
3. **Create tests** in `client/src/__tests__/`
4. **Update navigation** in sidebar/header if needed
5. **Add E2E test** in `e2e/tests/`

### Adding a Database Migration

1. **Create migration script** in `server/src/migrations/`
2. **Document changes** in `docs/DATABASE.md`
3. **Test migration** locally
4. **Include rollback** capability

---

## Performance Guidelines

### Frontend
- Keep components small and focused
- Use React.memo for expensive components
- Implement code splitting for large routes
- Optimize images and assets
- Avoid inline functions in render

### Backend
- Use database indexes wisely
- Implement query pagination
- Cache frequently accessed data
- Use connection pooling
- Profile slow endpoints

### General
- Measure before optimizing
- Profile memory usage
- Monitor bundle size
- Test on real devices
- Consider accessibility

---

## Security Guidelines

### Code Security
- Never commit secrets (use .env)
- Validate all user input
- Use parameterized queries (Mongoose handles this)
- Implement rate limiting
- Add CORS properly
- Use HTTPS in production
- Keep dependencies updated

### Dependency Updates

```bash
# Check for outdated packages
npm outdated

# Update packages
npm update

# Update to latest versions
npm install -g npm-check-updates
ncu -u

# Audit for vulnerabilities
npm audit
npm audit fix
```

---

## Getting Help

### Questions or Issues?

- **GitHub Issues**: Report bugs, request features
- **GitHub Discussions**: Ask questions, discuss ideas
- **Email**: contact@ecomanage.io
- **Slack**: Join our community (coming soon)

### Resources

- [Architecture Overview](./ARCHITECTURE.md)
- [API Reference](./API_REFERENCE.md)
- [Testing Guide](./TESTING.md)
- [Deployment Guide](./DEPLOYMENT.md)

---

## Recognition

Contributors are recognized in:
- GitHub contributors page
- CONTRIBUTORS.md file
- Release notes (for significant contributions)

Thank you for contributing! 🚀

---

[⬆ Back to Top](#-contributing-guide)
