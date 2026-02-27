FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY agent.ts run.ts tsconfig.json ./
CMD ["npx", "tsx", "run.ts"]
