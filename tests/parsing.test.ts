import { PDFDocument, StandardFonts } from "pdf-lib";
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseStatement } from "../src/lib/statementParser";

GlobalWorkerOptions.workerSrc = new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();

describe("end-to-end local file parsing", () => {
  it("parses a multilingual CSV export without an API", async () => {
    const csv = [
      "Banco Example",
      "Fecha,Concepto,Importe,Saldo",
      "31/08/2026,Compra tarjeta,\"-20,00\",\"980,00\"",
      "01/09/2026,Ingreso nomina,\"1000,00\",\"1980,00\"",
    ].join("\n");
    const file = new File([csv], "spanish-bank.csv", { type: "text/csv", lastModified: 1 });
    const statement = await parseStatement(file);
    expect(statement.transactions).toHaveLength(2);
    expect(statement.transactions[0].date).toBe("2026-08-31");
    expect(statement.transactions[0].amount).toBe(-20);
  });

  it("parses an XLSX debit-credit layout", async () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["HDFC Bank statement"],
      ["Date", "Narration", "Chq./Ref.No.", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"],
      ["31/08/2026", "UPI PAYMENT", "UPI-1", 500, "", 9500],
      ["01/09/2026", "SALARY", "NEFT-2", "", 2000, 11500],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Statement");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const file = new File([bytes], "hdfc.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", lastModified: 2 });
    const statement = await parseStatement(file);
    expect(statement.bank.id).toBe("hdfc");
    expect(statement.transactions.map((transaction) => transaction.amount)).toEqual([-500, 2000]);
    expect(statement.validation.status).toBe("verified");
  });

  it("parses a coordinate-based text PDF", async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([612, 792]);
    const font = await document.embedFont(StandardFonts.Helvetica);
    page.drawText("JPMorgan Chase Bank statement", { x: 40, y: 750, size: 12, font });
    const headers = [["Date", 40], ["Description", 120], ["Amount", 400], ["Balance", 500]] as const;
    headers.forEach(([text, x]) => page.drawText(text, { x, y: 700, size: 10, font }));
    const rows = [
      [["08/30/2026", 40], ["Opening deposit", 120], ["1000.00", 400], ["1000.00", 500]],
      [["08/31/2026", 40], ["Card purchase", 120], ["-25.00", 400], ["975.00", 500]],
    ] as const;
    rows.forEach((row, index) => row.forEach(([text, x]) => page.drawText(text, { x, y: 675 - index * 22, size: 10, font })));
    const bytes = await document.save();
    const file = new File([bytes], "chase.pdf", { type: "application/pdf", lastModified: 3 });
    const statement = await parseStatement(file);
    expect(statement.bank.id).toBe("chase");
    expect(statement.extractionMethod).toBe("pdf-coordinates");
    expect(statement.transactions).toHaveLength(2);
    expect(statement.transactions[1].amount).toBe(-25);
  });
});
