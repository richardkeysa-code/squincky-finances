import type { BankProfile, ColumnRole, DateOrder } from "./types";

export const GLOBAL_HEADER_SYNONYMS: Record<ColumnRole, string[]> = {
  date: [
    "date", "transaction date", "trans date", "posting date", "post date", "book date",
    "booking date", "datum", "fecha", "data", "tanggal", "tgl", "txn date", "tran date",
  ],
  valueDate: ["value date", "effective date", "settlement date", "valuta", "valutadatum", "tanggal efektif"],
  description: [
    "description", "details", "transaction details", "transaction description", "narration",
    "particulars", "memo", "payee", "merchant", "remarks", "keterangan", "uraian", "omschrijving",
    "libelle", "buchungstext", "concepto", "detalhes", "descricao", "transaction", "activity",
  ],
  reference: [
    "reference", "reference no", "ref no", "transaction id", "transaction no", "cheque no",
    "check number", "chq no", "document no", "confirmation", "nomor referensi", "no referensi",
  ],
  debit: [
    "debit", "withdrawal", "withdrawals", "money out", "paid out", "charge", "charges",
    "payments", "amount debited", "debit amount", "dr", "keluar", "mutasi debit", "abgang",
    "cargo", "cargos", "debito", "sortie", "prelevement",
  ],
  credit: [
    "credit", "deposit", "deposits", "money in", "paid in", "receipts", "amount credited",
    "credit amount", "cr", "masuk", "mutasi kredit", "zugang", "abono", "abonos", "credito", "entree", "versement",
  ],
  amount: [
    "amount", "transaction amount", "net amount", "value", "sum", "importe", "betrag",
    "montant", "jumlah", "nominal", "bedrag", "valor", "importe",
  ],
  balance: [
    "balance", "running balance", "closing balance", "available balance", "ledger balance",
    "saldo", "new balance", "account balance", "solde", "saldo disponible", "kontostand",
  ],
  currency: ["currency", "ccy", "curr", "mata uang", "devise", "waehrung"],
  ignore: [],
};

const hints = (overrides: Partial<Record<ColumnRole, string[]>>) => overrides;

