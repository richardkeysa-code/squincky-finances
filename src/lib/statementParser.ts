import { allSynonyms, detectBankProfile, GENERIC_PROFILE, GLOBAL_HEADER_SYNONYMS } from "./bankProfiles";
import { looksLikeDate, normalizeHeader, normalizeText, parseAmount, parseDate, stableId } from "./normalization";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type {
  BalanceValidation,
  BankProfile,
  ColumnMapping,
  ColumnRole,
  DateOrder,
  ParsedStatement,
  SourceRow,
  SupportedFormat,
  Transaction,
} from "./types";

const ROLE_PRIORITY: ColumnRole[] = [
  "date", "valueDate", "description", "reference", "debit", "credit", "amount", "balance", "currency",
];

const PDF_COLUMNS = ["Date", "Value date", "Description", "Reference", "Debit", "Credit", "Amount", "Balance", "Currency"];

function formatFromName(name: string): SupportedFormat | null {
  const extension = name.toLowerCase().split(".").pop();
  if (extension === "pdf") return "pdf";
  if (extension === "xlsx") return "xlsx";
  if (extension === "csv") return "csv";
  return null;
}

function roleScore(header: string, role: ColumnRole, profile: BankProfile): number {
  const normalized = normalizeHeader(header);
  if (!normalized) return 0;
  let best = 0;
  for (const synonym of allSynonyms(profile, role)) {
    const candidate = normalizeHeader(synonym);
    if (!candidate) continue;
    if (normalized === candidate) best = Math.max(best, 1);
    else if (normalized.includes(candidate) || candidate.includes(normalized)) {
      best = Math.max(best, Math.min(normalized.length, candidate.length) / Math.max(normalized.length, candidate.length) * 0.88);
    }
  }
  return best;
}

export function inferMappings(columns: string[], profile: BankProfile): ColumnMapping[] {
  const candidates = columns.flatMap((source) =>
    ROLE_PRIORITY.map((role) => ({ source, role, score: roleScore(source, role, profile) }))
      .filter(({ score }) => score >= 0.46),
  ).sort((a, b) => b.score - a.score);

  const usedSources = new Set<string>();
  const usedRoles = new Set<ColumnRole>();
  const mappings: ColumnMapping[] = [];
  for (const candidate of candidates) {
    if (usedSources.has(candidate.source) || usedRoles.has(candidate.role)) continue;
    mappings.push({ source: candidate.source, role: candidate.role, confidence: candidate.score });
    usedSources.add(candidate.source);
    usedRoles.add(candidate.role);
  }
  for (const source of columns) {
    if (!usedSources.has(source)) mappings.push({ source, role: "ignore", confidence: 0 });
  }
  return columns.map((source) => mappings.find((mapping) => mapping.source === source)!);
}

function mappingFor(mappings: ColumnMapping[], role: ColumnRole): string | undefined {
  return mappings.find((mapping) => mapping.role === role)?.source;
}

function valueAt(row: SourceRow, mappings: ColumnMapping[], role: ColumnRole): unknown {
  const source = mappingFor(mappings, role);
  return source ? row.values[source] : undefined;
}

function extractCurrency(...values: unknown[]): string | undefined {
  const text = values.map((value) => String(value ?? "")).join(" ");
  return text.match(/\b(IDR|USD|EUR|GBP|SGD|AUD|CAD|INR|JPY|CNY|CHF|MYR|THB|PHP|HKD|NZD)\b/i)?.[1]?.toUpperCase();
}

