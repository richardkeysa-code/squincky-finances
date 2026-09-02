import { normalizeText } from "./normalization";
import type { ParsedStatement, Transaction } from "./types";

export const REPORT_CATEGORIES = [
  "Food & Beverage",
  "Transportation",
  "Groceries",
  "Shopping & Retail",
  "Bills & Utilities",
  "Travel & Accommodation",
  "Health & Wellness",
  "Entertainment",
  "Education",
  "Financial Services & Fees",
  "Transfers",
  "Salary & Income",
  "Other",
] as const;

export type ReportCategory = typeof REPORT_CATEGORIES[number];
export type TransactionFlow = "expense" | "inflow";
export type ExpensePolarity = "negative-expense" | "positive-expense";

export interface ReportOverride {
  merchant?: string;
  category?: ReportCategory;
  flow?: TransactionFlow;
}

export interface ReportEntry {
  id: string;
  transaction: Transaction;
  date: string;
  description: string;
  merchant: string;
  category: ReportCategory;
  flow: TransactionFlow;
  amount: number;
  currency?: string;
}

export interface ReportAggregate {
  name: string;
  amount: number;
  count: number;
  category?: ReportCategory;
  share: number;
}

export interface StatementReport {
  entries: ReportEntry[];
  totalExpense: number;
  totalInflow: number;
  netFlow: number;
  expenseCount: number;
  inflowCount: number;
  merchants: ReportAggregate[];
  categories: ReportAggregate[];
  topMerchant?: ReportAggregate;
  topCategory?: ReportAggregate;
}

interface MerchantRule {
  merchant: string;
  category: ReportCategory;
  pattern: RegExp;
}

