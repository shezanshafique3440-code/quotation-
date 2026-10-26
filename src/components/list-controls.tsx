import Link from "next/link";
import { listHref, type PaginationState } from "@/lib/pagination";

interface ListFilters {
  pathname: string;
  query: string;
  filters?: Record<string, string | undefined>;
}

export function ListSearch({
  pathname,
  query,
  filters = {},
  label,
  placeholder,
}: ListFilters & { label: string; placeholder: string }) {
  const inputId = `${pathname.replace(/[^a-z0-9]/gi, "")}-search`;
  return (
    <form key={query} action={pathname} method="get" role="search" className="space-y-2">
      <label htmlFor={inputId} className="label">{label}</label>
      {Object.entries(filters).map(([name, value]) => value ? (
        <input key={name} type="hidden" name={name} value={value} />
      ) : null)}
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={inputId}
          type="search"
          name="q"
          defaultValue={query}
          maxLength={120}
          placeholder={placeholder}
          className="input min-w-0 flex-1 sm:max-w-md"
        />
        <button type="submit" className="btn btn-secondary">Search</button>
        {query ? (
          <Link href={listHref(pathname, filters)} className="btn btn-ghost">Clear search</Link>
        ) : null}
      </div>
    </form>
  );
}

export function Pagination({
  pathname,
  query,
  filters = {},
  pagination,
}: ListFilters & { pagination: PaginationState }) {
  if (pagination.total === 0) return null;
  const hrefFor = (page: number) => listHref(pathname, { ...filters, q: query, page });
  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] px-5 py-4"
    >
      <p className="text-sm text-[var(--color-ink-muted)]">
        Showing {pagination.from}–{pagination.to} of {pagination.total}
      </p>
      <div className="flex items-center gap-3">
        {pagination.page > 1 ? (
          <Link href={hrefFor(pagination.page - 1)} rel="prev" className="btn btn-secondary">
            Previous
          </Link>
        ) : (
          <span aria-disabled="true" className="btn btn-secondary opacity-50">Previous</span>
        )}
        <span className="text-sm text-[var(--color-ink-muted)]">
          Page {pagination.page} of {pagination.pageCount}
        </span>
        {pagination.page < pagination.pageCount ? (
          <Link href={hrefFor(pagination.page + 1)} rel="next" className="btn btn-secondary">
            Next
          </Link>
        ) : (
          <span aria-disabled="true" className="btn btn-secondary opacity-50">Next</span>
        )}
      </div>
    </nav>
  );
}