export function rowsToTransactions(
  sourceId: string,
  rows: SourceRow[],
  mappings: ColumnMapping[],
  dateOrder: DateOrder,
): Transaction[] {
  const output: Transaction[] = [];
  for (const row of rows) {
    const rawDate = normalizeText(valueAt(row, mappings, "date") ?? valueAt(row, mappings, "valueDate"));
    const date = parseDate(rawDate, dateOrder);
    const description = normalizeText(valueAt(row, mappings, "description"));
    const reference = normalizeText(valueAt(row, mappings, "reference"));
    const rawDebit = parseAmount(valueAt(row, mappings, "debit"));
    const rawCredit = parseAmount(valueAt(row, mappings, "credit"));
    const rawAmount = parseAmount(valueAt(row, mappings, "amount"));
    const rawBalance = parseAmount(valueAt(row, mappings, "balance"));
    const issues: string[] = [];

    if (!date) {
      if (!rawDate || (!description && rawDebit === null && rawCredit === null && rawAmount === null)) continue;
      issues.push("Date could not be parsed");
    }

    let debit = rawDebit === null ? 0 : Math.abs(rawDebit);
    let credit = rawCredit === null ? 0 : Math.abs(rawCredit);
    let amount = rawAmount ?? credit - debit;
    if (rawAmount !== null && rawDebit === null && rawCredit === null) {
      debit = amount < 0 ? Math.abs(amount) : 0;
      credit = amount > 0 ? amount : 0;
    } else if (rawAmount === null) amount = credit - debit;
    if (debit === 0 && credit === 0 && amount === 0 && rawBalance === null) continue;
    if (!description) issues.push("Description is empty");
    if (debit > 0 && credit > 0) issues.push("Both debit and credit contain values");

    const confidence = Math.max(0.25, 1 - issues.length * 0.25 - (rawBalance === null ? 0.05 : 0));
    output.push({
      id: stableId([sourceId, row.rowNumber, date, description, reference, amount]),
      sourceId,
      rowNumber: row.rowNumber,
      date,
      rawDate,
      valueDate: parseDate(valueAt(row, mappings, "valueDate"), dateOrder) || undefined,
      description,
      reference: reference || undefined,
      debit,
      credit,
      amount,
      balance: rawBalance ?? undefined,
      currency: normalizeText(valueAt(row, mappings, "currency")) || extractCurrency(...Object.values(row.values)),
      confidence,
      issues,
      raw: row.values,
    });
  }
  return inferSignedAmountsFromBalances(output);
}

function inferSignedAmountsFromBalances(transactions: Transaction[]): Transaction[] {
  return transactions.map((transaction, index) => {
    if (transaction.balance === undefined || index === 0 || transactions[index - 1].balance === undefined) return transaction;
    if (mappingAlreadySigned(transaction)) return transaction;
    const movement = transaction.balance - transactions[index - 1].balance!;
    const magnitude = Math.abs(transaction.amount);
    if (magnitude === 0 || Math.abs(Math.abs(movement) - magnitude) > Math.max(0.02, magnitude * 0.001)) return transaction;
    const amount = movement < 0 ? -magnitude : magnitude;
    return { ...transaction, amount, debit: amount < 0 ? magnitude : 0, credit: amount > 0 ? magnitude : 0 };
  });
}

function mappingAlreadySigned(transaction: Transaction): boolean {
  if (transaction.amount < 0) return true;
  const populatedKeys = Object.entries(transaction.raw)
    .filter(([, value]) => normalizeText(value))
    .map(([key]) => normalizeHeader(key));
  return populatedKeys.some((key) => /(^| )(debit|withdrawal|money out|paid out|credit|deposit|money in|paid in)( |$)/.test(key));
}

export function validateBalances(transactions: Transaction[]): BalanceValidation {
  const withBalance = transactions.filter((transaction) => transaction.balance !== undefined && transaction.date);
  if (withBalance.length < 2) {
    return { status: "unverifiable", message: "A running balance was not available for continuity checking." };
  }
  let checked = 0;
  let totalDifference = 0;
  for (let index = 1; index < withBalance.length; index += 1) {
    const previous = withBalance[index - 1];
    const current = withBalance[index];
    const expected = previous.balance! + current.amount;
    const difference = Math.abs(expected - current.balance!);
    if (difference <= Math.max(0.02, Math.abs(current.amount) * 0.001)) checked += 1;
    totalDifference += difference;
  }
  const ratio = checked / Math.max(1, withBalance.length - 1);
  if (ratio >= 0.85) return { status: "verified", message: `Running-balance continuity passed for ${checked} of ${withBalance.length - 1} movements.` };
  return {
    status: "discrepancy",
    message: `Only ${checked} of ${withBalance.length - 1} running-balance movements reconciled. Review date order and column mapping.`,
    difference: totalDifference,
  };
}

