import type { Prisma } from "@prisma/client";
import { QUOTATION_STATUSES, type QuotationStatus } from "./constants";
import { prisma } from "./db";
import { paginate, parseListQuery } from "./pagination";

interface ListOptions {
  query?: string;
  page?: number;
}

function queryOptions(options: ListOptions) {
  return parseListQuery({ q: options.query, page: String(options.page ?? 1) });
}

export async function listQuotations(
  organizationId: string,
  options: ListOptions & { status?: string } = {},
) {
  const { query, page } = queryOptions(options);
  const status = (QUOTATION_STATUSES as readonly string[]).includes(options.status ?? "")
    ? options.status as QuotationStatus
    : undefined;
  const searchWhere: Prisma.QuotationWhereInput = {
    organizationId,
    ...(query ? {
      OR: [
        { number: { contains: query } },
        { title: { contains: query } },
        { customer: { name: { contains: query } } },
        { customer: { company: { contains: query } } },
      ],
    } : {}),
  };
  const where = { ...searchWhere, ...(status ? { status } : {}) };
  const [total, groups] = await Promise.all([
    prisma.quotation.count({ where }),
    // Counts follow the search, while the selected status only filters rows.
    prisma.quotation.groupBy({
      by: ["status"],
      where: searchWhere,
      _count: { _all: true },
    }),
  ]);
  const pagination = paginate(total, page);
  const rows = await prisma.quotation.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: pagination.skip,
    take: pagination.pageSize,
    include: { customer: { select: { name: true } } },
  });
  return {
    rows,
    pagination,
    query,
    status,
    counts: new Map(groups.map((group) => [group.status, group._count._all])),
    total: groups.reduce((sum, group) => sum + group._count._all, 0),
  };
}

export async function listInquiries(organizationId: string, options: ListOptions = {}) {
  const { query, page } = queryOptions(options);
  const where: Prisma.InquiryWhereInput = {
    organizationId,
    ...(query ? {
      OR: [
        { subject: { contains: query } },
        { message: { contains: query } },
        { customer: { name: { contains: query } } },
        { customer: { company: { contains: query } } },
      ],
    } : {}),
  };
  const total = await prisma.inquiry.count({ where });
  const pagination = paginate(total, page);
  const rows = await prisma.inquiry.findMany({
    where,
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    skip: pagination.skip,
    take: pagination.pageSize,
    include: {
      customer: { select: { name: true } },
      _count: { select: { quotations: true } },
    },
  });
  return { rows, pagination, query };
}

export async function listCustomers(organizationId: string, options: ListOptions = {}) {
  const { query, page } = queryOptions(options);
  const where: Prisma.CustomerWhereInput = {
    organizationId,
    ...(query ? {
      OR: [
        { name: { contains: query } },
        { company: { contains: query } },
        { email: { contains: query } },
        { phone: { contains: query } },
      ],
    } : {}),
  };
  const total = await prisma.customer.count({ where });
  const pagination = paginate(total, page);
  const rows = await prisma.customer.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: pagination.skip,
    take: pagination.pageSize,
    include: { _count: { select: { quotations: true, inquiries: true } } },
  });
  return { rows, pagination, query };
}
