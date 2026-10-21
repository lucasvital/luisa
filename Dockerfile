FROM node:24-alpine
WORKDIR /app
COPY server.js ./
COPY public ./public
ENV DATA_DIR=/data PORT=3000 TZ=America/Sao_Paulo
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
