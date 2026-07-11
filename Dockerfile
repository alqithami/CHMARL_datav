FROM node:20-slim AS build
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
COPY package.json ./
RUN pnpm install --no-frozen-lockfile
COPY . .
ENV VITE_VESSEL_DATA_URL=/api/vessels
ENV VITE_VESSEL_FETCH_INTERVAL_MS=15000
ENV VITE_CHMARL_EXPERIMENT_URL=/api/chmarl/episode
ENV VITE_PORT_EVENTS_URL=/api/port-events
ENV VITE_PORT_EVENTS_DEMO_ENABLED=false
ENV VITE_WEATHER_URL=/api/weather
ENV VITE_ALLOW_SAMPLE_DATA=false
ENV VITE_ALLOW_SAMPLE_CHMARL=false
ENV VITE_REQUIRE_OPERATIONAL_REGION=false
RUN pnpm build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
ENV STATIC_DIR=dist
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
COPY package.json ./
RUN pnpm install --prod --no-frozen-lockfile
COPY --from=build /app/dist ./dist
COPY server ./server
COPY scripts/start-prod.mjs ./scripts/start-prod.mjs
EXPOSE 8787
CMD ["node", "scripts/start-prod.mjs"]
