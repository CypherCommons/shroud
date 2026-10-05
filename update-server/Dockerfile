FROM node:22-alpine

WORKDIR /app
COPY server.mjs ./

# Reads DATA_DIR only; mount it read-only (see README.md).
ENV DATA_DIR=/data PORT=3000
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "server.mjs"]
