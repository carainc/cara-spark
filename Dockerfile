# syntax=docker/dockerfile:1
# Next.js (standalone) app image. node:22-slim (glibc) for reliable Prisma engine support.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# build script = prisma generate && next build (output: standalone)
RUN pnpm build

FROM base AS run
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/db ./db
# Ensure the generated Prisma client + engine are present for the standalone server.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client
EXPOSE 3000
CMD ["node", "server.js"]
