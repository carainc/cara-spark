import { PrismaClient } from '@prisma/client';

// Single Prisma client (one Postgres + pgvector — OSS single-tenant law). Reused in dev to
// avoid exhausting connections on hot-reload.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
