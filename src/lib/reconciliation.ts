export type ReconciliationRow = {
  id: string;
  date: string;
  reference: string;
  description: string;
  amount: number;
  currency: string;
  grossAmount?: number;
  feeAmount?: number;
  netAmount?: number;
};

export type MatchStatus = "matched" | "amount_mismatch" | "date_mismatch" | "missing_actual";

export type ReconciliationMatch = {
  expected: ReconciliationRow;
  actual: ReconciliationRow | null;
  status: MatchStatus;
  variance: number;
  dateDifferenceDays: number | null;
  confidence: number;
  reason: string;
};

export type ReconciliationOptions = {
  amountTolerance: number;
  dateToleranceDays: number;
};

export type ReconciliationSummary = {
  totalExpected: number;
  totalActual: number;
  expectedValue: number;
  actualValue: number;
  matchedCount: number;
  exceptionCount: number;
  missingCount: number;
  amountMismatchCount: number;
  dateMismatchCount: number;
  unmatchedActualCount: number;
  matchedValue: number;
  exceptionValue: number;
  matchRate: number;
};

export type ReconciliationResult = {
  matches: ReconciliationMatch[];
  unmatchedActual: ReconciliationRow[];
  summary: ReconciliationSummary;
};

function normalizeReference(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toUtcDay(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function dateDiffDays(a: string, b: string) {
  const x = toUtcDay(a);
  const y = toUtcDay(b);
  if (x === null || y === null) return Number.POSITIVE_INFINITY;
  return Math.abs(x - y) / 86_400_000;
}

function rowValue(row: ReconciliationRow) {
  return Number.isFinite(row.netAmount ?? NaN) ? Math.abs(row.netAmount!) : Math.abs(row.amount);
}

function candidateScore(expected: ReconciliationRow, actual: ReconciliationRow, options: ReconciliationOptions) {
  const expectedRef = normalizeReference(expected.reference);
  const actualRef = normalizeReference(actual.reference);
  const refExact = expectedRef.length >= 4 && expectedRef === actualRef;
  const amountDiff = Math.abs(rowValue(expected) - rowValue(actual));
  const dateDiff = dateDiffDays(expected.date, actual.date);

  let score = 0;
  if (refExact) score += 70;
  if (amountDiff <= options.amountTolerance) score += 20;
  else if (amountDiff <= Math.max(options.amountTolerance * 10, rowValue(expected) * 0.01)) score += 8;
  if (dateDiff <= options.dateToleranceDays) score += 10;
  else if (dateDiff <= options.dateToleranceDays + 2) score += 4;

  return { score, refExact, amountDiff, dateDiff };
}

export function reconcileRows(
  expectedRows: ReconciliationRow[],
  actualRows: ReconciliationRow[],
  options: ReconciliationOptions,
): ReconciliationResult {
  const available = new Set(actualRows.map((_, index) => index));
  const matches: ReconciliationMatch[] = [];

  for (const expected of expectedRows) {
    let bestIndex: number | null = null;
    let best: ReturnType<typeof candidateScore> | null = null;

    for (const index of available) {
      const candidate = candidateScore(expected, actualRows[index], options);
      if (!best || candidate.score > best.score || (candidate.score === best.score && candidate.amountDiff < best.amountDiff)) {
        best = candidate;
        bestIndex = index;
      }
    }

    if (bestIndex === null || !best || best.score < 20) {
      matches.push({
        expected,
        actual: null,
        status: "missing_actual",
        variance: -rowValue(expected),
        dateDifferenceDays: null,
        confidence: 0,
        reason: "No sufficiently strong settlement candidate was found.",
      });
      continue;
    }

    const actual = actualRows[bestIndex];
    available.delete(bestIndex);
    const variance = rowValue(actual) - rowValue(expected);
    const withinAmount = Math.abs(variance) <= options.amountTolerance;
    const withinDate = best.dateDiff <= options.dateToleranceDays;

    let status: MatchStatus = "matched";
    let reason = "Reference, amount, and posting date are within the configured rules.";
    if (!withinAmount) {
      status = "amount_mismatch";
      reason = `Settlement amount differs by ${Math.abs(variance).toFixed(2)}.`;
    } else if (!withinDate) {
      status = "date_mismatch";
      reason = `Settlement date is ${best.dateDiff.toFixed(0)} day(s) outside the configured tolerance.`;
    }

    matches.push({
      expected,
      actual,
      status,
      variance,
      dateDifferenceDays: Number.isFinite(best.dateDiff) ? best.dateDiff : null,
      confidence: Math.min(100, best.score),
      reason,
    });
  }

  const unmatchedActual = [...available].map((index) => actualRows[index]);
  const exceptionRows = matches.filter((m) => m.status !== "matched");
  const matchedRows = matches.filter((m) => m.status === "matched");

  const expectedValue = expectedRows.reduce((sum, row) => sum + rowValue(row), 0);
  const actualValue = actualRows.reduce((sum, row) => sum + rowValue(row), 0);

  return {
    matches,
    unmatchedActual,
    summary: {
      totalExpected: expectedRows.length,
      totalActual: actualRows.length,
      expectedValue,
      actualValue,
      matchedCount: matchedRows.length,
      exceptionCount: exceptionRows.length + unmatchedActual.length,
      missingCount: matches.filter((m) => m.status === "missing_actual").length,
      amountMismatchCount: matches.filter((m) => m.status === "amount_mismatch").length,
      dateMismatchCount: matches.filter((m) => m.status === "date_mismatch").length,
      unmatchedActualCount: unmatchedActual.length,
      matchedValue: matchedRows.reduce((sum, match) => sum + rowValue(match.expected), 0),
      exceptionValue: exceptionRows.reduce((sum, match) => sum + rowValue(match.expected), 0) + unmatchedActual.reduce((sum, row) => sum + rowValue(row), 0),
      matchRate: expectedRows.length === 0 ? 0 : (matchedRows.length / expectedRows.length) * 100,
    },
  };
}
