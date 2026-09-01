import { describe, expect, it } from "vitest";
import { reconcile } from "../src/lib/reconciliation";
import type { Transaction } from "../src/lib/types";

function tx(id: string, date: string, amount: number, description: string, reference?: string): Transaction {
  return { id, sourceId: "fixture", rowNumber: 1, date, rawDate: date, description, reference, debit: amount < 0 ? Math.abs(amount) : 0, credit: amount > 0 ? amount : 0, amount, confidence: 1, issues: [], raw: {} };
}

describe("auditable reconciliation", () => {
  it("matches exact references before weaker candidates", () => {
    const result = reconcile(
      [tx("a", "2026-08-01", -100, "Vendor Alpha", "INV-001")],
      [tx("b", "2026-08-02", 100, "Alpha settlement", "INV-001"), tx("c", "2026-08-01", 100, "Other merchant")],
    );
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].rightIds).toEqual(["b"]);
    expect(result.matches[0].reasons).toContain("Reference agrees");
  });

  it("supports one-to-many grouped matching", () => {
    const result = reconcile(
      [tx("a", "2026-08-10", -150, "Batch payout")],
      [tx("b", "2026-08-10", 100, "Order one"), tx("c", "2026-08-11", 50, "Order two")],
    );
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].rightIds).toHaveLength(2);
    expect(result.unmatchedRight).toHaveLength(0);
  });
});