function headerRowScore(row: unknown[], profile: BankProfile): number {
  const columns = row.map((cell) => normalizeText(cell));
  const mappings = inferMappings(columns, profile).filter((mapping) => mapping.role !== "ignore");
  const roles = new Set(mappings.map((mapping) => mapping.role));
  let score = mappings.reduce((total, mapping) => total + mapping.confidence, 0);
  if (roles.has("date")) score += 1.8;
  if (roles.has("description")) score += 1.4;
  if (roles.has("amount") || roles.has("debit") || roles.has("credit")) score += 1.6;
  return score;
}

function uniqueColumns(row: unknown[]): string[] {
  const counts = new Map<string, number>();
  return row.map((cell, index) => {
    const base = normalizeText(cell) || `Column ${index + 1}`;
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    return seen ? `${base} (${seen + 1})` : base;
  });
}

async function parseSpreadsheet(file: File, format: SupportedFormat): Promise<ParsedStatement> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true, raw: true });
  let best: { sheetName: string; rows: unknown[][]; headerIndex: number; score: number; bank: BankProfile } | null = null;

  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "", raw: true });
    const sampleText = rows.slice(0, 60).flat().map(normalizeText).join(" ");
    const bank = detectBankProfile(sampleText);
    for (let index = 0; index < Math.min(rows.length, 45); index += 1) {
      const score = headerRowScore(rows[index], bank);
      if (!best || score > best.score) best = { sheetName, rows, headerIndex: index, score, bank };
    }
  }
  if (!best || best.score < 2.2) throw new Error("No transaction header row could be detected. The file may not contain a bank-style transaction table.");

  const columns = uniqueColumns(best.rows[best.headerIndex]);
  const sourceRows: SourceRow[] = best.rows.slice(best.headerIndex + 1).map((row, index) => ({
    rowNumber: best!.headerIndex + index + 2,
    values: Object.fromEntries(columns.map((column, columnIndex) => [column, row[columnIndex] ?? ""])),
  }));
  const mappings = inferMappings(columns, best.bank);
  const id = stableId([file.name, file.size, file.lastModified]);
  const dateOrder = best.bank.id === "generic" ? "DMY" : best.bank.dateOrder;
  const transactions = rowsToTransactions(id, sourceRows, mappings, dateOrder);
  if (!transactions.length) throw new Error("The table was found, but no transaction rows could be normalized. Review the source columns and date format.");
  return {
    id,
    fileName: file.name,
    format,
    fileSize: file.size,
    bank: best.bank,
    dateOrder,
    sheetName: best.sheetName,
    columns,
    mappings,
    sourceRows,
    transactions,
    warnings: best.bank.id === "generic" ? ["Bank was not recognized; generic column detection was used."] : [],
    validation: validateBalances(transactions),
    extractionMethod: "spreadsheet",
  };
}

interface PdfAtom { text: string; x: number; y: number; width: number; page: number }
interface PdfLine { atoms: PdfAtom[]; text: string; y: number; page: number }
interface PdfTextItem { str: string; transform: number[]; width: number }

function groupPdfLines(atoms: PdfAtom[]): PdfLine[] {
  const byPage = new Map<number, PdfAtom[]>();
  atoms.forEach((atom) => byPage.set(atom.page, [...(byPage.get(atom.page) ?? []), atom]));
  const output: PdfLine[] = [];
  for (const [page, pageAtoms] of byPage) {
    const sorted = [...pageAtoms].sort((a, b) => b.y - a.y || a.x - b.x);
    const groups: PdfAtom[][] = [];
    for (const atom of sorted) {
      const line = groups.find((candidate) => Math.abs(candidate[0].y - atom.y) <= 2.8);
      if (line) line.push(atom);
      else groups.push([atom]);
    }
    for (const group of groups) {
      group.sort((a, b) => a.x - b.x);
      output.push({ atoms: group, text: group.map((atom) => atom.text).join(" ").replace(/\s+/g, " ").trim(), y: group[0].y, page });
    }
  }
  return output.sort((a, b) => a.page - b.page || b.y - a.y);
}

function pdfHeaderAnchors(line: PdfLine, profile: BankProfile): Array<{ role: ColumnRole; x: number }> {
  const anchors: Array<{ role: ColumnRole; x: number; score: number }> = [];
  for (let start = 0; start < line.atoms.length; start += 1) {
    for (let length = 1; length <= Math.min(4, line.atoms.length - start); length += 1) {
      const text = line.atoms.slice(start, start + length).map((atom) => atom.text).join(" ");
      for (const role of ROLE_PRIORITY) {
        const score = roleScore(text, role, profile);
        if (score >= 0.72) anchors.push({ role, x: line.atoms[start].x, score });
      }
    }
  }
  anchors.sort((a, b) => b.score - a.score);
  const used = new Set<ColumnRole>();
  return anchors.filter((anchor) => {
    if (used.has(anchor.role)) return false;
    used.add(anchor.role);
    return true;
  }).sort((a, b) => a.x - b.x);
}

