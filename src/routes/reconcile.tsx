import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, FileText, Loader2, Play, RefreshCw, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { extractReconciliationDocument, type ReconciliationExtractResult } from "@/lib/reconciliation-extract.functions";
import { reconcileRows, type ReconciliationResult, type ReconciliationRow } from "@/lib/reconciliation";

export const Route = createFileRoute("/reconcile")({ component: ReconcilePage });

type Side = "expected" | "actual";
type LoadedSource = {
  fileName: string;
  provider: string;
  currency: string;
  rows: ReconciliationRow[];
  warnings: string[];
};

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"' && quoted) {
      current += '"';
      i++;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else current += char;
  }
  values.push(current.trim());
  return values;
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pick(row: Record<string, string>, candidates: string[]) {
  for (const candidate of candidates) {
    const key = Object.keys(row).find((k) => candidates.includes(normalizeHeader(k)) && normalizeHeader(k) === candidate);
    if (key && row[key]) return row[key];
  }
  return "";
}

function parseAmount(value: string) {
  if (!value) return 0;
  const cleaned = value.replace(/[^0-9,.-]/g, "");
  if (cleaned.includes(",") && cleaned.includes(".")) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    return Math.abs(Number(lastComma > lastDot ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, "")) || 0);
  }
  if ((cleaned.match(/,/g) ?? []).length > 1) return Math.abs(Number(cleaned.replace(/,/g, "")) || 0);
  return Math.abs(Number(cleaned.replace(",", ".")) || 0);
}

function parseCsv(text: string, role: Side): LoadedSource {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV must contain a header and at least one data row.");
  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map(parseCsvLine).map((values) => Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""])));

  const normalized: ReconciliationRow[] = rows
    .map((row, index) => {
      const amount = parseAmount(pick(row, ["netamount", "net", "settlementamount", "amount", "credit", "receivedamount"]));
      const grossAmount = parseAmount(pick(row, ["grossamount", "gross", "transactionamount"]));
      const feeAmount = parseAmount(pick(row, ["feeamount", "fee", "mdr", "mdrfee", "adminfee"]));
      const rawDate = pick(row, ["settlementdate", "postingdate", "valuedate", "transactiondate", "date"]);
      const parsedDate = rawDate ? new Date(rawDate) : null;
      const date = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString().slice(0, 10) : rawDate.slice(0, 10);
      return {
        id: `${role}-csv-${index}`,
        date,
        reference: pick(row, ["settlementid", "transactionid", "reference", "referenceno", "rrn", "trxid", "id"]),
        description: pick(row, ["description", "narration", "remarks", "merchant", "counterparty"]),
        amount: amount || Math.max(0, grossAmount - feeAmount),
        currency: pick(row, ["currency", "ccy"]) || "IDR",
        ...(grossAmount ? { grossAmount } : {}),
        ...(feeAmount ? { feeAmount } : {}),
        ...(amount ? { netAmount: amount } : {}),
      };
    })
    .filter((row) => row.amount > 0);

  return { fileName: "CSV upload", provider: "CSV", currency: normalized[0]?.currency ?? "IDR", rows: normalized, warnings: [] };
}

