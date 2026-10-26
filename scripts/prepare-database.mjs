import { PrismaClient } from "@prisma/client";

// Open the database before schema synchronization. In restricted cloud
// runtimes Prisma's schema engine can fail to create a missing SQLite file;
// the query engine creates it normally. SELECT 1 does not change user tables.
const prisma = new PrismaClient();
try {
  await prisma.$queryRaw`SELECT 1`;
} finally {
  await prisma.$disconnect();
}
