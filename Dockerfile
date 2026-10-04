FROM node:24-alpine
WORKDIR /app
COPY simulator-tcp-auth.js .
EXPOSE 8080
CMD ["node", "simulator-tcp-auth.js"]