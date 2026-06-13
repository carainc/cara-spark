# syntax=docker/dockerfile:1
# agent-worker image. Stub today (boots the stack); Lane G builds the LiveKit cascade here.
FROM node:22-slim
WORKDIR /app
COPY worker/ ./worker/
CMD ["node", "worker/index.mjs"]
