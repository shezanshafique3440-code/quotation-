import { describe, expect, it } from "vitest";
import {
  DEFAULT_BRAND_COLOR,
  brandCssVariables,
  brandPalette,
  contrastRatio,
  hexToRgb,
  hexToUnitRgb,
  isValidHexColor,
  normalizeHexColor,
  readableTextOn,
  relativeLuminance,
} from "@/lib/branding";

describe("hex parsing", () => {
  it("accepts 3- and 6-digit hex with or without the hash", () => {
    expect(isValidHexColor("#4B3DDB")).toBe(true);
    expect(isValidHexColor("4b3ddb")).toBe(true);
    expect(isValidHexColor("#abc")).toBe(true);
    expect(isValidHexColor("#4b3dd")).toBe(false);
    expect(isValidHexColor("rebeccapurple")).toBe(false);
    expect(isValidHexColor("")).toBe(false);
  });

  it("normalises to lowercase six digits and expands shorthand", () => {
    expect(normalizeHexColor("#ABC")).toBe("#aabbcc");
    expect(normalizeHexColor("4B3DDB")).toBe("#4b3ddb");
    expect(normalizeHexColor("  #4B3DDB  ")).toBe("#4b3ddb");
  });

  it("falls back to the default rather than throwing on junk", () => {
    expect(normalizeHexColor(null)).toBe(DEFAULT_BRAND_COLOR);
    expect(normalizeHexColor(undefined)).toBe(DEFAULT_BRAND_COLOR);
    expect(normalizeHexColor("not a colour")).toBe(DEFAULT_BRAND_COLOR);
  });

  it("converts to 0-255 and 0-1 channels", () => {
    expect(hexToRgb("#ff8000")).toEqual({ r: 255, g: 128, b: 0 });
    const unit = hexToUnitRgb("#ff8000");
    expect(unit.r).toBe(1);
    expect(unit.g).toBeCloseTo(128 / 255);
    expect(unit.b).toBe(0);
  });
});

describe("contrast", () => {
  it("computes WCAG luminance at the extremes", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1);
  });

  it("gives the maximum ratio for black on white, either way round", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1);
  });

  it("picks whichever of white or ink is actually readable", () => {
    expect(readableTextOn("#0b0b45")).toBe("#ffffff");
    expect(readableTextOn("#ffee88")).toBe("#111827");
    expect(readableTextOn("#4b3ddb")).toBe("#ffffff");
  });

  it("guarantees the chosen text colour clears 4.5:1 on common brand colours", () => {
    for (const brand of ["#4b3ddb", "#0ca30c", "#fab219", "#d03b3b", "#111111", "#eeeeee"]) {
      expect(contrastRatio(brand, readableTextOn(brand))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("brandPalette", () => {
  it("derives a soft, strong and border step from one colour", () => {
    const palette = brandPalette("#4b3ddb");

    expect(palette.base).toBe("#4b3ddb");
    expect(palette.onBase).toBe("#ffffff");
    for (const step of [palette.soft, palette.strong, palette.border]) {
      expect(step).toMatch(/^#[0-9a-f]{6}$/);
    }
    // Soft is a tint, strong is a shade.
    expect(relativeLuminance(palette.soft)).toBeGreaterThan(relativeLuminance(palette.base));
    expect(relativeLuminance(palette.strong)).toBeLessThan(relativeLuminance(palette.base));
  });

  it("keeps the on-base text readable for any input, including junk", () => {
    for (const input of ["#ffffff", "#000000", "#fab219", "nonsense", null]) {
      const palette = brandPalette(input);
      expect(contrastRatio(palette.base, palette.onBase)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("exposes the palette as CSS custom properties", () => {
    const vars = brandCssVariables("#4b3ddb");
    expect(Object.keys(vars).sort()).toEqual([
      "--brand",
      "--brand-border",
      "--brand-on",
      "--brand-soft",
      "--brand-strong",
    ]);
    expect(vars["--brand"]).toBe("#4b3ddb");
  });
});
