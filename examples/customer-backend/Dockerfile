FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY agent.ts tsconfig.json ./
CMD ["npx", "tsx", "agent.ts"]
