export interface ListSearchParams {
  q?: string | string[];
  page?: string | string[];
}

export interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  skip: number;
  from: number;
  to: number;
}

export const LIST_PAGE_SIZE = 25;

/** Bound incoming query strings before they reach database queries or links. */
export function parseListQuery(params: ListSearchParams): { query: string; page: number } {
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 120) : "";
  const rawPage = typeof params.page === "string" ? params.page : "";
  const page = /^\d{1,6}$/.test(rawPage) ? Number(rawPage) : 1;
  return { query, page: Math.max(1, page) };
}

/** Clamp stale or hand-edited page numbers to an actual page of results. */
export function paginate(total: number, page: number, pageSize = LIST_PAGE_SIZE): PaginationState {
  const boundedSize = Number.isInteger(pageSize) ? Math.max(1, Math.min(100, pageSize)) : LIST_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(total / boundedSize));
  const current = Number.isSafeInteger(page) ? Math.max(1, Math.min(pageCount, page)) : 1;
  const skip = (current - 1) * boundedSize;
  return {
    page: current,
    pageSize: boundedSize,
    total,
    pageCount,
    skip,
    from: total === 0 ? 0 : skip + 1,
    to: Math.min(skip + boundedSize, total),
  };
}

export function listHref(
  pathname: string,
  values: Record<string, string | number | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === "" || (name === "page" && Number(value) === 1)) continue;
    params.set(name, String(value));
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
