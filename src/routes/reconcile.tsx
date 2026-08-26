import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Plus,
  Play,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { extractReconciliationDocument, type ReconciliationExtractResult } from "@/lib/reconciliation-extract.functions";
import {
  reconcileRows,
  type ReconciliationMatch,
  type ReconciliationResult,
  type ReconciliationRow,
} from "@/lib/reconciliation";
import { downloadXlsx, parseXlsxRecords, type XlsxCell, type XlsxSheet } from "@/lib/xlsx-lite";

export const Route = createFileRoute("/reconcile")({ component: ReconcilePage });

type Side = "expected" | "actual";
type NumericField = "amount" | "grossAmount" | "feeAmount" | "netAmount";
type TextField = "date" | "reference" | "description";
type EditableField = NumericField | TextField;

type LoadedSource = {
  fileName: string;
  provider: string;
  currency: string;
  rows: ReconciliationRow[];
  warnings: string[];
  confirmed: boolean;
};

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function detectDelimiter(line: string) {
  const counts = [",", ";", "\t"].map((delimiter) => ({ delimiter, count: line.split(delimiter).length - 1 }));
  return counts.sort((a, b) => b.count - a.count)[0]?.delimiter ?? ",";
}

function parseDelimitedLine(line: string, delimiter: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"' && quoted) {
      current += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function parseCsvRecords(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV must contain a header and at least one data row.");
  const delimiter = detectDelimiter(lines[0]);
  const headers = parseDelimitedLine(lines[0], delimiter);
  return lines
    .slice(1)
    .map((line) => parseDelimitedLine(line, delimiter))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pick(row: Record<string, string>, candidates: string[]) {
  const indexed = new Map(Object.keys(row).map((key) => [normalizeHeader(key), key]));
  for (const candidate of candidates) {
    const key = indexed.get(candidate);
    if (key && String(row[key]).trim()) return String(row[key]).trim();
  }
  return "";
}

function parseAmount(value: string) {
  if (!value) return 0;
  const cleaned = value.replace(/[^0-9,.-]/g, "");
  if (!cleaned) return 0;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    return Math.abs(Number(lastComma > lastDot ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, "")) || 0);
  }
  if ((cleaned.match(/,/g) ?? []).length > 1) return Math.abs(Number(cleaned.replace(/,/g, "")) || 0);
  if ((cleaned.match(/\./g) ?? []).length > 1) return Math.abs(Number(cleaned.replace(/\./g, "")) || 0);
  return Math.abs(Number(cleaned.replace(",", ".")) || 0);
}

function parseDate(raw: string) {
  const value = raw.trim();
  if (!value) return "";

  const serial = Number(value);
  if (/^\d+(?:\.\d+)?$/.test(value) && serial >= 20_000 && serial <= 80_000) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return new Date(excelEpoch + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
  }

  const iso = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;

  const dmy = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (dmy) {
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    return `${year}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value.slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function normalizeRecords(records: Record<string, string>[], role: Side, fileName: string, provider: string): LoadedSource {
  const rows: ReconciliationRow[] = records
    .map((row, index) => {
      const netAmount = parseAmount(pick(row, ["netamount", "net", "netsettlement", "settlementamount", "settlementvalue", "receivedamount", "credit", "kredit"]));
      const directAmount = parseAmount(pick(row, ["amount", "value", "nominal", "transactionamount", "trxamount"]));
      const grossAmount = parseAmount(pick(row, ["grossamount", "gross", "transactionamount", "trxamount", "totalamount"]));
      const feeAmount = parseAmount(pick(row, ["feeamount", "fee", "fees", "mdr", "mdrfee", "adminfee", "processingfee"]));
      const amount = netAmount || directAmount || Math.max(0, grossAmount - feeAmount);
      const currency = pick(row, ["currency", "ccy", "curr"]) || "IDR";
      return {
        id: `${role}-table-${index}`,
        date: parseDate(pick(row, ["settlementdate", "postingdate", "posteddate", "valuedate", "transactiondate", "trxdate", "date", "tanggal"])),
        reference: pick(row, ["settlementid", "batchid", "transactionid", "transactionno", "reference", "referenceno", "ref", "rrn", "trxid", "invoiceid", "id"]),
        description: pick(row, ["description", "narration", "remarks", "remark", "keterangan", "merchant", "counterparty", "details"]),
        amount,
        currency,
        ...(grossAmount > 0 ? { grossAmount } : {}),
        ...(feeAmount > 0 ? { feeAmount } : {}),
        ...(netAmount > 0 ? { netAmount } : {}),
      } satisfies ReconciliationRow;
    })
    .filter((row) => row.amount > 0);

  return {
    fileName,
    provider,
    currency: rows[0]?.currency ?? "IDR",
    rows,
    confirmed: false,
    warnings: ["Column mapping was inferred automatically. Review the extracted rows before confirming."],
  };
}

function money(value: number, currency = "IDR") {
  try {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "IDR" ? 0 : 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString()}`;
  }
}

