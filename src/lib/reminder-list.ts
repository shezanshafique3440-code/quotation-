import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

export type ReminderGroup = "overdue" | "upcoming" | "closed";

const include = {
  quotation: {
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      totalCents: true,
      currency: true,
      customer: { select: { name: true } },
    },
  },
} satisfies Prisma.ReminderInclude;

function requestedPage(value: unknown): number {
  const number = typeof value === "string" || typeof value === "number" ? Number(value) : 1;
  return Number.isSafeInteger(number) && number > 0 ? number : 1;
}

/** Each category has its own query and page, so closed rows never hide due work. */
export async function getReminderGroups(
  organizationId: string,
  options: {
    now?: Date;
    pages?: Partial<Record<ReminderGroup, unknown>>;
    pageSize?: number;
  } = {},
) {
  const now = options.now ?? new Date();
  const pageSize = Math.min(100, Math.max(1, Math.trunc(options.pageSize || 20)));

  const group = async (key: ReminderGroup) => {
    const where: Prisma.ReminderWhereInput = {
      organizationId,
      ...(key === "closed"
        ? { status: { not: "pending" } }
        : { status: "pending", dueAt: key === "overdue" ? { lte: now } : { gt: now } }),
    };
    const total = await prisma.reminder.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage(options.pages?.[key]), totalPages);
    const items = await prisma.reminder.findMany({
      where,
      include,
      orderBy: key === "closed" ? [{ updatedAt: "desc" }, { id: "asc" }] : [{ dueAt: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, totalPages, pageSize };
  };

  const [overdue, upcoming, closed] = await Promise.all([
    group("overdue"),
    group("upcoming"),
    group("closed"),
  ]);
  return { overdue, upcoming, closed };
}
