import { useCallback, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { useServerFn } from "@tanstack/react-start";
import { FileUp, FileText, Image as ImageIcon, X, Download, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { extractDocument, type ExtractResult } from "@/lib/extract.functions";
import { downloadCsv, downloadXlsx } from "@/lib/export";
import { useAuth } from "@/lib/use-auth";
import { DAILY_FREE_LIMIT, bumpAnonUsage, getAnonUsage, getUserUsage, recordConversion } from "@/lib/quota";
import { PaywallDialog } from "./PaywallDialog";

const ACCEPTED = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/heic": [".heic"],
  "image/heif": [".heif"],
};

const MAX_MB = 25;

type Status = "idle" | "reading" | "processing" | "done" | "error";

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      resolve(res.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function FileUploader() {
  const { user } = useAuth();
  const extract = useServerFn(extractDocument);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paywallOpen, setPaywallOpen] = useState(false);

  const reset = () => {
    setFile(null);
    setStatus("idle");
    setProgress(0);
    setResult(null);
    setError(null);
  };

  const runQuotaCheck = async (): Promise<boolean> => {
    if (user) {
      const u = await getUserUsage(user.id);
      if (u.subscribed) return true;
      const total = u.count;
      const limit = DAILY_FREE_LIMIT + u.extraCredits;
      if (total >= limit) {
        setPaywallOpen(true);
        return false;
      }
    } else {
      const u = getAnonUsage();
      if (u.count >= DAILY_FREE_LIMIT) {
        setPaywallOpen(true);
        return false;
      }
    }
    return true;
  };

  const handleProcess = useCallback(
    async (f: File) => {
      setFile(f);
      setResult(null);
      setError(null);

      if (!(await runQuotaCheck())) {
        setFile(null);
        return;
      }

      try {
        setStatus("reading");
        setProgress(15);
        const base64 = await fileToBase64(f);
        setProgress(40);
        setStatus("processing");

        // Fake incremental progress while the model runs
        let p = 40;
        const timer = setInterval(() => {
          p = Math.min(90, p + 3);
          setProgress(p);
        }, 400);

        const res = await extract({
          data: { fileName: f.name, mimeType: f.type || "application/octet-stream", dataBase64: base64 },
        });
        clearInterval(timer);
        setProgress(100);
        setResult(res);
        setStatus("done");

        if (user) {
          await recordConversion(user.id, f.name, res.transactions.length);
        } else {
          bumpAnonUsage();
        }

        if (res.transactions.length === 0) {
          toast.warning("No transactions found in this document.");
        } else {
          toast.success(`Extracted ${res.transactions.length} transaction${res.transactions.length === 1 ? "" : "s"}.`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Something went wrong.";
        setError(msg);
        setStatus("error");
        toast.error(msg);
      }
    },
    [extract, user],
  );

  const onDrop = useCallback(
    (accepted: File[], rejected: FileRejection[]) => {
      if (rejected.length > 0) {
        const first = rejected[0];
        const err = first.errors[0];
        toast.error(
          err.code === "file-invalid-type"
            ? "Unsupported file type. Please upload a PDF or image (JPG, PNG, HEIC, WEBP)."
            : err.code === "file-too-large"
              ? `File too large. Maximum ${MAX_MB} MB.`
              : err.message,
        );
        return;
      }
      const f = accepted[0];
      if (f) void handleProcess(f);
    },
    [handleProcess],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: ACCEPTED,
    maxFiles: 1,
    maxSize: MAX_MB * 1024 * 1024,
    noClick: true,
    noKeyboard: true,
  });

  const busy = status === "reading" || status === "processing";

  return (
    <div className="w-full">
      {status === "idle" || status === "error" ? (
        <div
          {...getRootProps()}
          className={`group relative flex flex-col items-center justify-center rounded-3xl border-2 border-dashed p-10 text-center transition-all sm:p-16 ${
            isDragActive
              ? "border-primary bg-primary/5 scale-[1.01]"
              : "border-border bg-card hover:border-primary/50 hover:bg-accent/30"
          }`}
        >
          <input {...getInputProps()} />
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-brand shadow-brand">
            <FileUp className="h-8 w-8 text-primary-foreground" />
          </div>
          <h2 className="text-xl font-bold text-foreground sm:text-2xl">
            {isDragActive ? "Drop your file here" : "Drag & drop your file"}
          </h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Invoices, receipts, or bank statements. We'll turn them into a clean Excel sheet.
          </p>
          <Button
            type="button"
            onClick={open}
            size="lg"
            className="mt-6 bg-gradient-brand text-primary-foreground shadow-soft hover:opacity-95"
          >
            Choose file
          </Button>
          <p className="mt-4 text-xs text-muted-foreground">
            PDF, JPG, PNG, WEBP, HEIC · up to {MAX_MB} MB
          </p>
          {error && (
            <div className="mt-6 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              {file?.type.startsWith("image/") ? <ImageIcon className="h-6 w-6" /> : <FileText className="h-6 w-6" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-foreground">{file?.name}</p>
              <p className="text-xs text-muted-foreground">
                {file ? `${(file.size / 1024).toFixed(0)} KB` : ""}
              </p>
            </div>
            {status === "done" && (
              <Button variant="ghost" size="icon" onClick={reset} aria-label="Clear">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          {busy && (
            <div className="mt-6">
              <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span>{status === "reading" ? "Reading file…" : "Extracting transactions with AI…"}</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}

          {status === "done" && result && (
            <div className="mt-6">
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
                <CheckCircle2 className="h-4 w-4" />
                <span>
                  Extracted <strong>{result.transactions.length}</strong>{" "}
                  transaction{result.transactions.length === 1 ? "" : "s"} · {result.currency}
                </span>
              </div>

              {result.transactions.length > 0 && (
                <div className="mb-5 max-h-64 overflow-auto rounded-xl border border-border">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Merchant</th>
                        <th className="px-3 py-2">Category</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.transactions.slice(0, 50).map((t, i) => (
                        <tr key={i} className="border-t border-border/60">
                          <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{t.date}</td>
                          <td className="px-3 py-2 font-medium">{t.merchant || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{t.category}</td>
                          <td className={`whitespace-nowrap px-3 py-2 text-right font-mono ${t.type === "credit" ? "text-success" : "text-foreground"}`}>
                            {t.type === "credit" ? "+" : "−"}
                            {t.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {result.transactions.length > 50 && (
                    <div className="border-t border-border bg-muted/50 px-3 py-2 text-center text-xs text-muted-foreground">
                      Showing first 50 rows — download for the full list.
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  size="lg"
                  className="flex-1 bg-gradient-brand text-primary-foreground hover:opacity-95"
                  onClick={() => downloadXlsx(result, (file?.name ?? "transactions").replace(/\.[^.]+$/, ""))}
                  disabled={result.transactions.length === 0}
                >
                  <Download className="mr-2 h-4 w-4" /> Download Excel
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="flex-1"
                  onClick={() => downloadCsv(result, (file?.name ?? "transactions").replace(/\.[^.]+$/, ""))}
                  disabled={result.transactions.length === 0}
                >
                  <Download className="mr-2 h-4 w-4" /> Download CSV
                </Button>
                <Button size="lg" variant="ghost" onClick={reset}>
                  Convert another
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <PaywallDialog open={paywallOpen} onOpenChange={setPaywallOpen} isSignedIn={!!user} />
    </div>
  );
}