export const BANK_PROFILES: BankProfile[] = [
  // Indonesia
  { id: "jenius", name: "Jenius (BTPN)", region: "Indonesia", detect: ["jenius", "bank btpn", "$cashtag"], dateOrder: "DMY", headerHints: hints({ description: ["transaction name", "catatan"], amount: ["amount"] }) },
  { id: "bca", name: "Bank Central Asia (BCA)", region: "Indonesia", detect: ["bank central asia", "klikbca", "bca mobile"], dateOrder: "DMY", headerHints: hints({ description: ["keterangan"], amount: ["mutasi"], balance: ["saldo"] }) },
  { id: "mandiri", name: "Bank Mandiri", region: "Indonesia", detect: ["bank mandiri", "livin' by mandiri", "kopra by mandiri"], dateOrder: "DMY", headerHints: hints({ description: ["keterangan transaksi"], debit: ["debit"], credit: ["kredit"] }) },
  { id: "bni", name: "Bank Negara Indonesia (BNI)", region: "Indonesia", detect: ["bank negara indonesia", "bni direct", "bni mobile banking"], dateOrder: "DMY" },
  { id: "bri", name: "Bank Rakyat Indonesia (BRI)", region: "Indonesia", detect: ["bank rakyat indonesia", "bri", "brimo"], dateOrder: "DMY" },
  // United States
  { id: "chase", name: "JPMorgan Chase", region: "United States", detect: ["jpmorgan chase", "chase.com", "chase bank"], dateOrder: "MDY", headerHints: hints({ description: ["description"], amount: ["amount"], balance: ["balance"] }) },
  { id: "bank-of-america", name: "Bank of America", region: "United States", detect: ["bank of america", "bankofamerica.com"], dateOrder: "MDY" },
  { id: "wells-fargo", name: "Wells Fargo", region: "United States", detect: ["wells fargo", "wellsfargo.com"], dateOrder: "MDY" },
  { id: "capital-one", name: "Capital One", region: "United States", detect: ["capital one", "capitalone.com"], dateOrder: "MDY", headerHints: hints({ debit: ["debit"], credit: ["credit"] }) },
  { id: "american-express", name: "American Express", region: "Global", detect: ["american express", "amex"], dateOrder: "MDY", headerHints: hints({ amount: ["amount"] }) },
  // United Kingdom
  { id: "hsbc-uk", name: "HSBC", region: "United Kingdom / Global", detect: ["hsbc uk", "hsbc bank", "the hongkong and shanghai banking corporation"], dateOrder: "DMY", headerHints: hints({ debit: ["money out", "paid out"], credit: ["money in", "paid in"] }) },
  { id: "barclays", name: "Barclays", region: "United Kingdom", detect: ["barclays bank", "barclays.co.uk"], dateOrder: "DMY", headerHints: hints({ description: ["description"], debit: ["money out"], credit: ["money in"] }) },
  { id: "lloyds", name: "Lloyds Bank", region: "United Kingdom", detect: ["lloyds bank", "lloydsbank.com"], dateOrder: "DMY" },
  { id: "natwest", name: "NatWest", region: "United Kingdom", detect: ["natwest", "national westminster bank"], dateOrder: "DMY" },
  // Europe / fintech
  { id: "deutsche-bank", name: "Deutsche Bank", region: "Germany", detect: ["deutsche bank", "deutsche-bank.de"], dateOrder: "DMY", headerHints: hints({ date: ["buchungstag"], valueDate: ["wertstellung"], description: ["buchungstext"], amount: ["umsatz"] }) },
  { id: "ing", name: "ING", region: "Europe / Global", detect: ["ing bank", "ing-diba", "mijn ing"], dateOrder: "DMY", headerHints: hints({ description: ["omschrijving"], amount: ["bedrag"] }) },
  { id: "n26", name: "N26", region: "Europe", detect: ["n26 bank", "n26.com"], dateOrder: "DMY", headerHints: hints({ description: ["payee", "payment reference"], amount: ["amount"] }) },
  { id: "revolut", name: "Revolut", region: "Global", detect: ["revolut", "revolut ltd", "revolut bank"], dateOrder: "DMY", headerHints: hints({ date: ["completed date"], description: ["description"], amount: ["amount"], balance: ["balance"] }) },
  // Canada
  { id: "rbc", name: "Royal Bank of Canada (RBC)", region: "Canada", detect: ["royal bank of canada", "rbc royal bank", "rbc.com"], dateOrder: "MDY" },
  { id: "td-canada", name: "TD Canada Trust", region: "Canada", detect: ["td canada trust", "toronto-dominion bank"], dateOrder: "MDY" },
  { id: "bmo", name: "Bank of Montreal (BMO)", region: "Canada", detect: ["bank of montreal", "bmo bank of montreal"], dateOrder: "MDY" },
  // Australia / New Zealand
  { id: "commbank", name: "Commonwealth Bank", region: "Australia", detect: ["commonwealth bank of australia", "commbank", "netbank"], dateOrder: "DMY" },
  { id: "anz", name: "ANZ", region: "Australia / New Zealand", detect: ["australia and new zealand banking group", "anz bank", "anz.com"], dateOrder: "DMY" },
  { id: "westpac", name: "Westpac", region: "Australia / New Zealand", detect: ["westpac banking corporation", "westpac"], dateOrder: "DMY" },
  // Singapore
  { id: "dbs", name: "DBS / POSB", region: "Singapore", detect: ["dbs bank", "posb", "digibank by dbs"], dateOrder: "DMY", headerHints: hints({ debit: ["withdrawal"], credit: ["deposit"] }) },
  { id: "ocbc", name: "OCBC", region: "Singapore", detect: ["oversea-chinese banking corporation", "ocbc bank", "ocbc.com"], dateOrder: "DMY" },
  { id: "uob", name: "United Overseas Bank (UOB)", region: "Singapore", detect: ["united overseas bank", "uob bank", "uob.com.sg"], dateOrder: "DMY" },
  // India
  { id: "hdfc", name: "HDFC Bank", region: "India", detect: ["hdfc bank", "hdfcbank.com"], dateOrder: "DMY", headerHints: hints({ description: ["narration"], reference: ["chq./ref.no."], debit: ["withdrawal amt."], credit: ["deposit amt."], balance: ["closing balance"] }) },
  { id: "sbi", name: "State Bank of India", region: "India", detect: ["state bank of india", "onlinesbi", "sbi.co.in"], dateOrder: "DMY", headerHints: hints({ description: ["description"], reference: ["ref no./cheque no."], debit: ["debit"], credit: ["credit"] }) },
  { id: "icici", name: "ICICI Bank", region: "India", detect: ["icici bank", "icicibank.com"], dateOrder: "DMY", headerHints: hints({ description: ["transaction remarks"], debit: ["withdrawal amount"], credit: ["deposit amount"] }) },
  { id: "axis", name: "Axis Bank", region: "India", detect: ["axis bank", "axisbank.com"], dateOrder: "DMY", headerHints: hints({ description: ["particulars"], debit: ["withdrawals"], credit: ["deposits"] }) },
];

export const GENERIC_PROFILE: BankProfile = {
  id: "generic",
  name: "Generic bank statement",
  region: "Automatic",
  detect: [],
  dateOrder: "DMY",
};

export function detectBankProfile(text: string): BankProfile {
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  let winner = GENERIC_PROFILE;
  let bestScore = 0;

  for (const profile of BANK_PROFILES) {
    const score = profile.detect.reduce((total, token) => total + (normalized.includes(token) ? token.length : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      winner = profile;
    }
  }
  return winner;
}

export function allSynonyms(profile: BankProfile, role: ColumnRole): string[] {
  return [...(profile.headerHints?.[role] ?? []), ...GLOBAL_HEADER_SYNONYMS[role]];
}

export function defaultDateOrderForLocale(locale: string): DateOrder {
  return /(^|[-_])(US|CA)([-_]|$)/i.test(locale) ? "MDY" : "DMY";
}
