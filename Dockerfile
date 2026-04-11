# Build client + compile server (pass VITE_API_KEY so the SPA can call /api/summary)
FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_API_KEY=""
ENV VITE_API_KEY=${VITE_API_KEY}
COPY package.json package-lock.json* ./
RUN npm ci 2>/dev/null || npm install
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/package.json ./
# Default key for local docker only — override in deployment
ENV API_KEY=change-me-in-production
EXPOSE 3001
CMD ["node", "dist-server/server/index.js"]
