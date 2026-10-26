import { centsToInput } from "./format";

export interface CatalogLineProduct {
  id: string;
  name: string;
  description: string | null;
  unit: string;
  unitPriceCents: number;
  taxRateBp: number;
}

/** Catalog prices have no implicit foreign-exchange conversion. */
export function catalogLineFields(
  product: CatalogLineProduct,
  catalogCurrency: string,
  currency: string,
) {
  const sameCurrency = catalogCurrency === currency;
  return {
    productId: product.id,
    description: product.description?.trim() || product.name,
    unit: product.unit,
    unitPrice: sameCurrency ? centsToInput(product.unitPriceCents, catalogCurrency) : "",
    taxRate: String(product.taxRateBp / 100),
    catalogPriceCurrency: sameCurrency ? catalogCurrency : undefined,
  };
}

/** Preserve manually entered prices when changing currency. */
export function clearForeignCatalogPrice<
  T extends { unitPrice: string; catalogPriceCurrency?: string },
>(line: T, currency: string): T {
  if (!line.catalogPriceCurrency || line.catalogPriceCurrency === currency) return line;
  return { ...line, unitPrice: "", catalogPriceCurrency: undefined };
}