function assignAtoms(line: PdfLine, anchors: Array<{ role: ColumnRole; x: number }>): Record<string, unknown> {
  const values: Partial<Record<ColumnRole, string[]>> = {};
  for (const atom of line.atoms) {
    let selected = anchors[0];
    for (let index = 0; index < anchors.length; index += 1) {
      const current = anchors[index];
      const next = anchors[index + 1];
      if (!next || atom.x < (current.x + next.x) / 2) { selected = current; break; }
    }
    values[selected.role] = [...(values[selected.role] ?? []), atom.text];
  }
  return Object.fromEntries(Object.entries(values).map(([role, parts]) => [roleLabel(role as ColumnRole), parts!.join(" ").trim()]));
}

function roleLabel(role: ColumnRole): string {
  return ({
    date: "Date", valueDate: "Value date", description: "Description", reference: "Reference", debit: "Debit",
    credit: "Credit", amount: "Amount", balance: "Balance", currency: "Currency", ignore: "Ignore",
  })[role];
}

function parsePdfByCoordinates(lines: PdfLine[], profile: BankProfile): SourceRow[] {
  const rows: SourceRow[] = [];
  let anchors: Array<{ role: ColumnRole; x: number }> = [];
  let currentPage = 0;
  let continuation = "";
  for (const line of lines) {
    if (line.page !== currentPage) { currentPage = line.page; anchors = []; continuation = ""; }
    const candidateAnchors = pdfHeaderAnchors(line, profile);
    const candidateRoles = new Set(candidateAnchors.map((anchor) => anchor.role));
    if (candidateRoles.has("date") && (candidateRoles.has("amount") || candidateRoles.has("debit") || candidateRoles.has("credit"))) {
      anchors = candidateAnchors;
      continue;
    }
    if (!anchors.length) continue;
    const values = assignAtoms(line, anchors);
    const date = values.Date;
    if (looksLikeDate(date)) {
      if (continuation && rows.length) rows[rows.length - 1].values.Description = `${rows[rows.length - 1].values.Description ?? ""} ${continuation}`.trim();
      continuation = "";
      rows.push({ rowNumber: rows.length + 1, values });
    } else if (rows.length && line.text && !isFooterLine(line.text)) {
      const numericCount = line.atoms.filter((atom) => parseAmount(atom.text) !== null).length;
      if (numericCount === 0) continuation = `${continuation} ${line.text}`.trim();
    }
  }
  if (continuation && rows.length) rows[rows.length - 1].values.Description = `${rows[rows.length - 1].values.Description ?? ""} ${continuation}`.trim();
  return rows;
}

function isFooterLine(text: string): boolean {
  return /^(page\s+\d+|continued|total|subtotal|opening balance|closing balance|ending balance)/i.test(text.trim());
}

function splitPdfLine(text: string): Record<string, unknown> | null {
  const dateMatch = text.match(/^\s*((?:\d{1,4}[\-/\.]\d{1,2}(?:[\-/\.]\d{2,4})?)|(?:\d{1,2}\s+[A-Za-z]{3,9}(?:\s+\d{2,4})?))\s+(.+)$/);
  if (!dateMatch) return null;
  const tail = dateMatch[2];
  const amountPattern = /(?:\(?[-+]?\s*(?:[A-Z]{3}|[$£€¥₹Rp]*)?\s*\d[\d.,\s]*\)?(?:\s*(?:CR|DR|DB))?)(?=\s|$)/gi;
  const amounts = [...tail.matchAll(amountPattern)]
    .map((match) => ({ text: match[0].trim(), index: match.index ?? 0, value: parseAmount(match[0]) }))
    .filter((item) => item.value !== null && /\d/.test(item.text));
  if (!amounts.length) return null;
  const first = amounts[0];
  const description = tail.slice(0, first.index).trim();
  const numeric = amounts.map((item) => item.text);
  const values: Record<string, unknown> = { Date: dateMatch[1], Description: description };
  if (numeric.length >= 3) [values.Debit, values.Credit, values.Balance] = numeric.slice(-3);
  else if (numeric.length === 2) [values.Amount, values.Balance] = numeric;
  else [values.Amount] = numeric;
  return values;
}

