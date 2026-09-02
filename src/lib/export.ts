import type { ParsedStatement, ReconciliationResult, Transaction } from "./types";
import type { StatementReport } from "./reporting";

function transactionRow(transaction: Transaction) {
  return {
    Date: transaction.date,
    "Value Date": transaction.valueDate ?? "",
    Description: transaction.description,
    Reference: transaction.reference ?? "",
    Debit: transaction.debit || "",
    Credit: transaction.credit || "",
    Amount: transaction.amount,
    Balance: transaction.balance ?? "",
    Currency: transaction.currency ?? "",
    Confidence: transaction.confidence,
    Issues: transaction.issues.join("; "),
    "Source Row": transaction.rowNumber,
  };
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportStatementXlsx(statement: ParsedStatement) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(statement.transactions.map(transactionRow));
  XLSX.utils.book_append_sheet(workbook, sheet, "Transactions");
  const metadata = XLSX.utils.json_to_sheet([{
    File: statement.fileName,
    Bank: statement.bank.name,
    Region: statement.bank.region,
    "Date Order": statement.dateOrder,
    "Extraction Method": statement.extractionMethod,
    "Balance Check": statement.validation.status,
    "Balance Check Detail": statement.validation.message,
  }]);
  XLSX.utils.book_append_sheet(workbook, metadata, "Import audit");
  XLSX.writeFile(workbook, `${statement.fileName.replace(/\.[^.]+$/, "")}-clean.xlsx`);
}

export async function exportStatementCsv(statement: ParsedStatement) {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.json_to_sheet(statement.transactions.map(transactionRow));
  downloadBlob(new Blob([XLSX.utils.sheet_to_csv(sheet)], { type: "text/csv;charset=utf-8" }), `${statement.fileName.replace(/\.[^.]+$/, "")}-clean.csv`);
}

export async function exportReconciliation(result: ReconciliationResult, left: ParsedStatement, right: ParsedStatement) {
  const XLSX = await import("xlsx");
  const byId = new Map([...left.transactions, ...right.transactions].map((transaction) => [transaction.id, transaction]));
  const workbook = XLSX.utils.book_new();
  const matchRows = result.matches.map((match) => ({
    Status: match.status,
    Score: match.score,
    "Left Date": match.leftIds.map((id) => byId.get(id)?.date).filter(Boolean).join(" + "),
    "Left Description": match.leftIds.map((id) => byId.get(id)?.description).filter(Boolean).join(" + "),
    "Left Amount": match.leftAmount,
    "Right Date": match.rightIds.map((id) => byId.get(id)?.date).filter(Boolean).join(" + "),
    "Right Description": match.rightIds.map((id) => byId.get(id)?.description).filter(Boolean).join(" + "),
    "Right Amount": match.rightAmount,
    Difference: match.difference,
    Reasons: match.reasons.join("; "),
  }));
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(matchRows), "Matches");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(result.unmatchedLeft.map(transactionRow)), "Unmatched left");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(result.unmatchedRight.map(transactionRow)), "Unmatched right");
  XLSX.writeFile(workbook, `squincky-reconciliation-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export async function exportSpendingReport(report: StatementReport, statement: ParsedStatement) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.entries.map((entry) => ({
    Date: entry.date,
    Description: entry.description,
    Merchant: entry.merchant,
    Category: entry.category,
    Flow: entry.flow,
    Expense: entry.flow === "expense" ? entry.amount : "",
    Inflow: entry.flow === "inflow" ? entry.amount : "",
    Currency: entry.currency ?? "",
  }))), "Breakdown");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.categories.map((category) => ({
    Category: category.name,
    "Total expense": category.amount,
    Transactions: category.count,
    "Share of expenses": category.share,
  }))), "Categories");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.merchants.map((merchant) => ({
    Merchant: merchant.name,
    Category: merchant.category ?? "",
    "Total expense": merchant.amount,
    Transactions: merchant.count,
    "Share of expenses": merchant.share,
  }))), "Merchants");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{
    File: statement.fileName,
    Bank: statement.bank.name,
    "Total expenses": report.totalExpense,
    "Total inflows": report.totalInflow,
    "Net flow": report.netFlow,
    "Largest merchant": report.topMerchant?.name ?? "",
    "Largest merchant spend": report.topMerchant?.amount ?? "",
    "Largest category": report.topCategory?.name ?? "",
    "Largest category spend": report.topCategory?.amount ?? "",
  }]), "Summary");
  XLSX.writeFile(workbook, `${statement.fileName.replace(/\.[^.]+$/, "")}-report.xlsx`);
}
