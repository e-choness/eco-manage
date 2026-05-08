FROM mcr.microsoft.com/playwright:v1.49.0-noble

WORKDIR /tests

COPY package*.json ./
RUN npm install

COPY . .

CMD ["npm", "run", "test"]
