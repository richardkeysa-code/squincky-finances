import * as XLSX from "xlsx";
import type { ExtractResult, Transaction } from "./extract.functions";

function rowsFromResult(result: ExtractResult) {
  return result.transactions.map((t: Transaction) => ({
    Date: t.date,
    Amount: t.type === "debit" ? -Math.abs(t.amount) : Math.abs(t.amount),
    Type: t.type,
    Merchant: t.merchant,
    Category: t.category,
    Description: t.description,
    Currency: result.currency,
  }));
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadXlsx(result: ExtractResult, baseName: string) {
  const rows = rowsFromResult(result);
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 28 }, { wch: 20 }, { wch: 40 }, { wch: 10 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Transactions");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  triggerDownload(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${baseName}.xlsx`);
}

export function downloadCsv(result: ExtractResult, baseName: string) {
  const rows = rowsFromResult(result);
  const ws = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(ws);
  triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `${baseName}.csv`);
}
