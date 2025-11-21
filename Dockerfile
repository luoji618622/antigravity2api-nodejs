FROM node:20-alpine AS base
WORKDIR /usr/src/app

# Dependencies Stage
FROM base AS dependencies
COPY package.json package-lock.json* ./
RUN npm ci --only=production

# Production Stage
FROM base AS production
ENV NODE_ENV=production

# Copy node_modules
COPY --from=dependencies /usr/src/app/node_modules ./node_modules

# Copy source code
COPY . .

# Create user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN chown -R appuser:appgroup /usr/src/app

USER appuser

EXPOSE 8045
CMD [ "node", "src/server/index.js" ]
