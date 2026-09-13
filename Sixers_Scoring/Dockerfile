FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=10000 DATA_PATH=/var/data
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
EXPOSE 10000
CMD ["node", "server/index.mjs"]