const MERCHANT_RULES: MerchantRule[] = [
  { merchant: "GrabFood", category: "Food & Beverage", pattern: /\bgrab\s*food\b|\bgrabfood\b/i },
  { merchant: "GoFood", category: "Food & Beverage", pattern: /\bgo\s*food\b|\bgofood\b/i },
  { merchant: "Grab", category: "Transportation", pattern: /\bgrab(?:car|bike|taxi|transport)?\b/i },
  { merchant: "Gojek", category: "Transportation", pattern: /\bgojek\b|\bgoride\b|\bgocar\b/i },
  { merchant: "Uber", category: "Transportation", pattern: /\buber\b/i },
  { merchant: "Bluebird", category: "Transportation", pattern: /\bblue\s*bird\b|\bbluebird\b/i },
  { merchant: "TransJakarta", category: "Transportation", pattern: /\btrans\s*jakarta\b|\btransjakarta\b/i },
  { merchant: "KAI", category: "Transportation", pattern: /\bkereta api\b|\bkai\b|\bcommuter(?:line)?\b/i },
  { merchant: "McDonald's", category: "Food & Beverage", pattern: /\bmcdonald'?s?\b|\bmcd\b/i },
  { merchant: "Starbucks", category: "Food & Beverage", pattern: /\bstarbucks\b/i },
  { merchant: "KFC", category: "Food & Beverage", pattern: /\bkfc\b|\bkentucky fried chicken\b/i },
  { merchant: "Pizza Hut", category: "Food & Beverage", pattern: /\bpizza\s*hut\b/i },
  { merchant: "Indomaret", category: "Groceries", pattern: /\bindomaret\b/i },
  { merchant: "Alfamart", category: "Groceries", pattern: /\balfamart\b|\balfaexpress\b/i },
  { merchant: "Super Indo", category: "Groceries", pattern: /\bsuper\s*indo\b/i },
  { merchant: "Hypermart", category: "Groceries", pattern: /\bhypermart\b/i },
  { merchant: "Transmart", category: "Groceries", pattern: /\btransmart\b/i },
  { merchant: "Tokopedia", category: "Shopping & Retail", pattern: /\btokopedia\b/i },
  { merchant: "Shopee", category: "Shopping & Retail", pattern: /\bshopee\b/i },
  { merchant: "Lazada", category: "Shopping & Retail", pattern: /\blazada\b/i },
  { merchant: "Blibli", category: "Shopping & Retail", pattern: /\bblibli\b/i },
  { merchant: "Amazon", category: "Shopping & Retail", pattern: /\bamazon\b/i },
  { merchant: "PLN", category: "Bills & Utilities", pattern: /\bpln\b|\blistrik\b|\belectric(?:ity)?\b/i },
  { merchant: "Telkom", category: "Bills & Utilities", pattern: /\btelkom(?:sel)?\b|\bindihome\b/i },
  { merchant: "XL Axiata", category: "Bills & Utilities", pattern: /\bxl\s*(?:axiata)?\b/i },
  { merchant: "Traveloka", category: "Travel & Accommodation", pattern: /\btraveloka\b/i },
  { merchant: "Agoda", category: "Travel & Accommodation", pattern: /\bagoda\b/i },
  { merchant: "Booking.com", category: "Travel & Accommodation", pattern: /\bbooking\.com\b/i },
  { merchant: "Airbnb", category: "Travel & Accommodation", pattern: /\bairbnb\b/i },
  { merchant: "Garuda Indonesia", category: "Travel & Accommodation", pattern: /\bgaruda(?: indonesia)?\b/i },
  { merchant: "Netflix", category: "Entertainment", pattern: /\bnetflix\b/i },
  { merchant: "Spotify", category: "Entertainment", pattern: /\bspotify\b/i },
  { merchant: "Steam", category: "Entertainment", pattern: /\bsteam(?:games)?\b/i },
  { merchant: "PlayStation", category: "Entertainment", pattern: /\bplaystation\b|\bpsn\b/i },
  { merchant: "Google Play", category: "Entertainment", pattern: /\bgoogle\s*play\b/i },
  { merchant: "Apple", category: "Entertainment", pattern: /\bapple\.com\/bill\b|\bitunes\b/i },
  { merchant: "Halodoc", category: "Health & Wellness", pattern: /\bhalodoc\b/i },
  { merchant: "Guardian", category: "Health & Wellness", pattern: /\bguardian\b/i },
  { merchant: "Watsons", category: "Health & Wellness", pattern: /\bwatsons\b/i },
  { merchant: "Coursera", category: "Education", pattern: /\bcoursera\b/i },
  { merchant: "Udemy", category: "Education", pattern: /\budemy\b/i },
];

const CATEGORY_RULES: Array<{ category: ReportCategory; pattern: RegExp }> = [
  { category: "Salary & Income", pattern: /\bsalary\b|\bpayroll\b|\bgaji\b|\bbonus\b/i },
  { category: "Transfers", pattern: /\btransfer\b|\btrf\b|\bremittance\b|\bbi[- ]?fast\b|\bwire\b/i },
  { category: "Financial Services & Fees", pattern: /\badmin(?:istration)? fee\b|\bbank fee\b|\binterest\b|\bannual fee\b|\blate fee\b|\btax\b/i },
  { category: "Food & Beverage", pattern: /\brestaurant\b|\bresto\b|\bcafe\b|\bcoffee\b|\bbakery\b|\bwarung\b|\bfood\b|\bdining\b|\bkitchen\b/i },
  { category: "Transportation", pattern: /\btaxi\b|\btransport\b|\btoll\b|\bparking\b|\bmetro\b|\bmrt\b|\bbus\b|\btrain\b|\bfuel\b|\bpetrol\b|\bgas station\b/i },
  { category: "Groceries", pattern: /\bsupermarket\b|\bgrocery\b|\bminimart\b|\bmarket\b|\bmart\b/i },
  { category: "Travel & Accommodation", pattern: /\bhotel\b|\bflight\b|\bairline\b|\btravel\b|\bresort\b|\bhostel\b/i },
  { category: "Health & Wellness", pattern: /\bhospital\b|\bclinic\b|\bpharmacy\b|\bmedical\b|\bdental\b|\bgym\b|\bfitness\b/i },
  { category: "Entertainment", pattern: /\bcinema\b|\bmovie\b|\bgame\b|\bsubscription\b|\bstreaming\b/i },
  { category: "Education", pattern: /\bschool\b|\buniversity\b|\bcourse\b|\btuition\b|\bbookstore\b/i },
  { category: "Bills & Utilities", pattern: /\butility\b|\bwater bill\b|\belectric\b|\btelephone\b|\binternet\b|\bmobile\b|\binsurance\b/i },
  { category: "Shopping & Retail", pattern: /\bshop\b|\bstore\b|\bretail\b|\bdepartment\b|\bfashion\b|\becommerce\b/i },
];

const DESCRIPTION_PREFIXES = /^(?:card purchase|debit card|credit card|pos|qris|purchase|payment(?: to)?|online payment|e-?commerce|ecm|sale|transaksi|trx|transfer(?: to| from)?)[\s:*-]+/i;

function titleCase(value: string): string {
  return value.toLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function cleanMerchantName(description: string): string {
  const cleaned = normalizeText(description)
    .replace(DESCRIPTION_PREFIXES, "")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/\b(?:ref|reference|trace|terminal|auth|txn|trx)\s*[:#-]?\s*[a-z0-9-]+\b/gi, "")
    .replace(/\b\d{6,}\b/g, "")
    .replace(/\s+(?:id|idn|indonesia|sg|sgp|uk|usa|us)$/i, "")
    .replace(/[*/|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Unidentified merchant";
  return titleCase(cleaned.split(" ").slice(0, 5).join(" "));
}

export function inferMerchant(description: string): { merchant: string; category: ReportCategory } {
  for (const rule of MERCHANT_RULES) {
    if (rule.pattern.test(description)) return { merchant: rule.merchant, category: rule.category };
  }
  const merchant = cleanMerchantName(description);
  const category = CATEGORY_RULES.find((rule) => rule.pattern.test(`${description} ${merchant}`))?.category ?? "Other";
  return { merchant, category };
}

export function inferExpensePolarity(statement: ParsedStatement): ExpensePolarity {
  return /credit[\s_-]*card|billing[\s_-]*statement|kartu[\s_-]*kredit|visa|mastercard|amex/i.test(statement.fileName)
    ? "positive-expense"
    : "negative-expense";
}

function hasExplicitDebitCredit(statement: ParsedStatement, transaction: Transaction): boolean {
  return statement.mappings.some((mapping) => {
    if (mapping.role !== "debit" && mapping.role !== "credit") return false;
    return normalizeText(transaction.raw[mapping.source]) !== "";
  });
}

function transactionFlow(statement: ParsedStatement, transaction: Transaction, polarity: ExpensePolarity): TransactionFlow {
  if (hasExplicitDebitCredit(statement, transaction)) {
    if (transaction.debit > 0 && transaction.credit === 0) return "expense";
    if (transaction.credit > 0 && transaction.debit === 0) return "inflow";
  }
  if (polarity === "positive-expense") return transaction.amount >= 0 ? "expense" : "inflow";
  return transaction.amount < 0 ? "expense" : "inflow";
}

function aggregate(entries: ReportEntry[], key: "merchant" | "category", totalExpense: number): ReportAggregate[] {
  const values = new Map<string, { amount: number; count: number; category?: ReportCategory }>();
  for (const entry of entries) {
    if (entry.flow !== "expense") continue;
    const name = entry[key];
    const current = values.get(name) ?? { amount: 0, count: 0, category: key === "merchant" ? entry.category : undefined };
    current.amount += entry.amount;
    current.count += 1;
    values.set(name, current);
  }
  return [...values.entries()]
    .map(([name, value]) => ({ name, ...value, share: totalExpense ? value.amount / totalExpense : 0 }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
}

export function buildStatementReport(
  statement: ParsedStatement,
  polarity: ExpensePolarity = inferExpensePolarity(statement),
  overrides: Record<string, ReportOverride> = {},
): StatementReport {
  const entries = statement.transactions.map((transaction): ReportEntry => {
    const inferred = inferMerchant(transaction.description);
    const override = overrides[transaction.id];
    const flow = override?.flow ?? transactionFlow(statement, transaction, polarity);
    let category = override?.category ?? inferred.category;
    if (!override?.category && flow === "inflow") {
      category = CATEGORY_RULES.find((rule) => rule.category === "Salary & Income" && rule.pattern.test(transaction.description))?.category
        ?? (CATEGORY_RULES.find((rule) => rule.category === "Transfers" && rule.pattern.test(transaction.description))?.category)
        ?? category;
    }
    return {
      id: transaction.id,
      transaction,
      date: transaction.date,
      description: transaction.description,
      merchant: override?.merchant?.trim() || inferred.merchant,
      category,
      flow,
      amount: Math.abs(transaction.amount || transaction.debit || transaction.credit),
      currency: transaction.currency,
    };
  }).filter((entry) => entry.amount > 0);

  const totalExpense = entries.filter((entry) => entry.flow === "expense").reduce((sum, entry) => sum + entry.amount, 0);
  const totalInflow = entries.filter((entry) => entry.flow === "inflow").reduce((sum, entry) => sum + entry.amount, 0);
  const merchants = aggregate(entries, "merchant", totalExpense);
  const categories = aggregate(entries, "category", totalExpense);
  return {
    entries,
    totalExpense,
    totalInflow,
    netFlow: totalInflow - totalExpense,
    expenseCount: entries.filter((entry) => entry.flow === "expense").length,
    inflowCount: entries.filter((entry) => entry.flow === "inflow").length,
    merchants,
    categories,
    topMerchant: merchants[0],
    topCategory: categories[0],
  };
}
