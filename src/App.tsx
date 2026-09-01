import { useCallback, useMemo, useRef, useState } from "react";
import {
  ArrowRightLeft, Check, CheckCircle2, ChevronDown, CircleAlert, Download, FileSearch, FileSpreadsheet,
  FileText, Globe2, Info, LockKeyhole, Plus, RefreshCw, ShieldCheck, Sparkles, Trash2, UploadCloud, X,
} from "lucide-react";
import { BANK_PROFILES } from "./lib/bankProfiles";
import { exportReconciliation, exportStatementCsv, exportStatementXlsx } from "./lib/export";
import { DEFAULT_MATCH_CONFIG, reconcile } from "./lib/reconciliation";
import { parseStatement, remapStatement, validateBalances } from "./lib/statementParser";
import type { ColumnRole, DateOrder, MatchConfig, ParsedStatement, ReconciliationResult, Transaction } from "./lib/types";

const COLUMN_ROLES: Array<{ value: ColumnRole; label: string }> = [
  { value: "ignore", label: "Ignore" },
  { value: "date", label: "Transaction date" },
  { value: "valueDate", label: "Value date" },
  { value: "description", label: "Description" },
  { value: "reference", label: "Reference" },
  { value: "debit", label: "Debit / money out" },
  { value: "credit", label: "Credit / money in" },
  { value: "amount", label: "Signed amount" },
  { value: "balance", label: "Running balance" },
  { value: "currency", label: "Currency" },
];

type ActiveView = "review" | "reconcile" | "coverage";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatMoney(value: number, currency?: string) {
  return new Intl.NumberFormat("en-US", { style: currency ? "currency" : "decimal", currency, maximumFractionDigits: 2 }).format(value);
}

function regionCoverage() {
  const regions = new Map<string, string[]>();
  for (const bank of BANK_PROFILES) regions.set(bank.region, [...(regions.get(bank.region) ?? []), bank.name]);
  return [...regions.entries()].map(([region, banks]) => ({ region, banks }));
}

