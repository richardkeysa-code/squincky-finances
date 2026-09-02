import { describe, expect, it } from "vitest";
import { GENERIC_PROFILE } from "../src/lib/bankProfiles";
import { buildStatementReport, inferExpensePolarity, inferMerchant } from "../src/lib/reporting";
import type { ParsedStatement, Transaction } from "../src/lib/types";

function transaction(id: string, description: string, amount: number): Transaction {
  return {
    id,
    sourceId: "statement",
    rowNumber: Number(id.replace(/\D/g, "")) || 1,
    date: "2026-08-01",
    rawDate: "01/08/2026",
    description,
    debit: amount < 0 ? Math.abs(amount) : 0,
    credit: amount > 0 ? amount : 0,
    amount,
    confidence: 1,
    issues: [],
    raw: { Amount: amount },
  };
}

function statement(fileName: string, transactions: Transaction[]): ParsedStatement {
  return {
    id: "statement",
    fileName,
    format: "csv",
    fileSize: 100,
    bank: GENERIC_PROFILE,
    dateOrder: "DMY",
    columns: ["Amount"],
    mappings: [{ source: "Amount", role: "amount", confidence: 1 }],
    sourceRows: [],
    transactions,
    warnings: [],
    validation: { status: "unverifiable", message: "No balance" },
    extractionMethod: "spreadsheet",
  };
}

describe("local spending reports", () => {
  it.each([
    ["GRAB*CAR JAKARTA", "Grab", "Transportation"],
    ["GRABFOOD MIE GACOAN", "GrabFood", "Food & Beverage"],
    ["POS STARBUCKS RESERVE ID", "Starbucks", "Food & Beverage"],
    ["INDOMARET KEMANG", "Indomaret", "Groceries"],
    ["NETFLIX.COM", "Netflix", "Entertainment"],
  ])("recognizes %s", (description, merchant, category) => {
    expect(inferMerchant(description)).toEqual({ merchant, category });
  });

  it("aggregates expenses, inflows, merchants, and categories", () => {
    const report = buildStatementReport(statement("checking.csv", [
      transaction("t1", "GRAB CAR JAKARTA", -25),
      transaction("t2", "POS STARBUCKS RESERVE", -50),
      transaction("t3", "MONTHLY SALARY", 1_000),
    ]));
    expect(report.totalExpense).toBe(75);
    expect(report.totalInflow).toBe(1_000);
    expect(report.netFlow).toBe(925);
    expect(report.topMerchant?.name).toBe("Starbucks");
    expect(report.topCategory?.name).toBe("Food & Beverage");
    expect(report.entries.find((entry) => entry.id === "t3")?.category).toBe("Salary & Income");
  });

  it("combines merchant aliases and applies manual corrections", () => {
    const source = statement("checking.csv", [
      transaction("t1", "GRAB CAR JAKARTA", -25),
      transaction("t2", "GRABBIKE 12345", -15),
    ]);
    const report = buildStatementReport(source, "negative-expense", {
      t2: { merchant: "Office commute", category: "Transportation" },
    });
    expect(report.merchants.map((merchant) => merchant.name)).toEqual(["Grab", "Office commute"]);
  });

  it("treats positive charges as expenses for credit-card statement filenames", () => {
    const source = statement("Visa_CreditCard_BillingStatement.pdf", [
      transaction("t1", "TOKOPEDIA", 125),
      transaction("t2", "PAYMENT RECEIVED", -125),
    ]);
    expect(inferExpensePolarity(source)).toBe("positive-expense");
    const report = buildStatementReport(source);
    expect(report.totalExpense).toBe(125);
    expect(report.totalInflow).toBe(125);
    expect(report.topMerchant?.name).toBe("Tokopedia");
  });
});
