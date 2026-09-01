import { describe, expect, it } from "vitest";
import { normalizeHeader, parseAmount, parseDate } from "../src/lib/normalization";

describe("international value normalization", () => {
  it.each([
    ["1,234.56", 1234.56],
    ["1.234,56", 1234.56],
    ["Rp 1.250.000", 1250000],
    ["(£2,500.00)", -2500],
    ["500,00 DR", -500],
    ["USD 99.95 CR", 99.95],
  ])("parses %s", (raw, expected) => expect(parseAmount(raw)).toBe(expected));

  it("parses regional date orders and named months", () => {
    expect(parseDate("08/31/2026", "MDY")).toBe("2026-08-31");
    expect(parseDate("31/08/2026", "DMY")).toBe("2026-08-31");
    expect(parseDate("2026-08-31", "YMD")).toBe("2026-08-31");
    expect(parseDate("31 Agustus 2026", "DMY")).toBe("2026-08-31");
  });

  it("normalizes accented multilingual headers", () => {
    expect(normalizeHeader("Crédit / Débit")).toBe("credit debit");
    expect(normalizeHeader("Descrição")).toBe("descricao");
  });
});
