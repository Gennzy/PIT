FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 TZ=Europe/Moscow
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node pit ./pit
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "server/server.js"]
