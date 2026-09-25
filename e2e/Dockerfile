# Playwright with browsers preinstalled; the version must match @playwright/test in package.json.
FROM mcr.microsoft.com/playwright:v1.49.0-noble

WORKDIR /tests
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .

CMD ["npx", "playwright", "test"]
