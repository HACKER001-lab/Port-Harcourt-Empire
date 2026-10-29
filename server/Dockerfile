FROM node:22-alpine

WORKDIR /app

# Dependencies live in the image; source is bind-mounted in development.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src
COPY migrations ./migrations
COPY scripts ./scripts
COPY test ./test

EXPOSE 4000
CMD ["node", "src/app.js"]
