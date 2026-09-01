export type SupportedFormat = "pdf" | "xlsx" | "csv";
export type DateOrder = "DMY" | "MDY" | "YMD";
export type ColumnRole =
  | "date"
  | "valueDate"
  | "description"
  | "reference"
  | "debit"
  | "credit"
  | "amount"
  | "balance"
  | "currency"
  | "ignore";

export interface BankProfile {
  id: string;
  name: string;
  region: string;
  detect: string[];
  dateOrder: DateOrder;
  headerHints?: Partial<Record<ColumnRole, string[]>>;
}

export interface SourceRow {
  rowNumber: number;
  values: Record<string, unknown>;
}

export interface ColumnMapping {
  source: string;
  role: ColumnRole;
  confidence: number;
}

export interface Transaction {
  id: string;
  sourceId: string;
  rowNumber: number;
  date: string;
  rawDate: string;
  valueDate?: string;
  description: string;
  reference?: string;
  debit: number;
  credit: number;
  amount: number;
  balance?: number;
  currency?: string;
  confidence: number;
  issues: string[];
  raw: Record<string, unknown>;
}

export interface BalanceValidation {
  status: "verified" | "discrepancy" | "unverifiable";
  message: string;
  difference?: number;
}

export interface ParsedStatement {
  id: string;
  fileName: string;
  format: SupportedFormat;
  fileSize: number;
  bank: BankProfile;
  dateOrder: DateOrder;
  sheetName?: string;
  columns: string[];
  mappings: ColumnMapping[];
  sourceRows: SourceRow[];
  transactions: Transaction[];
  warnings: string[];
  validation: BalanceValidation;
  extractionMethod: "spreadsheet" | "pdf-coordinates" | "pdf-lines";
}

export interface MatchConfig {
  dateToleranceDays: number;
  amountTolerance: number;
  descriptionWeight: number;
  allowGroupedMatches: boolean;
}

export interface ReconciliationMatch {
  id: string;
  leftIds: string[];
  rightIds: string[];
  leftAmount: number;
  rightAmount: number;
  difference: number;
  score: number;
  status: "exact" | "probable" | "review";
  reasons: string[];
}

export interface ReconciliationResult {
  matches: ReconciliationMatch[];
  unmatchedLeft: Transaction[];
  unmatchedRight: Transaction[];
}
