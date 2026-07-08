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

type ItemStatus = "queued" | "reading" | "processing" | "done" | "error";

type Item = {
  id: string;
  file: File;
  status: ItemStatus;
  progress: number;
  result: ExtractResult | null;
  error: string | null;
};

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

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

export function FileUploader() {
  const { user } = useAuth();
  const extract = useServerFn(extractDocument);
  const [items, setItems] = useState<Item[]>([]);
  const [paywallOpen, setPaywallOpen] = useState(false);

  const updateItem = (id: string, patch: Partial<Item>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const removeItem = (id: string) => setItems((prev) => prev.filter((it) => it.id !== id));
  const reset = () => setItems([]);

  const checkQuotaFor = async (count: number): Promise<number> => {
    // Returns how many of `count` we can process. Opens paywall if any are blocked.
    if (user) {
      const u = await getUserUsage(user.id);
      if (u.subscribed) return count;
      const limit = DAILY_FREE_LIMIT + u.extraCredits;
      const remaining = Math.max(0, limit - u.count);
      if (remaining < count) setPaywallOpen(true);
      return Math.min(count, remaining);
    }
    const u = getAnonUsage();
    const remaining = Math.max(0, DAILY_FREE_LIMIT - u.count);
    if (remaining < count) setPaywallOpen(true);
    return Math.min(count, remaining);
  };

  const processItem = async (item: Item) => {
    try {
      updateItem(item.id, { status: "reading", progress: 15 });
      const base64 = await fileToBase64(item.file);
      updateItem(item.id, { status: "processing", progress: 40 });

      let p = 40;
      const timer = setInterval(() => {
        p = Math.min(90, p + 3);
        updateItem(item.id, { progress: p });
      }, 400);

      const res = await extract({
        data: {
          fileName: item.file.name,
          mimeType: item.file.type || "application/octet-stream",
          dataBase64: base64,
        },
      });
      clearInterval(timer);
      updateItem(item.id, { status: "done", progress: 100, result: res });

      if (user) {
        await recordConversion(user.id, item.file.name, res.transactions.length);
      } else {
        bumpAnonUsage();
      }

      if (res.transactions.length === 0) {
        toast.warning(`${item.file.name}: no transactions found.`);
      } else {
        toast.success(`${item.file.name}: extracted ${res.transactions.length} transaction${res.transactions.length === 1 ? "" : "s"}.`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong.";
      updateItem(item.id, { status: "error", error: msg });
      toast.error(`${item.file.name}: ${msg}`);
    }
  };

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const allowed = await checkQuotaFor(files.length);
      if (allowed === 0) return;
      const toProcess = files.slice(0, allowed);
      if (allowed < files.length) {
        toast.warning(`Only ${allowed} of ${files.length} file${files.length === 1 ? "" : "s"} fit in your remaining quota.`);
      }

      const newItems: Item[] = toProcess.map((f) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file: f,
        status: "queued",
        progress: 0,
        result: null,
        error: null,
      }));
      setItems((prev) => [...prev, ...newItems]);

      // Process sequentially to avoid hammering the AI gateway and quota races.
      for (const it of newItems) {
        await processItem(it);
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
            ? "Unsupported file type. Please upload PDFs or images (JPG, PNG, HEIC, WEBP)."
            : err.code === "file-too-large"
              ? `File too large. Maximum ${MAX_MB} MB.`
              : err.message,
        );
      }
      if (accepted.length > 0) void handleFiles(accepted);
    },
    [handleFiles],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: ACCEPTED,
    multiple: true,
    maxSize: MAX_MB * 1024 * 1024,
    noClick: true,
    noKeyboard: true,
  });

  const anyBusy = items.some((it) => it.status === "reading" || it.status === "processing" || it.status === "queued");
  const allDone = items.length > 0 && items.every((it) => it.status === "done" || it.status === "error");

  return (
    <div className="w-full">
      {items.length === 0 ? (
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
            {isDragActive ? "Drop your files here" : "Drag & drop your files"}
          </h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Invoices, receipts, or bank statements — one or many. We'll turn them into clean Excel.
          </p>
          <Button
            type="button"
            onClick={open}
            size="lg"
            className="mt-6 bg-gradient-brand text-primary-foreground shadow-soft hover:opacity-95"
          >
            Choose files
          </Button>
          <p className="mt-4 text-xs text-muted-foreground">
            PDF, JPG, PNG, WEBP, HEIC · up to {MAX_MB} MB each
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} onRemove={() => removeItem(item.id)} />
          ))}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div
              {...getRootProps()}
              className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 text-sm transition-all ${
                isDragActive ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/50"
              }`}
              onClick={open}
            >
              <input {...getInputProps()} />
              <FileUp className="h-4 w-4 text-primary" />
              <span className="font-medium text-foreground">Add more files</span>
            </div>
            {allDone && (
              <Button variant="ghost" onClick={reset} disabled={anyBusy}>
                Clear all
              </Button>
            )}
          </div>
        </div>
      )}

      <PaywallDialog open={paywallOpen} onOpenChange={setPaywallOpen} isSignedIn={!!user} />
    </div>
  );
}

function ItemCard({ item, onRemove }: { item: Item; onRemove: () => void }) {
  const busy = item.status === "reading" || item.status === "processing" || item.status === "queued";
  return (
    <div className="rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-8">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {item.file.type.startsWith("image/") ? <ImageIcon className="h-6 w-6" /> : <FileText className="h-6 w-6" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-foreground">{item.file.name}</p>
          <p className="text-xs text-muted-foreground">{(item.file.size / 1024).toFixed(0)} KB</p>
        </div>
        {!busy && (
          <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Remove">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {busy && (
        <div className="mt-6">
          <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span>
              {item.status === "queued"
                ? "Queued…"
                : item.status === "reading"
                  ? "Reading file…"
                  : "Extracting transactions with AI…"}
            </span>
          </div>
          <Progress value={item.progress} className="h-2" />
        </div>
      )}

      {item.status === "error" && item.error && (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {item.error}
        </div>
      )}

      {item.status === "done" && item.result && (
        <div className="mt-6">
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" />
            <span>
              Extracted <strong>{item.result.transactions.length}</strong>{" "}
              transaction{item.result.transactions.length === 1 ? "" : "s"} · {item.result.currency}
            </span>
          </div>

          {item.result.transactions.length > 0 && (
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
                  {item.result.transactions.slice(0, 50).map((t, i) => (
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
              {item.result.transactions.length > 50 && (
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
              onClick={() => downloadXlsx(item.result!, baseName(item.file.name))}
              disabled={item.result.transactions.length === 0}
            >
              <Download className="mr-2 h-4 w-4" /> Download Excel
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="flex-1"
              onClick={() => downloadCsv(item.result!, baseName(item.file.name))}
              disabled={item.result.transactions.length === 0}
            >
              <Download className="mr-2 h-4 w-4" /> Download CSV
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
