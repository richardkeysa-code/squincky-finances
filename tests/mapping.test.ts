import { describe, expect, it } from "vitest";
import { detectBankProfile } from "../src/lib/bankProfiles";
import { inferMappings, rowsToTransactions } from "../src/lib/statementParser";
import type { SourceRow } from "../src/lib/types";

const cases = [
  { name: "Jenius", profile: "Jenius Bank BTPN", columns: ["Tanggal", "Keterangan", "Jumlah", "Saldo"], row: ["31/08/2026", "QR payment", "-125.000", "1.000.000"] },
  { name: "Chase", profile: "JPMorgan Chase", columns: ["Date", "Description", "Amount", "Balance"], row: ["08/31/2026", "CARD PURCHASE", "-45.20", "1100.00"] },
  { name: "Barclays", profile: "Barclays Bank", columns: ["Date", "Description", "Money out", "Money in", "Balance"], row: ["31/08/2026", "DIRECT DEBIT", "35.00", "", "965.00"] },
  { name: "HDFC", profile: "HDFC Bank", columns: ["Date", "Narration", "Chq./Ref.No.", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"], row: ["31/08/2026", "UPI MERCHANT", "UPI123", "500.00", "", "9500.00"] },
  { name: "Deutsche Bank", profile: "Deutsche Bank", columns: ["Buchungstag", "Wertstellung", "Buchungstext", "Umsatz", "Kontostand"], row: ["31.08.2026", "31.08.2026", "Kartenzahlung", "-19,95", "980,05"] },
  { name: "Spanish generic", profile: "Banco Example", columns: ["Fecha", "Concepto", "Importe", "Saldo"], row: ["31/08/2026", "Compra tarjeta", "-20,00", "980,00"] },
  { name: "French generic", profile: "Banque Example", columns: ["Date", "Libellé", "Débit", "Crédit", "Solde"], row: ["31/08/2026", "Prélèvement", "20,00", "", "980,00"] },
];

describe("cross-bank header mapping", () => {
  it.each(cases)("normalizes the $name layout", ({ profile: profileText, columns, row }) => {
    const profile = detectBankProfile(profileText);
    const mappings = inferMappings(columns, profile);
    const values = Object.fromEntries(columns.map((column, index) => [column, row[index]]));
    const sourceRows: SourceRow[] = [{ rowNumber: 2, values }];
    const transactions = rowsToTransactions("fixture", sourceRows, mappings, profile.id === "chase" ? "MDY" : "DMY");
    expect(mappings.some((mapping) => mapping.role === "date")).toBe(true);
    expect(mappings.some((mapping) => mapping.role === "description")).toBe(true);
    expect(transactions).toHaveLength(1);
    expect(transactions[0].date).toBe("2026-08-31");
    expect(Math.abs(transactions[0].amount)).toBeGreaterThan(0);
  });
});
