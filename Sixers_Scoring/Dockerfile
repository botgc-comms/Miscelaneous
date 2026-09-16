FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY LeagueHub/package*.json ./
RUN npm ci --include=dev
COPY LeagueHub/ .
RUN npm run build:render

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=10000 DATA_DIR=/var/data/golfsixes-league GOLFSIXES_TARGET=node
ENV GOLFSIXES_PUBLIC_ORIGIN=https://golfsixesleague.co.uk
ENV EMAIL_SMOKE_TEST_ID=golfsixes-live-launch-20260916
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts/deployment ./scripts/deployment
EXPOSE 10000
CMD ["node", "scripts/deployment/start-render.mjs"]

