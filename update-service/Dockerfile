FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js company-skills.js v11-platform.js v11-store.js ./
COPY public ./public
COPY scripts ./scripts

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.js"]
