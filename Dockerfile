FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js mensagemDao.js anexoDao.js ./
COPY public ./public

EXPOSE 8081

CMD ["node", "server.js"]
