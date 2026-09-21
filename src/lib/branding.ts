export const DEFAULT_BRAND_COLOR = "#4B3DDB";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isValidHexColor(value: string): boolean {
  return HEX_PATTERN.test(value.trim());
}

/** Normalise to `#rrggbb`, falling back to the default rather than throwing. */
export function normalizeHexColor(value: string | null | undefined): string {
  if (!value) return DEFAULT_BRAND_COLOR;
  const match = HEX_PATTERN.exec(value.trim());
  if (!match) return DEFAULT_BRAND_COLOR;

  const hex = match[1]!;
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  return `#${full.toLowerCase()}`;
}

/** Channels as 0-255 integers. */
export function hexToRgb(value: string): Rgb {
  const hex = normalizeHexColor(value).slice(1);
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

/** Channels as 0-1 floats, which is what pdf-lib's `rgb()` wants. */
export function hexToUnitRgb(value: string): Rgb {
  const { r, g, b } = hexToRgb(value);
  return { r: r / 255, g: g / 255, b: b / 255 };
}

/** WCAG relative luminance. */
export function relativeLuminance(value: string): number {
  const { r, g, b } = hexToRgb(value);
  const channel = (raw: number) => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [light, dark] = la > lb ? [la, lb] : [lb, la];
  return (light! + 0.05) / (dark! + 0.05);
}

/**
 * Text colour to place on top of a brand colour, chosen by whichever of black
 * or white actually has the higher contrast — a pale brand colour must not end
 * up with white text on a button nobody can read.
 */
export function readableTextOn(background: string): string {
  const onWhite = contrastRatio(background, "#ffffff");
  const onInk = contrastRatio(background, "#111827");
  return onWhite >= onInk ? "#ffffff" : "#111827";
}

function mixWithWhite(value: string, amount: number): string {
  const { r, g, b } = hexToRgb(value);
  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount);
  return `#${[mix(r), mix(g), mix(b)]
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}

function mixWithBlack(value: string, amount: number): string {
  const { r, g, b } = hexToRgb(value);
  const mix = (channel: number) => Math.round(channel * (1 - amount));
  return `#${[mix(r), mix(g), mix(b)]
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}

export interface BrandPalette {
  base: string;
  onBase: string;
  soft: string;
  strong: string;
  border: string;
}

/** A small, derived palette so one colour is enough to brand a page. */
export function brandPalette(value: string | null | undefined): BrandPalette {
  const base = normalizeHexColor(value);
  return {
    base,
    onBase: readableTextOn(base),
    soft: mixWithWhite(base, 0.9),
    strong: mixWithBlack(base, 0.18),
    border: mixWithWhite(base, 0.7),
  };
}

/** Inline CSS custom properties, applied to the public page's root element. */
export function brandCssVariables(value: string | null | undefined): Record<string, string> {
  const palette = brandPalette(value);
  return {
    "--brand": palette.base,
    "--brand-on": palette.onBase,
    "--brand-soft": palette.soft,
    "--brand-strong": palette.strong,
    "--brand-border": palette.border,
  };
}
