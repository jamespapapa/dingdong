FROM node:24.18.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ && rm -rf /var/lib/apt/lists/*
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
RUN npm install -g openclaw@2026.9.7 --omit=dev --no-audit --no-fund
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=5490 DINGDONG_DATA_DIR=/data
EXPOSE 5490
CMD ["npm", "start"]