function uniqueSummary(values: string[], max = 3) {
  const unique = [...new Set(values.filter(Boolean))];
  if (unique.length === 0) return "—";
  if (unique.length <= max) return unique.join(", ");
  return `${unique.slice(0, max).join(", ")} +${unique.length - max} more`;
}

function sourceSheet(source: LoadedSource): XlsxSheet {
  return {
    name: source.fileName.toLowerCase().includes("actual") ? "Actual Source" : "Source",
    rows: [
      ["Date", "Reference", "Description", "Amount", "Gross Amount", "Fee Amount", "Net Amount", "Currency"],
      ...source.rows.map((row) => [row.date, row.reference, row.description, row.amount, row.grossAmount ?? "", row.feeAmount ?? "", row.netAmount ?? "", row.currency]),
    ],
  };
}

function matchReportRow(match: ReconciliationMatch): XlsxCell[] {
  return [
    match.status,
    match.matchType,
    match.expectedRows.length,
    uniqueSummary(match.expectedRows.map((row) => row.reference), 10),
    uniqueSummary(match.actualRows.map((row) => row.reference), 10),
    uniqueSummary(match.expectedRows.map((row) => row.date), 10),
    uniqueSummary(match.actualRows.map((row) => row.date), 10),
    match.expectedValue,
    match.actualValue,
    match.variance,
    match.confidence,
    match.reason,
  ];
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
  const exceptions = useMemo(() => result?.matches.filter((match) => match.status !== "matched") ?? [], [result]);
  const batchMatches = useMemo(() => result?.matches.filter((match) => match.status === "matched" && match.matchType === "many_to_one") ?? [], [result]);

  function setSource(side: Side, updater: (source: LoadedSource) => LoadedSource) {
    setResult(null);
    if (side === "expected") setExpected((source) => (source ? updater(source) : source));
    else setActual((source) => (source ? updater(source) : source));
  }

  async function loadFile(file: File, side: Side) {
    setBusySide(side);
    setResult(null);
    try {
      let loaded: LoadedSource;
      const lowerName = file.name.toLowerCase();
      if (file.type === "application/pdf" || lowerName.endsWith(".pdf")) {
        const dataBase64 = await fileToBase64(file);
        const extracted: ReconciliationExtractResult = await extract({
          data: { fileName: file.name, mimeType: "application/pdf", dataBase64, role: side },
        });
        loaded = {
          fileName: file.name,
          provider: extracted.provider,
          currency: extracted.currency,
          rows: extracted.rows,
          warnings: extracted.warnings,
          confirmed: false,
        };
      } else if (file.type === "text/csv" || lowerName.endsWith(".csv")) {
        loaded = normalizeRecords(parseCsvRecords(await file.text()), side, file.name, "CSV");
      } else if (lowerName.endsWith(".xlsx") || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
        loaded = normalizeRecords(await parseXlsxRecords(file), side, file.name, "Excel workbook");
      } else {
        throw new Error("Please upload a PDF, CSV, or XLSX file.");
      }

      if (loaded.rows.length === 0) throw new Error("No settlement rows could be extracted from this file.");
      side === "expected" ? setExpected(loaded) : setActual(loaded);
      toast.success(`${file.name}: ${loaded.rows.length} reconciliation row(s) extracted. Please review and confirm them.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read this file.");
    } finally {
      setBusySide(null);
    }
  }

  function editRow(side: Side, rowIndex: number, field: EditableField, value: string) {
    setSource(side, (source) => ({
      ...source,
      confirmed: false,
      rows: source.rows.map((row, index) => {
        if (index !== rowIndex) return row;
        if (field === "amount" || field === "grossAmount" || field === "feeAmount" || field === "netAmount") {
          const numeric = Math.abs(Number(value) || 0);
          if (field === "amount") return { ...row, amount: numeric };
          if (!value.trim()) {
            const clone = { ...row };
            delete clone[field];
            return clone;
          }
          return { ...row, [field]: numeric };
        }
        return { ...row, [field]: value };
      }),
    }));
  }

  function deleteRow(side: Side, rowIndex: number) {
    setSource(side, (source) => ({ ...source, confirmed: false, rows: source.rows.filter((_, index) => index !== rowIndex) }));
  }

  function addRow(side: Side) {
    setSource(side, (source) => ({
      ...source,
      confirmed: false,
      rows: [
        ...source.rows,
        {
          id: `${side}-manual-${Date.now()}`,
          date: new Date().toISOString().slice(0, 10),
          reference: "",
          description: "Manual row",
          amount: 0,
          currency: source.currency,
        },
      ],
    }));
  }

  function confirmSource(side: Side) {
    setSource(side, (source) => ({ ...source, confirmed: true }));
    toast.success(`${side === "expected" ? "Expected" : "Actual"} extraction confirmed.`);
  }

  function runReconciliation() {
    if (!expected || !actual) return;
    if (!expected.confirmed || !actual.confirmed) {
      toast.error("Review and confirm both extracted datasets before running reconciliation.");
      return;
    }
    if (expected.rows.some((row) => !row.date || row.amount <= 0) || actual.rows.some((row) => !row.date || row.amount <= 0)) {
      toast.error("Every row needs a date and a positive amount before reconciliation.");
      return;
    }
    setResult(reconcileRows(expected.rows, actual.rows, { amountTolerance, dateToleranceDays }));
  }

  function downloadReport() {
    if (!result || !expected || !actual) return;
    const matchHeader: XlsxCell[] = [
      "Status",
      "Match Type",
      "Expected Row Count",
      "Expected References",
      "Actual References",
      "Expected Dates",
      "Actual Dates",
      "Expected Value",
      "Actual Value",
      "Variance",
      "Confidence",
      "Reason",
    ];
    const summaryRows: XlsxCell[][] = [
      ["Settlement Reconciliation Report"],
      ["Generated", new Date().toISOString()],
      ["Expected file", expected.fileName],
      ["Expected provider", expected.provider],
      ["Actual file", actual.fileName],
      ["Actual provider", actual.provider],
      ["Amount tolerance", amountTolerance],
      ["Date tolerance (days)", dateToleranceDays],
      [],
      ["Metric", "Value"],
      ["Match rate", result.summary.matchRate / 100],
      ["Matched expected rows", result.summary.matchedCount],
      ["Matched groups", result.summary.matchedGroupCount],
      ["Many-to-one batches", result.summary.batchMatchedCount],
      ["Exceptions", result.summary.exceptionCount],
      ["Missing expected rows", result.summary.missingCount],
      ["Amount mismatches", result.summary.amountMismatchCount],
      ["Date mismatches", result.summary.dateMismatchCount],
      ["Unmatched actual rows", result.summary.unmatchedActualCount],
      ["Expected value", result.summary.expectedValue],
      ["Actual value", result.summary.actualValue],
      ["Matched value", result.summary.matchedValue],
      ["Exception value", result.summary.exceptionValue],
    ];
    const unmatchedActualRows: XlsxCell[][] = [
      ["Date", "Reference", "Description", "Amount", "Currency"],
      ...result.unmatchedActual.map((row) => [row.date, row.reference, row.description, row.netAmount ?? row.amount, row.currency]),
    ];
    const expectedSheet = sourceSheet({ ...expected, fileName: "Expected Source" });
    expectedSheet.name = "Expected Source";
    const actualSheet = sourceSheet({ ...actual, fileName: "Actual Source" });
    actualSheet.name = "Actual Source";

    downloadXlsx(`reconciliation-${new Date().toISOString().slice(0, 10)}.xlsx`, [
      { name: "Summary", rows: summaryRows },
      { name: "All Matches", rows: [matchHeader, ...result.matches.map(matchReportRow)] },
      { name: "Exceptions", rows: [matchHeader, ...result.matches.filter((match) => match.status !== "matched").map(matchReportRow)] },
      { name: "Unmatched Actual", rows: unmatchedActualRows },
      expectedSheet,
      actualSheet,
    ]);
  }

  return (
    <div className="min-h-screen bg-gradient-hero">
      <Header />
      <main className="mx-auto w-full max-w-7xl px-4 pb-24 pt-10 sm:px-6">
        <section className="mb-8">
          <p className="text-sm font-semibold text-primary">Settlement Reconciliation</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Find settlement discrepancies without spreadsheet archaeology.</h1>
          <p className="mt-3 max-w-3xl text-muted-foreground">
            Upload what you expected to receive and what the bank or settlement provider actually posted. PDF extraction uses AI to normalize messy documents; CSV/XLSX files are mapped locally; deterministic rules perform the financial matching.
          </p>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <SourceCard
            title="1. Expected transactions"
            description="Gateway, marketplace, POS, or internal settlement report."
            side="expected"
            source={expected}
            busy={busySide === "expected"}
            onFile={loadFile}
            onEdit={editRow}
            onDelete={deleteRow}
            onAdd={addRow}
            onConfirm={confirmSource}
          />
          <SourceCard
            title="2. Actual settlement"
            description="Bank statement or actual settlement report."
            side="actual"
            source={actual}
            busy={busySide === "actual"}
            onFile={loadFile}
            onEdit={editRow}
            onDelete={deleteRow}
            onAdd={addRow}
            onConfirm={confirmSource}
          />
        </div>

        <Card className="mt-6 rounded-2xl">
          <CardHeader>
            <CardTitle>Matching rules</CardTitle>
            <CardDescription>
              Many-to-one batch matching is enabled automatically. AI never decides whether a variance is acceptable.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="text-sm font-medium">
              Amount tolerance
              <Input className="mt-2" type="number" min={0} value={amountTolerance} onChange={(event) => setAmountTolerance(Math.max(0, Number(event.target.value) || 0))} />
            </label>
            <label className="text-sm font-medium">
              Date tolerance (days)
              <Input className="mt-2" type="number" min={0} max={30} value={dateToleranceDays} onChange={(event) => setDateToleranceDays(Math.max(0, Number(event.target.value) || 0))} />
            </label>
            <Button
              size="lg"
              onClick={runReconciliation}
              disabled={!expected?.confirmed || !actual?.confirmed || !!busySide}
              className="bg-gradient-brand text-primary-foreground"
            >
              <Play className="mr-2 h-4 w-4" /> Run reconciliation
            </Button>
          </CardContent>
        </Card>

        {result && (
          <section className="mt-8 space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-2xl font-bold">Reconciliation result</h2>
                <p className="text-sm text-muted-foreground">Matched rows include both one-to-one and many-to-one settlement batches.</p>
              </div>
              <Button variant="outline" onClick={downloadReport}>
                <Download className="mr-2 h-4 w-4" /> Download reconciliation report (.xlsx)
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Metric label="Match rate" value={`${result.summary.matchRate.toFixed(1)}%`} detail={`${result.summary.matchedCount} expected rows matched`} />
              <Metric label="Batch matches" value={String(result.summary.batchMatchedCount)} detail="many → one settlements" />
              <Metric label="Exceptions" value={String(result.summary.exceptionCount)} detail={`${result.summary.missingCount} missing`} />
              <Metric label="Expected value" value={money(result.summary.expectedValue, currency)} detail={`${result.summary.totalExpected} rows`} />
              <Metric label="Actual value" value={money(result.summary.actualValue, currency)} detail={`${result.summary.totalActual} rows`} />
            </div>

            {batchMatches.length > 0 && (
              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle>Many-to-one batch matches</CardTitle>
                  <CardDescription>Multiple expected transaction rows were successfully tied to a single actual settlement.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead className="bg-muted text-xs uppercase text-muted-foreground">
                        <tr><th className="px-3 py-2">Expected rows</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2">Dates</th><th className="px-3 py-2 text-right">Expected</th><th className="px-3 py-2 text-right">Actual</th><th className="px-3 py-2 text-right">Variance</th></tr>
                      </thead>
                      <tbody>
                        {batchMatches.map((match) => (
                          <tr key={match.id} className="border-t">
                            <td className="px-3 py-3 font-semibold">{match.expectedRows.length}</td>
                            <td className="px-3 py-3">{uniqueSummary([...match.expectedRows.map((row) => row.reference), ...match.actualRows.map((row) => row.reference)])}</td>
                            <td className="px-3 py-3">{uniqueSummary(match.expectedRows.map((row) => row.date))} → {match.actualRows[0]?.date ?? "—"}</td>
                            <td className="px-3 py-3 text-right font-mono">{money(match.expectedValue, currency)}</td>
                            <td className="px-3 py-3 text-right font-mono">{money(match.actualValue, currency)}</td>
                            <td className="px-3 py-3 text-right font-mono">{money(match.variance, currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle>Exceptions requiring review</CardTitle>
                <CardDescription>Only records that failed the configured rules are shown here.</CardDescription>
              </CardHeader>
              <CardContent>
                {exceptions.length === 0 && result.unmatchedActual.length === 0 ? (
                  <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/10 p-4 text-success">
                    <CheckCircle2 className="h-5 w-5" /> Everything reconciled under the current rules.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full min-w-[980px] text-left text-sm">
                      <thead className="bg-muted text-xs uppercase text-muted-foreground">
                        <tr><th className="px-3 py-2">Status</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Expected</th><th className="px-3 py-2">Actual</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2">Date</th><th className="px-3 py-2 text-right">Variance</th><th className="px-3 py-2">Reason</th></tr>
                      </thead>
                      <tbody>
                        {exceptions.map((match) => (
                          <tr key={match.id} className="border-t align-top">
                            <td className="px-3 py-3"><span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-1 text-xs font-semibold text-destructive"><AlertTriangle className="h-3 w-3" />{match.status.replaceAll("_", " ")}</span></td>
                            <td className="px-3 py-3">{match.matchType.replaceAll("_", " → ")}</td>
                            <td className="px-3 py-3 font-mono">{money(match.expectedValue, currency)}{match.expectedRows.length > 1 ? ` (${match.expectedRows.length} rows)` : ""}</td>
                            <td className="px-3 py-3 font-mono">{match.actualRows.length ? money(match.actualValue, currency) : "—"}</td>
                            <td className="px-3 py-3">{uniqueSummary([...match.expectedRows.map((row) => row.reference), ...match.actualRows.map((row) => row.reference)])}</td>
                            <td className="px-3 py-3">{uniqueSummary(match.expectedRows.map((row) => row.date))}{match.actualRows.length ? ` → ${uniqueSummary(match.actualRows.map((row) => row.date))}` : ""}</td>
                            <td className="px-3 py-3 text-right font-mono">{money(match.variance, currency)}</td>
                            <td className="max-w-sm px-3 py-3 text-muted-foreground">{match.reason}</td>
                          </tr>
                        ))}
                        {result.unmatchedActual.map((row) => (
                          <tr key={`extra-${row.id}`} className="border-t align-top">
                            <td className="px-3 py-3"><span className="rounded-full bg-warning/10 px-2 py-1 text-xs font-semibold text-warning">unmatched actual</span></td>
                            <td className="px-3 py-3">—</td>
                            <td className="px-3 py-3">—</td>
                            <td className="px-3 py-3 font-mono">{money(row.netAmount ?? row.amount, row.currency)}</td>
                            <td className="px-3 py-3">{row.reference || "—"}</td>
                            <td className="px-3 py-3">{row.date}</td>
                            <td className="px-3 py-3 text-right font-mono">{money(row.netAmount ?? row.amount, row.currency)}</td>
                            <td className="px-3 py-3 text-muted-foreground">Actual settlement row has no expected counterpart.</td>
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

function SourceCard({
  title,
  description,
  side,
  source,
  busy,
  onFile,
  onEdit,
  onDelete,
  onAdd,
  onConfirm,
}: {
  title: string;
  description: string;
  side: Side;
  source: LoadedSource | null;
  busy: boolean;
  onFile: (file: File, side: Side) => void;
  onEdit: (side: Side, rowIndex: number, field: EditableField, value: string) => void;
  onDelete: (side: Side, rowIndex: number) => void;
  onAdd: (side: Side) => void;
  onConfirm: (side: Side) => void;
}) {
  const lowerName = source?.fileName.toLowerCase() ?? "";
  const isSpreadsheet = lowerName.endsWith(".csv") || lowerName.endsWith(".xlsx");

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div><CardTitle>{title}</CardTitle><CardDescription className="mt-1">{description}</CardDescription></div>
          {source?.confirmed && <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Confirmed</span>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border p-6 text-center transition hover:border-primary/50 hover:bg-primary/5">
          <input
            type="file"
            className="hidden"
            accept=".pdf,.csv,.xlsx,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onFile(file, side);
              event.currentTarget.value = "";
            }}
          />
          {busy ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : source ? (isSpreadsheet ? <FileSpreadsheet className="h-8 w-8 text-primary" /> : <FileText className="h-8 w-8 text-primary" />) : <UploadCloud className="h-8 w-8 text-primary" />}
          <p className="mt-3 font-semibold">{busy ? "Extracting and normalizing…" : source ? source.fileName : "Choose PDF, CSV, or XLSX"}</p>
          <p className="mt-1 text-xs text-muted-foreground">{source ? `${source.provider} · ${source.rows.length} rows · ${source.currency}` : "PDFs use AI extraction; CSV/XLSX mapping stays local in your browser."}</p>
        </label>

        {source && (
          <>
            {source.warnings.length > 0 && (
              <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 text-xs text-muted-foreground">
                <p className="font-semibold text-foreground">Extraction notes</p>
                {source.warnings.map((warning, index) => <p key={`${warning}-${index}`} className="mt-1">• {warning}</p>)}
              </div>
            )}

            <div className="rounded-xl border">
              <div className="flex flex-col gap-2 border-b bg-muted/40 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold">Extraction review</p>
                  <p className="text-xs text-muted-foreground">Edit anything the parser misunderstood. Any edit requires reconfirmation.</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => onAdd(side)}><Plus className="mr-1 h-3.5 w-3.5" /> Add row</Button>
              </div>
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full min-w-[1050px] text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
                    <tr><th className="px-2 py-2">Date</th><th className="px-2 py-2">Reference</th><th className="px-2 py-2">Description</th><th className="px-2 py-2">Amount</th><th className="px-2 py-2">Gross</th><th className="px-2 py-2">Fee</th><th className="px-2 py-2">Net</th><th className="w-10 px-2 py-2"></th></tr>
                  </thead>
                  <tbody>
                    {source.rows.map((row, rowIndex) => (
                      <tr key={row.id} className="border-t">
                        <EditableCell value={row.date} onChange={(value) => onEdit(side, rowIndex, "date", value)} type="date" />
                        <EditableCell value={row.reference} onChange={(value) => onEdit(side, rowIndex, "reference", value)} />
                        <EditableCell value={row.description} onChange={(value) => onEdit(side, rowIndex, "description", value)} wide />
                        <EditableCell value={String(row.amount)} onChange={(value) => onEdit(side, rowIndex, "amount", value)} type="number" />
                        <EditableCell value={row.grossAmount == null ? "" : String(row.grossAmount)} onChange={(value) => onEdit(side, rowIndex, "grossAmount", value)} type="number" />
                        <EditableCell value={row.feeAmount == null ? "" : String(row.feeAmount)} onChange={(value) => onEdit(side, rowIndex, "feeAmount", value)} type="number" />
                        <EditableCell value={row.netAmount == null ? "" : String(row.netAmount)} onChange={(value) => onEdit(side, rowIndex, "netAmount", value)} type="number" />
                        <td className="px-2 py-2"><Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onDelete(side, rowIndex)} aria-label="Delete row"><Trash2 className="h-3.5 w-3.5" /></Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <Button className="w-full" variant={source.confirmed ? "outline" : "default"} onClick={() => onConfirm(side)} disabled={source.rows.length === 0}>
              <CheckCircle2 className="mr-2 h-4 w-4" /> {source.confirmed ? "Extraction confirmed" : "Confirm extracted data"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function EditableCell({ value, onChange, type = "text", wide = false }: { value: string; onChange: (value: string) => void; type?: "text" | "date" | "number"; wide?: boolean }) {
  return (
    <td className={`px-2 py-2 ${wide ? "min-w-[240px]" : "min-w-[130px]"}`}>
      <Input className="h-8 text-xs" type={type} step={type === "number" ? "any" : undefined} min={type === "number" ? 0 : undefined} value={value} onChange={(event) => onChange(event.target.value)} />
    </td>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-bold tracking-tight">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}
