import type { DateOrder } from "./types";

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, januari: 1,
  feb: 2, february: 2, februari: 2,
  mar: 3, march: 3, maret: 3, maart: 3,
  apr: 4, april: 4,
  may: 5, mei: 5,
  jun: 6, june: 6, juni: 6,
  jul: 7, july: 7, juli: 7,
  aug: 8, august: 8, agustus: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, oktober: 10,
  nov: 11, november: 11,
  dec: 12, december: 12, desember: 12,
};

function iso(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseDate(value: unknown, order: DateOrder, statementYear = new Date().getFullYear()): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return iso(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()) ?? "";
  }
  if (typeof value === "number" && value > 20000 && value < 80000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(epoch.getTime() + Math.round(value) * 86400000);
    return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()) ?? "";
  }

  const raw = String(value ?? "").trim().replace(/[,]/g, "").replace(/\s+/g, " ");
  if (!raw) return "";
  const isoMatch = raw.match(/\b(20\d{2}|19\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (isoMatch) return iso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3])) ?? "";

  const named = raw.toLowerCase().match(/\b(\d{1,2})[\s\-/.]+([a-z]{3,9})[\s\-/.]+(\d{2,4})\b|\b([a-z]{3,9})[\s\-/.]+(\d{1,2})[\s\-/.]+(\d{2,4})\b/);
  if (named) {
    const day = Number(named[1] ?? named[5]);
    const month = MONTHS[named[2] ?? named[4]];
    let year = Number(named[3] ?? named[6]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    if (month) return iso(year, month, day) ?? "";
  }

  const numeric = raw.match(/\b(\d{1,4})[\-/\.](\d{1,2})(?:[\-/\.](\d{2,4}))?\b/);
  if (!numeric) return "";
  let a = Number(numeric[1]);
  let b = Number(numeric[2]);
  let c = numeric[3] ? Number(numeric[3]) : statementYear;
  let year: number;
  let month: number;
  let day: number;
  if (order === "YMD" || a > 31) [year, month, day] = [a, b, c];
  else if (order === "MDY") [month, day, year] = [a, b, c];
  else [day, month, year] = [a, b, c];
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  return iso(year, month, day) ?? "";
}

export function looksLikeDate(value: unknown): boolean {
  if (value instanceof Date) return true;
  const text = String(value ?? "").trim();
  return /\b\d{1,4}[\-/\.]\d{1,2}(?:[\-/\.]\d{2,4})?\b/.test(text)
    || /\b(?:\d{1,2}\s+[A-Za-z]{3,9}|[A-Za-z]{3,9}\s+\d{1,2})(?:\s+\d{2,4})?\b/.test(text);
}

export function parseAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let raw = String(value ?? "").trim();
  if (!raw || /^[-—–]$/.test(raw)) return null;
  const negative = /^\(.*\)$/.test(raw) || /(?:\bDR\b|DB)$/i.test(raw) || /^-/.test(raw) || /-$/.test(raw);
  const positive = /(?:\bCR\b|CR)$/i.test(raw);
  raw = raw
    .replace(/[()]/g, "")
    .replace(/\b(?:IDR|USD|EUR|GBP|SGD|AUD|CAD|INR|JPY|CNY|CHF|MYR|THB|PHP|HKD)\b/gi, "")
    .replace(/(?:CR|DR|DB)$/i, "")
    .replace(/[^\d,\.\-+]/g, "")
    .replace(/[+\-]$/g, "");
  if (!/\d/.test(raw)) return null;

  const comma = raw.lastIndexOf(",");
  const dot = raw.lastIndexOf(".");
  let decimal = "";
  if (comma >= 0 && dot >= 0) decimal = comma > dot ? "," : ".";
  else if (comma >= 0) {
    const digitsAfter = raw.length - comma - 1;
    decimal = digitsAfter === 2 ? "," : "";
  } else if (dot >= 0) {
    const digitsAfter = raw.length - dot - 1;
    decimal = digitsAfter === 2 ? "." : "";
  }

  let normalized: string;
  if (decimal === ",") normalized = raw.replace(/\./g, "").replace(",", ".");
  else if (decimal === ".") normalized = raw.replace(/,/g, "");
  else normalized = raw.replace(/[,.]/g, "");
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  const magnitude = Math.abs(amount);
  return negative ? -magnitude : positive ? magnitude : amount;
}

export function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeHeader(value: unknown): string {
  return normalizeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[._/\\-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function stableId(parts: unknown[]): string {
  let hash = 2166136261;
  const input = parts.map((part) => String(part ?? "")).join("|");
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