function money(value: number, currency = "IDR") {
  try {
    return new Intl.NumberFormat("id-ID", { style: "currency", currency, maximumFractionDigits: currency === "IDR" ? 0 : 2 }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString()}`;
  }
}

function ReconcilePage() {
  const extract = useServerFn(extractReconciliationDocument);
  const [expected, setExpected] = useState<LoadedSource | null>(null);
  const [actual, setActual] = useState<LoadedSource | null>(null);
  const [busySide, setBusySide] = useState<Side | null>(null);
  const [amountTolerance, setAmountTolerance] = useState(100);
  const [dateToleranceDays, setDateToleranceDays] = useState(2);
  const [result, setResult] = useState<ReconciliationResult | null>(null);

  const currency = expected?.currency || actual?.currency || "IDR";
  const exceptions = useMemo(() => result?.matches.filter((m) => m.status !== "matched") ?? [], [result]);

  async function loadFile(file: File, side: Side) {
    setBusySide(side);
    setResult(null);
    try {
      let loaded: LoadedSource;
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        const dataBase64 = await fileToBase64(file);
        const extracted: ReconciliationExtractResult = await extract({
          data: { fileName: file.name, mimeType: "application/pdf", dataBase64, role: side },
        });
        loaded = { fileName: file.name, provider: extracted.provider, currency: extracted.currency, rows: extracted.rows, warnings: extracted.warnings };
      } else if (file.type === "text/csv" || file.name.toLowerCase().endsWith(".csv")) {
        loaded = parseCsv(await file.text(), side);
        loaded.fileName = file.name;
      } else throw new Error("Please upload a PDF or CSV file in this MVP.");

      if (loaded.rows.length === 0) throw new Error("No settlement rows could be extracted from this file.");
      side === "expected" ? setExpected(loaded) : setActual(loaded);
      toast.success(`${file.name}: ${loaded.rows.length} reconciliation row(s) ready.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read this file.");
    } finally {
      setBusySide(null);
    }
  }

  function runReconciliation() {
    if (!expected || !actual) return;
    setResult(reconcileRows(expected.rows, actual.rows, { amountTolerance, dateToleranceDays }));
  }

  return (
    <div className="min-h-screen bg-gradient-hero">
      <Header />
      <main className="mx-auto w-full max-w-7xl px-4 pb-24 pt-10 sm:px-6">
        <section className="mb-8">
          <p className="text-sm font-semibold text-primary">Settlement Reconciliation</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Find settlement discrepancies without spreadsheet archaeology.</h1>
          <p className="mt-3 max-w-3xl text-muted-foreground">Upload what you expected to receive and what the bank or settlement provider actually posted. PDF extraction normalizes the documents first; deterministic rules perform the financial matching.</p>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <SourceCard title="1. Expected transactions" description="Gateway, marketplace, POS, or internal settlement report." side="expected" source={expected} busy={busySide === "expected"} onFile={loadFile} />
          <SourceCard title="2. Actual settlement" description="Bank statement or actual settlement report." side="actual" source={actual} busy={busySide === "actual"} onFile={loadFile} />
        </div>

        <Card className="mt-6 rounded-2xl">
          <CardHeader>
            <CardTitle>Matching rules</CardTitle>
            <CardDescription>These controls affect matching only. AI does not decide whether a discrepancy is acceptable.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="text-sm font-medium">Amount tolerance
              <Input className="mt-2" type="number" min={0} value={amountTolerance} onChange={(e) => setAmountTolerance(Math.max(0, Number(e.target.value) || 0))} />
            </label>
            <label className="text-sm font-medium">Date tolerance (days)
              <Input className="mt-2" type="number" min={0} max={30} value={dateToleranceDays} onChange={(e) => setDateToleranceDays(Math.max(0, Number(e.target.value) || 0))} />
            </label>
            <Button size="lg" onClick={runReconciliation} disabled={!expected || !actual || !!busySide} className="bg-gradient-brand text-primary-foreground">
              <Play className="mr-2 h-4 w-4" /> Run reconciliation
            </Button>
          </CardContent>
        </Card>

        {result && (
          <section className="mt-8 space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Match rate" value={`${result.summary.matchRate.toFixed(1)}%`} detail={`${result.summary.matchedCount} matched`} />
              <Metric label="Exceptions" value={String(result.summary.exceptionCount)} detail={`${result.summary.missingCount} missing`} />
              <Metric label="Expected value" value={money(result.summary.expectedValue, currency)} detail={`${result.summary.totalExpected} rows`} />
              <Metric label="Actual value" value={money(result.summary.actualValue, currency)} detail={`${result.summary.totalActual} rows`} />
            </div>

            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle>Exceptions requiring review</CardTitle>
                <CardDescription>Only records that failed the configured rules are shown here.</CardDescription>
              </CardHeader>
              <CardContent>
                {exceptions.length === 0 && result.unmatchedActual.length === 0 ? (
                  <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/10 p-4 text-success"><CheckCircle2 className="h-5 w-5" /> Everything reconciled under the current rules.</div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full min-w-[900px] text-left text-sm">
                      <thead className="bg-muted text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Status</th><th className="px-3 py-2">Expected</th><th className="px-3 py-2">Actual</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2">Date</th><th className="px-3 py-2 text-right">Variance</th><th className="px-3 py-2">Reason</th></tr></thead>
                      <tbody>
                        {exceptions.map((match) => (
                          <tr key={match.expected.id} className="border-t align-top">
                            <td className="px-3 py-3"><span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-1 text-xs font-semibold text-destructive"><AlertTriangle className="h-3 w-3" />{match.status.replaceAll("_", " ")}</span></td>
                            <td className="px-3 py-3 font-mono">{money(match.expected.netAmount ?? match.expected.amount, match.expected.currency)}</td>
                            <td className="px-3 py-3 font-mono">{match.actual ? money(match.actual.netAmount ?? match.actual.amount, match.actual.currency) : "—"}</td>
                            <td className="px-3 py-3">{match.expected.reference || match.actual?.reference || "—"}</td>
                            <td className="px-3 py-3">{match.expected.date}{match.actual ? ` → ${match.actual.date}` : ""}</td>
                            <td className="px-3 py-3 text-right font-mono">{money(match.variance, match.expected.currency)}</td>
                            <td className="max-w-sm px-3 py-3 text-muted-foreground">{match.reason}</td>
                          </tr>
                        ))}
                        {result.unmatchedActual.map((row) => (
                          <tr key={`extra-${row.id}`} className="border-t align-top">
                            <td className="px-3 py-3"><span className="rounded-full bg-warning/10 px-2 py-1 text-xs font-semibold text-warning">unmatched actual</span></td>
                            <td className="px-3 py-3">—</td><td className="px-3 py-3 font-mono">{money(row.netAmount ?? row.amount, row.currency)}</td><td className="px-3 py-3">{row.reference || "—"}</td><td className="px-3 py-3">{row.date}</td><td className="px-3 py-3 text-right font-mono">{money(row.netAmount ?? row.amount, row.currency)}</td><td className="px-3 py-3 text-muted-foreground">Actual settlement row has no expected counterpart.</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        )}
      </main>
    </div>
  );
}

function SourceCard({ title, description, side, source, busy, onFile }: { title: string; description: string; side: Side; source: LoadedSource | null; busy: boolean; onFile: (file: File, side: Side) => void }) {
  return (
    <Card className="rounded-2xl">
      <CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader>
      <CardContent>
        <label className="flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border p-6 text-center transition hover:border-primary/50 hover:bg-primary/5">
          <input type="file" className="hidden" accept=".pdf,.csv,application/pdf,text/csv" onChange={(e) => { const file = e.target.files?.[0]; if (file) void onFile(file, side); e.currentTarget.value = ""; }} />
          {busy ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : source ? (source.fileName.endsWith(".csv") ? <FileSpreadsheet className="h-8 w-8 text-primary" /> : <FileText className="h-8 w-8 text-primary" />) : <UploadCloud className="h-8 w-8 text-primary" />}
          <p className="mt-3 font-semibold">{busy ? "Reading financial data…" : source ? source.fileName : "Choose PDF or CSV"}</p>
          <p className="mt-1 text-xs text-muted-foreground">{source ? `${source.provider} · ${source.rows.length} row(s) · ${source.currency}` : "PDF bank statements and settlement reports are supported"}</p>
          {source && <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary"><RefreshCw className="h-3 w-3" /> Replace file</span>}
        </label>
        {source?.warnings?.length ? <div className="mt-3 rounded-xl border border-warning/30 bg-warning/5 p-3 text-xs text-muted-foreground">{source.warnings.join(" · ")}</div> : null}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <Card className="rounded-2xl"><CardContent className="p-5"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></CardContent></Card>;
}
