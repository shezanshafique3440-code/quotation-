import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ListSearch, Pagination } from "@/components/list-controls";
import { listHref, paginate, parseListQuery } from "@/lib/pagination";

describe("list navigation", () => {
  it("bounds search text and treats malformed or repeated page parameters as page one", () => {
    expect(parseListQuery({ q: `  ${"a".repeat(150)}  `, page: "3" })).toEqual({
      query: "a".repeat(120), page: 3,
    });
    for (const page of ["-1", "0", "1.5", "Infinity", "1000000", ["2", "3"]]) {
      expect(parseListQuery({ page }).page).toBe(1);
    }
    expect(parseListQuery({ q: ["first", "second"] }).query).toBe("");
  });

  it("clamps stale page numbers to the last real page instead of hiding results", () => {
    expect(paginate(26, 999)).toMatchObject({
      page: 2, pageCount: 2, skip: 25, from: 26, to: 26,
    });
    expect(paginate(0, 999)).toMatchObject({ page: 1, pageCount: 1, from: 0, to: 0 });
    expect(paginate(100, Number.NaN).page).toBe(1);
    expect(paginate(100, 1, 10_000).pageSize).toBe(100);
  });

  it("encodes a search and keeps filters when moving between pages", () => {
    const href = listHref("/quotations", { q: "oak & steel", status: "sent", page: 2 });
    const params = new URL(href, "https://example.test").searchParams;
    expect(params.get("q")).toBe("oak & steel");
    expect(params.get("status")).toBe("sent");
    expect(params.get("page")).toBe("2");
    expect(listHref("/quotations", { q: "", status: undefined, page: 1 })).toBe("/quotations");
  });

  it("renders an accessible search and preserves the status while resetting the page", () => {
    const html = renderToStaticMarkup(createElement(ListSearch, {
      pathname: "/quotations",
      query: "Oak",
      filters: { status: "sent" },
      label: "Search quotations",
      placeholder: "Number, title or customer",
    }));
    expect(html).toContain('role="search"');
    expect(html).toContain('for="quotations-search"');
    expect(html).toContain('name="status" value="sent"');
    expect(html).toContain('href="/quotations?status=sent"');
    expect(html).not.toContain('name="page"');
  });

  it("renders real previous/next links with search and status intact", () => {
    const html = renderToStaticMarkup(createElement(Pagination, {
      pathname: "/quotations",
      query: "Oak",
      filters: { status: "sent" },
      pagination: paginate(60, 2),
    }));
    expect(html).toContain('aria-label="Pagination"');
    expect(html).toContain('href="/quotations?status=sent&amp;q=Oak"');
    expect(html).toContain('href="/quotations?status=sent&amp;q=Oak&amp;page=3"');
    expect(html).toContain("Showing 26–50 of 60");
    expect(html).toContain("Page 2 of 3");
  });
});
