FROM node:22-alpine

WORKDIR /app

# No npm deps required; keep image minimal
COPY server.js ./server.js
COPY data.json ./data.json
COPY public ./public
COPY admin ./admin
COPY package.json ./package.json

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]