function parsePdfByLines(lines: PdfLine[]): SourceRow[] {
  return lines.map((line, index) => ({ parsed: splitPdfLine(line.text), index }))
    .filter((item): item is { parsed: Record<string, unknown>; index: number } => Boolean(item.parsed))
    .map((item, rowIndex) => ({ rowNumber: rowIndex + 1, values: item.parsed }));
}

async function parsePdf(file: File): Promise<ParsedStatement> {
  const { GlobalWorkerOptions, getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  GlobalWorkerOptions.workerSrc = import.meta.env.MODE === "test"
    ? new URL("../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href
    : pdfWorkerUrl;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = getDocument({ data: bytes, useWorkerFetch: false });
  let document;
  try {
    document = await loadingTask.promise;
  } catch (error) {
    if (error instanceof Error && /password/i.test(error.message)) throw new Error("This PDF is password-protected. Export an unlocked copy before importing it.");
    throw error;
  }
  const atoms: PdfAtom[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const textItem = item as PdfTextItem;
      const text = textItem.str.trim();
      if (!text) continue;
      atoms.push({ text, x: textItem.transform[4], y: textItem.transform[5], width: textItem.width, page: pageNumber });
    }
  }
  if (atoms.length < 8) throw new Error("No selectable text was found. Scanned/image-only PDFs are not supported in this privacy-first version.");
  const lines = groupPdfLines(atoms);
  const fullText = lines.slice(0, 160).map((line) => line.text).join(" ");
  const bank = detectBankProfile(fullText);
  let sourceRows = parsePdfByCoordinates(lines, bank);
  let extractionMethod: ParsedStatement["extractionMethod"] = "pdf-coordinates";
  if (sourceRows.length < 2) {
    sourceRows = parsePdfByLines(lines);
    extractionMethod = "pdf-lines";
  }
  if (!sourceRows.length) throw new Error("A transaction table could not be detected. Try the bank's CSV/XLSX export, or use the manual review screen after converting the PDF to a spreadsheet.");
  const populatedColumns = PDF_COLUMNS.filter((column) => sourceRows.some((row) => normalizeText(row.values[column])));
  const mappings = inferMappings(populatedColumns, bank);
  const id = stableId([file.name, file.size, file.lastModified]);
  const dateOrder = bank.id === "generic" ? "DMY" : bank.dateOrder;
  const transactions = rowsToTransactions(id, sourceRows, mappings, dateOrder);
  if (!transactions.length) throw new Error("Rows were detected, but dates or amounts could not be normalized. Review the file's date order or prefer CSV/XLSX.");
  const warnings: string[] = [];
  if (bank.id === "generic") warnings.push("Bank was not recognized; generic PDF column detection was used.");
  if (extractionMethod === "pdf-lines") warnings.push("No stable PDF column headers were found; line-pattern extraction was used and should be reviewed.");
  return {
    id,
    fileName: file.name,
    format: "pdf",
    fileSize: file.size,
    bank,
    dateOrder,
    columns: populatedColumns,
    mappings,
    sourceRows,
    transactions,
    warnings,
    validation: validateBalances(transactions),
    extractionMethod,
  };
}

export async function parseStatement(file: File): Promise<ParsedStatement> {
  const format = formatFromName(file.name);
  if (!format) throw new Error("Unsupported format. Please use PDF, XLSX, or CSV.");
  if (file.size > 25 * 1024 * 1024) throw new Error("File exceeds the 25 MB local-processing limit.");
  return format === "pdf" ? parsePdf(file) : parseSpreadsheet(file, format);
}

export function remapStatement(statement: ParsedStatement, mappings: ColumnMapping[], dateOrder: DateOrder): ParsedStatement {
  const transactions = rowsToTransactions(statement.id, statement.sourceRows, mappings, dateOrder);
  return { ...statement, mappings, dateOrder, transactions, validation: validateBalances(transactions) };
}

export { GLOBAL_HEADER_SYNONYMS };