export default function App() {
  const [statements, setStatements] = useState<ParsedStatement[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [view, setView] = useState<ActiveView>("review");
  const [processing, setProcessing] = useState<string[]>([]);
  const [errors, setErrors] = useState<Array<{ file: string; message: string }>>([]);
  const [dragging, setDragging] = useState(false);
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");
  const [matchConfig, setMatchConfig] = useState<MatchConfig>(DEFAULT_MATCH_CONFIG);
  const inputRef = useRef<HTMLInputElement>(null);

  const active = statements.find((statement) => statement.id === activeId) ?? statements[0];
  const left = statements.find((statement) => statement.id === leftId) ?? statements[0];
  const right = statements.find((statement) => statement.id === rightId) ?? statements[1];
  const reconciliation: ReconciliationResult | null = useMemo(
    () => left && right && left.id !== right.id ? reconcile(left.transactions, right.transactions, matchConfig) : null,
    [left, right, matchConfig],
  );

  const handleFiles = useCallback(async (incoming: FileList | File[]) => {
    const files = Array.from(incoming);
    setErrors((current) => current.filter((error) => !files.some((file) => file.name === error.file)));
    for (const file of files) {
      setProcessing((current) => [...current, file.name]);
      try {
        const statement = await parseStatement(file);
        setStatements((current) => {
          const next = [...current.filter((item) => item.id !== statement.id), statement];
          if (!leftId) setLeftId(next[0]?.id ?? "");
          if (!rightId && next.length > 1) setRightId(next[1].id);
          return next;
        });
        setActiveId(statement.id);
        setView("review");
      } catch (error) {
        setErrors((current) => [...current, { file: file.name, message: error instanceof Error ? error.message : "The file could not be parsed." }]);
      } finally {
        setProcessing((current) => current.filter((name) => name !== file.name));
      }
    }
  }, [leftId, rightId]);

  const updateStatement = (updated: ParsedStatement) => {
    setStatements((current) => current.map((statement) => statement.id === updated.id ? updated : statement));
  };

  const updateMapping = (source: string, role: ColumnRole) => {
    if (!active) return;
    const mappings = active.mappings.map((mapping) => {
      if (mapping.source === source) return { ...mapping, role, confidence: 1 };
      if (role !== "ignore" && mapping.role === role) return { ...mapping, role: "ignore" as const, confidence: 0 };
      return mapping;
    });
    updateStatement(remapStatement(active, mappings, active.dateOrder));
  };

  const updateDateOrder = (dateOrder: DateOrder) => {
    if (active) updateStatement(remapStatement(active, active.mappings, dateOrder));
  };

  const updateTransaction = (transactionId: string, field: keyof Transaction, value: string) => {
    if (!active) return;
    const transactions = active.transactions.map((transaction) => {
      if (transaction.id !== transactionId) return transaction;
      if (["amount", "debit", "credit", "balance"].includes(field)) {
        const numeric = Number(value.replace(/,/g, ""));
        return { ...transaction, [field]: Number.isFinite(numeric) ? numeric : 0 };
      }
      return { ...transaction, [field]: value };
    });
    updateStatement({ ...active, transactions, validation: validateBalances(transactions) });
  };

  const removeStatement = (id: string) => {
    const next = statements.filter((statement) => statement.id !== id);
    setStatements(next);
    setActiveId(next[0]?.id ?? "");
    setLeftId((current) => current === id ? next[0]?.id ?? "" : current);
    setRightId((current) => current === id ? next.find((item) => item.id !== (leftId || next[0]?.id))?.id ?? "" : current);
    if (next.length < 2 && view === "reconcile") setView("review");
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => { setView("review"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
          <span className="brand-mark">S</span>
          <span>Squincky</span>
        </button>
        <nav className="topnav" aria-label="Primary navigation">
          {statements.length > 0 && <button className={view === "review" ? "active" : ""} onClick={() => setView("review")}>Statements</button>}
          {statements.length > 1 && <button className={view === "reconcile" ? "active" : ""} onClick={() => setView("reconcile")}>Reconcile</button>}
          <button className={view === "coverage" ? "active" : ""} onClick={() => setView("coverage")}>Coverage</button>
        </nav>
        <button className="button button-dark button-small" onClick={() => inputRef.current?.click()}><Plus size={16} /> Add files</button>
        <input ref={inputRef} hidden type="file" multiple accept=".pdf,.xlsx,.csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(event) => event.target.files && handleFiles(event.target.files)} />
      </header>

      {view === "coverage" ? <Coverage onClose={() => setView("review")} /> : statements.length === 0 ? (
        <Landing
          processing={processing}
          errors={errors}
          dragging={dragging}
          setDragging={setDragging}
          onFiles={handleFiles}
          onChoose={() => inputRef.current?.click()}
          onCoverage={() => setView("coverage")}
        />
      ) : view === "reconcile" ? (
        <ReconciliationView
          statements={statements}
          left={left}
          right={right}
          leftId={leftId}
          rightId={rightId}
          setLeftId={setLeftId}
          setRightId={setRightId}
          config={matchConfig}
          setConfig={setMatchConfig}
          result={reconciliation}
        />
      ) : (
        <ReviewView
          statements={statements}
          active={active}
          activeId={activeId}
          setActiveId={setActiveId}
          removeStatement={removeStatement}
          updateMapping={updateMapping}
          updateDateOrder={updateDateOrder}
          updateTransaction={updateTransaction}
          processing={processing}
          errors={errors}
          onFiles={handleFiles}
        />
      )}

      <footer>
        <span>© 2026 Squincky</span>
        <span><LockKeyhole size={14} /> Local processing · no API · no uploads</span>
      </footer>
    </div>
  );
}

function Landing({ processing, errors, dragging, setDragging, onFiles, onChoose, onCoverage }: {
  processing: string[];
  errors: Array<{ file: string; message: string }>;
  dragging: boolean;
  setDragging: (value: boolean) => void;
  onFiles: (files: FileList | File[]) => void;
  onChoose: () => void;
  onCoverage: () => void;
}) {
  return (
    <main className="landing">
      <section className="hero">
        <div className="eyebrow"><ShieldCheck size={15} /> Private by design · API-free</div>
        <h1>Turn bank statements into<br /><span>clean, reconcilable data.</span></h1>
        <p>Import PDF, XLSX, or CSV statements from banks around the world. Squincky detects columns, validates balances, and reconciles transactions—entirely in your browser.</p>
        <div className="hero-actions">
          <button className="button button-primary" onClick={onChoose}><UploadCloud size={19} /> Choose statements</button>
          <button className="button button-ghost" onClick={onCoverage}><Globe2 size={18} /> View bank coverage</button>
        </div>
        <div className="trust-row"><span><Check size={14} /> No API keys</span><span><Check size={14} /> Files never leave your device</span><span><Check size={14} /> Auditable matching rules</span></div>
      </section>

      <UploadZone dragging={dragging} setDragging={setDragging} onFiles={onFiles} onChoose={onChoose} />

      {(processing.length > 0 || errors.length > 0) && <div className="status-stack">
        {processing.map((file) => <div className="notice loading" key={file}><RefreshCw className="spin" size={18} /><div><strong>Reading {file}</strong><span>Detecting the statement layout locally…</span></div></div>)}
        {errors.map((error) => <div className="notice error" key={`${error.file}-${error.message}`}><CircleAlert size={18} /><div><strong>{error.file}</strong><span>{error.message}</span></div></div>)}
      </div>}

      <section className="feature-grid">
        <article><FileSearch /><h3>Adaptive extraction</h3><p>Bank profiles guide recognition, while a generic coordinate and header engine handles unfamiliar layouts.</p></article>
        <article><ArrowRightLeft /><h3>Explainable reconciliation</h3><p>Exact, probable, and grouped matches show their score, date gap, amount difference, and reasons.</p></article>
        <article><ShieldCheck /><h3>Financial controls</h3><p>Running-balance continuity, confidence warnings, duplicate-safe IDs, and editable review before export.</p></article>
      </section>
    </main>
  );
}

function UploadZone({ dragging, setDragging, onFiles, onChoose, compact = false }: {
  dragging: boolean;
  setDragging: (value: boolean) => void;
  onFiles: (files: FileList | File[]) => void;
  onChoose: () => void;
  compact?: boolean;
}) {
  return <section
    className={`upload-zone ${dragging ? "dragging" : ""} ${compact ? "compact" : ""}`}
    onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
    onDragLeave={() => setDragging(false)}
    onDrop={(event) => { event.preventDefault(); setDragging(false); onFiles(event.dataTransfer.files); }}
    onClick={onChoose}
  >
    <div className="upload-icon"><UploadCloud /></div>
    <div><h2>{compact ? "Add another statement" : "Drop statements here"}</h2><p>PDF, XLSX, or CSV · up to 25 MB each · multiple files supported</p></div>
    {!compact && <button className="button button-dark" type="button">Browse files</button>}
  </section>;
}

function ReviewView({ statements, active, activeId, setActiveId, removeStatement, updateMapping, updateDateOrder, updateTransaction, processing, errors, onFiles }: {
  statements: ParsedStatement[];
  active?: ParsedStatement;
  activeId: string;
  setActiveId: (id: string) => void;
  removeStatement: (id: string) => void;
  updateMapping: (source: string, role: ColumnRole) => void;
  updateDateOrder: (order: DateOrder) => void;
  updateTransaction: (transactionId: string, field: keyof Transaction, value: string) => void;
  processing: string[];
  errors: Array<{ file: string; message: string }>;
  onFiles: (files: FileList | File[]) => void;
}) {
  const [showMapping, setShowMapping] = useState(false);
  const [dragging, setDragging] = useState(false);
  if (!active) return null;
  const totalDebit = active.transactions.reduce((sum, transaction) => sum + transaction.debit, 0);
  const totalCredit = active.transactions.reduce((sum, transaction) => sum + transaction.credit, 0);
  return <main className="workspace">
    <div className="workspace-heading">
      <div><div className="eyebrow neutral"><FileSpreadsheet size={15} /> Statement workspace</div><h1>Review extracted transactions</h1><p>Confirm the detected layout before exporting or reconciling. Every value remains editable.</p></div>
      <div className="heading-actions"><button className="button button-ghost" onClick={() => exportStatementCsv(active)}><Download size={17} /> CSV</button><button className="button button-primary" onClick={() => exportStatementXlsx(active)}><Download size={17} /> Excel</button></div>
    </div>

    <div className="file-tabs" role="tablist">
      {statements.map((statement) => <button key={statement.id} role="tab" aria-selected={statement.id === activeId} className={statement.id === activeId ? "selected" : ""} onClick={() => setActiveId(statement.id)}>
        {statement.format === "pdf" ? <FileText size={16} /> : <FileSpreadsheet size={16} />}
        <span><strong>{statement.fileName}</strong><small>{statement.transactions.length} rows · {formatBytes(statement.fileSize)}</small></span>
        <span className="tab-remove" role="button" aria-label={`Remove ${statement.fileName}`} onClick={(event) => { event.stopPropagation(); removeStatement(statement.id); }}><X size={14} /></span>
      </button>)}
    </div>

    <section className="audit-card">
      <div className="audit-main">
        <div className="bank-badge"><span>{active.bank.name.split(" ").map((word) => word[0]).join("").slice(0, 2)}</span></div>
        <div><span className="label">Detected profile</span><h3>{active.bank.name}</h3><p>{active.bank.region} · {active.extractionMethod.replace(/-/g, " ")} · {active.sheetName ? `sheet “${active.sheetName}”` : active.format.toUpperCase()}</p></div>
      </div>
      <div className={`validation ${active.validation.status}`}>
        {active.validation.status === "verified" ? <CheckCircle2 /> : active.validation.status === "discrepancy" ? <CircleAlert /> : <Info />}
        <div><strong>{active.validation.status === "verified" ? "Balance check passed" : active.validation.status === "discrepancy" ? "Review required" : "Balance check unavailable"}</strong><span>{active.validation.message}</span></div>
      </div>
      <button className="mapping-toggle" onClick={() => setShowMapping((current) => !current)}>Column mapping <ChevronDown className={showMapping ? "rotated" : ""} size={17} /></button>
    </section>

    {(active.warnings.length > 0 || errors.length > 0) && <div className="status-stack narrow">
      {active.warnings.map((warning) => <div className="notice warning" key={warning}><CircleAlert size={18} /><span>{warning}</span></div>)}
      {errors.map((error) => <div className="notice error" key={`${error.file}-${error.message}`}><CircleAlert size={18} /><div><strong>{error.file}</strong><span>{error.message}</span></div></div>)}
    </div>}

    {showMapping && <section className="mapping-panel">
      <div className="mapping-header"><div><h3>Column mapping</h3><p>Squincky guessed these roles. Correct any ambiguous fields, then verify the normalized table below.</p></div><label>Date order<select value={active.dateOrder} onChange={(event) => updateDateOrder(event.target.value as DateOrder)}><option value="DMY">Day / Month / Year</option><option value="MDY">Month / Day / Year</option><option value="YMD">Year / Month / Day</option></select></label></div>
      <div className="mapping-grid">
        {active.mappings.map((mapping) => <label key={mapping.source}><span title={mapping.source}>{mapping.source}</span><ArrowRightLeft size={14} /><select value={mapping.role} onChange={(event) => updateMapping(mapping.source, event.target.value as ColumnRole)}>{COLUMN_ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>)}
      </div>
    </section>}

    <section className="metric-grid">
      <div><span>Transactions</span><strong>{active.transactions.length}</strong></div>
      <div><span>Total money out</span><strong>{formatMoney(totalDebit, active.transactions[0]?.currency)}</strong></div>
      <div><span>Total money in</span><strong>{formatMoney(totalCredit, active.transactions[0]?.currency)}</strong></div>
      <div><span>Needs review</span><strong>{active.transactions.filter((transaction) => transaction.issues.length || transaction.confidence < 0.7).length}</strong></div>
    </section>

    <TransactionTable transactions={active.transactions} onUpdate={updateTransaction} />

    {processing.map((file) => <div className="notice loading" key={file}><RefreshCw className="spin" size={18} /><span>Reading {file} locally…</span></div>)}
    <UploadZone dragging={dragging} setDragging={setDragging} onFiles={onFiles} onChoose={() => document.querySelector<HTMLInputElement>('input[type="file"]')?.click()} compact />
  </main>;
}

function TransactionTable({ transactions, onUpdate }: { transactions: Transaction[]; onUpdate: (id: string, field: keyof Transaction, value: string) => void }) {
  const [limit, setLimit] = useState(100);
  return <section className="table-card">
    <div className="table-title"><div><h3>Normalized transactions</h3><p>Click any field to correct it. The original source row remains in the export audit.</p></div><span>{transactions.length} rows</span></div>
    <div className="table-scroll"><table><thead><tr><th>#</th><th>Date</th><th>Description</th><th>Reference</th><th className="number">Debit</th><th className="number">Credit</th><th className="number">Balance</th><th>Status</th></tr></thead><tbody>
      {transactions.slice(0, limit).map((transaction, index) => <tr key={transaction.id} className={transaction.issues.length ? "row-warning" : ""}>
        <td>{index + 1}</td>
        <td><input type="date" value={transaction.date} onChange={(event) => onUpdate(transaction.id, "date", event.target.value)} /></td>
        <td><input className="description-input" value={transaction.description} onChange={(event) => onUpdate(transaction.id, "description", event.target.value)} /></td>
        <td><input value={transaction.reference ?? ""} onChange={(event) => onUpdate(transaction.id, "reference", event.target.value)} /></td>
        <td><input className="number" inputMode="decimal" value={transaction.debit || ""} onChange={(event) => onUpdate(transaction.id, "debit", event.target.value)} /></td>
        <td><input className="number" inputMode="decimal" value={transaction.credit || ""} onChange={(event) => onUpdate(transaction.id, "credit", event.target.value)} /></td>
        <td><input className="number" inputMode="decimal" value={transaction.balance ?? ""} onChange={(event) => onUpdate(transaction.id, "balance", event.target.value)} /></td>
        <td>{transaction.issues.length ? <span className="status-pill review" title={transaction.issues.join("; ")}><CircleAlert size={13} /> Review</span> : <span className="status-pill ready"><Check size={13} /> Ready</span>}</td>
      </tr>)}
    </tbody></table></div>
    {limit < transactions.length && <button className="load-more" onClick={() => setLimit((current) => current + 100)}>Show 100 more rows</button>}
  </section>;
}

function ReconciliationView({ statements, left, right, leftId, rightId, setLeftId, setRightId, config, setConfig, result }: {
  statements: ParsedStatement[];
  left?: ParsedStatement;
  right?: ParsedStatement;
  leftId: string;
  rightId: string;
  setLeftId: (id: string) => void;
  setRightId: (id: string) => void;
  config: MatchConfig;
  setConfig: (config: MatchConfig) => void;
  result: ReconciliationResult | null;
}) {
  if (!left || !right || !result) return null;
  const matchedLeft = result.matches.reduce((sum, match) => sum + match.leftIds.length, 0);
  const matchRate = left.transactions.length ? matchedLeft / left.transactions.length * 100 : 0;
  return <main className="workspace">
    <div className="workspace-heading"><div><div className="eyebrow neutral"><ArrowRightLeft size={15} /> Deterministic matching</div><h1>Reconciliation results</h1><p>Amounts are matched by magnitude, then ranked by date, reference, and description. Grouped matching supports up to three transactions.</p></div><button className="button button-primary" onClick={() => exportReconciliation(result, left, right)}><Download size={17} /> Export reconciliation</button></div>
    <section className="reconcile-setup">
      <label><span>Source A</span><select value={left.id} onChange={(event) => setLeftId(event.target.value)}>{statements.map((statement) => <option key={statement.id} value={statement.id} disabled={statement.id === right.id}>{statement.fileName}</option>)}</select><small>{left.transactions.length} transactions</small></label>
      <div className="swap-icon"><ArrowRightLeft /></div>
      <label><span>Source B</span><select value={right.id} onChange={(event) => setRightId(event.target.value)}>{statements.map((statement) => <option key={statement.id} value={statement.id} disabled={statement.id === left.id}>{statement.fileName}</option>)}</select><small>{right.transactions.length} transactions</small></label>
    </section>
    <section className="match-controls">
      <label>Date tolerance <strong>{config.dateToleranceDays} days</strong><input type="range" min="0" max="14" value={config.dateToleranceDays} onChange={(event) => setConfig({ ...config, dateToleranceDays: Number(event.target.value) })} /></label>
      <label>Amount tolerance <div className="input-prefix"><span>±</span><input type="number" min="0" step="0.01" value={config.amountTolerance} onChange={(event) => setConfig({ ...config, amountTolerance: Number(event.target.value) })} /></div></label>
      <label className="checkbox"><input type="checkbox" checked={config.allowGroupedMatches} onChange={(event) => setConfig({ ...config, allowGroupedMatches: event.target.checked })} /><span><strong>Grouped matching</strong><small>Match one transaction to two or three</small></span></label>
    </section>
    <section className="metric-grid reconciliation-metrics">
      <div><span>Match rate</span><strong>{matchRate.toFixed(1)}%</strong></div>
      <div><span>Exact / probable</span><strong>{result.matches.filter((match) => match.status !== "review").length}</strong></div>
      <div><span>Unmatched source A</span><strong>{result.unmatchedLeft.length}</strong></div>
      <div><span>Unmatched source B</span><strong>{result.unmatchedRight.length}</strong></div>
    </section>
    <MatchTable result={result} left={left} right={right} />
  </main>;
}

function MatchTable({ result, left, right }: { result: ReconciliationResult; left: ParsedStatement; right: ParsedStatement }) {
  const byId = new Map([...left.transactions, ...right.transactions].map((transaction) => [transaction.id, transaction]));
  const [tab, setTab] = useState<"matches" | "left" | "right">("matches");
  return <section className="table-card match-card">
    <div className="result-tabs"><button className={tab === "matches" ? "active" : ""} onClick={() => setTab("matches")}>Matches <span>{result.matches.length}</span></button><button className={tab === "left" ? "active" : ""} onClick={() => setTab("left")}>Unmatched A <span>{result.unmatchedLeft.length}</span></button><button className={tab === "right" ? "active" : ""} onClick={() => setTab("right")}>Unmatched B <span>{result.unmatchedRight.length}</span></button></div>
    {tab === "matches" ? <div className="match-list">{result.matches.map((match) => {
      const leftItems = match.leftIds.map((id) => byId.get(id)!).filter(Boolean);
      const rightItems = match.rightIds.map((id) => byId.get(id)!).filter(Boolean);
      return <article key={match.id}><div className="match-score"><strong>{match.score}</strong><span>score</span></div><div className="match-side"><small>SOURCE A</small><strong>{leftItems.map((item) => item.description).join(" + ")}</strong><span>{leftItems.map((item) => item.date).join(" + ")} · {formatMoney(match.leftAmount)}</span></div><div className="match-link"><span className={`status-pill ${match.status}`}>{match.status}</span><ArrowRightLeft size={18} /><small>{match.reasons.join(" · ")}</small></div><div className="match-side"><small>SOURCE B</small><strong>{rightItems.map((item) => item.description).join(" + ")}</strong><span>{rightItems.map((item) => item.date).join(" + ")} · {formatMoney(match.rightAmount)}</span></div></article>;
    })}{result.matches.length === 0 && <EmptyResult text="No transactions met the current tolerances." />}</div> : <UnmatchedTable transactions={tab === "left" ? result.unmatchedLeft : result.unmatchedRight} />}
  </section>;
}

function UnmatchedTable({ transactions }: { transactions: Transaction[] }) {
  if (!transactions.length) return <EmptyResult text="Everything in this source is matched." />;
  return <div className="table-scroll"><table><thead><tr><th>Date</th><th>Description</th><th>Reference</th><th className="number">Amount</th></tr></thead><tbody>{transactions.map((transaction) => <tr key={transaction.id}><td>{transaction.date}</td><td>{transaction.description}</td><td>{transaction.reference ?? "—"}</td><td className="number">{formatMoney(transaction.amount, transaction.currency)}</td></tr>)}</tbody></table></div>;
}

function EmptyResult({ text }: { text: string }) { return <div className="empty-result"><Sparkles /><h3>Nothing to review here</h3><p>{text}</p></div>; }

function Coverage({ onClose }: { onClose: () => void }) {
  const coverage = regionCoverage();
  return <main className="coverage-page">
    <button className="close-page" onClick={onClose}><X size={18} /></button>
    <div className="eyebrow"><Globe2 size={15} /> International statement coverage</div>
    <h1>Profiles for common banks.<br /><span>A generic engine for the rest.</span></h1>
    <p className="coverage-intro">Profiles identify familiar branding, date conventions, and column vocabulary. Unlisted banks still pass through the generic multilingual header and PDF-coordinate engine, then into the same review screen.</p>
    <div className="coverage-grid">{coverage.map(({ region, banks }) => <article key={region}><h3>{region}</h3><div>{banks.map((bank) => <span key={bank}><CheckCircle2 size={14} /> {bank}</span>)}</div></article>)}</div>
    <section className="coverage-note"><ShieldCheck /><div><h3>What “supported” honestly means</h3><p>Text-based PDFs and structured XLSX/CSV exports can be parsed locally. Banks change layouts, ambiguous numeric dates need confirmation, and scanned image-only PDFs are deliberately rejected rather than guessed. The balance check and editable review surface catch those changes before export.</p></div></section>
  </main>;
}
