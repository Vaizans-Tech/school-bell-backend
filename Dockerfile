FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

RUN mkdir -p uploads

EXPOSE 8080

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

CMD ["node", "src/index.js"]
