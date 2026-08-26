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
export type MatchType = "one_to_one" | "many_to_one";

export type ReconciliationMatch = {
  id: string;
  expectedRows: ReconciliationRow[];
  actualRows: ReconciliationRow[];
  status: MatchStatus;
  matchType: MatchType;
  expectedValue: number;
  actualValue: number;
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
  matchedGroupCount: number;
  batchMatchedCount: number;
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

export function reconciliationRowValue(row: ReconciliationRow) {
  return Number.isFinite(row.netAmount ?? NaN) ? Math.abs(row.netAmount!) : Math.abs(row.amount);
}

function sumRows(rows: ReconciliationRow[]) {
  return rows.reduce((sum, row) => sum + reconciliationRowValue(row), 0);
}

function sameCurrency(a: ReconciliationRow, b: ReconciliationRow) {
  return !a.currency || !b.currency || a.currency.toUpperCase() === b.currency.toUpperCase();
}

function maxDateDifference(expectedRows: ReconciliationRow[], actual: ReconciliationRow) {
  const diffs = expectedRows.map((row) => dateDiffDays(row.date, actual.date)).filter(Number.isFinite);
  return diffs.length ? Math.max(...diffs) : Number.POSITIVE_INFINITY;
}

function makeMatch(
  expectedRows: ReconciliationRow[],
  actualRows: ReconciliationRow[],
  options: ReconciliationOptions,
  matchType: MatchType,
  confidence: number,
  fallbackReason?: string,
): ReconciliationMatch {
  const expectedValue = sumRows(expectedRows);
  const actualValue = sumRows(actualRows);
  const variance = actualValue - expectedValue;
  const dateDifference = actualRows.length === 1 ? maxDateDifference(expectedRows, actualRows[0]) : Number.POSITIVE_INFINITY;
  const withinAmount = Math.abs(variance) <= options.amountTolerance;
  const withinDate = dateDifference <= options.dateToleranceDays;

  let status: MatchStatus = "matched";
  let reason = matchType === "many_to_one"
    ? `${expectedRows.length} expected rows reconcile to one actual settlement within the configured rules.`
    : "Reference/amount and posting date are within the configured rules.";

  if (!withinAmount) {
    status = "amount_mismatch";
    reason = `Settlement amount differs by ${Math.abs(variance).toFixed(2)}.`;
  } else if (!withinDate) {
    status = "date_mismatch";
    reason = `Settlement date is ${Number.isFinite(dateDifference) ? dateDifference.toFixed(0) : "unknown"} day(s) outside the configured tolerance.`;
  }

  if (fallbackReason && status === "matched") reason = fallbackReason;

  return {
    id: `${matchType}-${expectedRows.map((row) => row.id).join("+")}-${actualRows.map((row) => row.id).join("+")}`,
    expectedRows,
    actualRows,
    status,
    matchType,
    expectedValue,
    actualValue,
    variance,
    dateDifferenceDays: Number.isFinite(dateDifference) ? dateDifference : null,
    confidence: Math.max(0, Math.min(100, confidence)),
    reason,
  };
}

function candidateScore(expected: ReconciliationRow, actual: ReconciliationRow, options: ReconciliationOptions) {
  const expectedRef = normalizeReference(expected.reference);
  const actualRef = normalizeReference(actual.reference);
  const refExact = expectedRef.length >= 4 && expectedRef === actualRef;
  const amountDiff = Math.abs(reconciliationRowValue(expected) - reconciliationRowValue(actual));
  const dateDiff = dateDiffDays(expected.date, actual.date);

  let score = 0;
  if (refExact) score += 70;
  if (amountDiff <= options.amountTolerance) score += 20;
  else if (amountDiff <= Math.max(options.amountTolerance * 10, reconciliationRowValue(expected) * 0.01)) score += 8;
  if (dateDiff <= options.dateToleranceDays) score += 10;
  else if (dateDiff <= options.dateToleranceDays + 2) score += 4;

  return { score, refExact, amountDiff, dateDiff };
}

function findDateWindowBatch(
  expectedRows: ReconciliationRow[],
  expectedIndexes: number[],
  actual: ReconciliationRow,
  options: ReconciliationOptions,
) {
  const eligible = expectedIndexes
    .map((index) => ({ index, row: expectedRows[index] }))
    .filter(({ row }) => sameCurrency(row, actual) && dateDiffDays(row.date, actual.date) <= options.dateToleranceDays)
    .sort((a, b) => a.row.date.localeCompare(b.row.date) || a.index - b.index);

  if (eligible.length < 2) return null;
  const target = reconciliationRowValue(actual);
  const tolerance = options.amountTolerance;

  const allValue = eligible.reduce((sum, item) => sum + reconciliationRowValue(item.row), 0);
  if (Math.abs(allValue - target) <= tolerance) return eligible.map((item) => item.index);

  const byDate = new Map<string, typeof eligible>();
  for (const item of eligible) {
    const group = byDate.get(item.row.date) ?? [];
    group.push(item);
    byDate.set(item.row.date, group);
  }
  for (const group of byDate.values()) {
    if (group.length < 2) continue;
    const value = group.reduce((sum, item) => sum + reconciliationRowValue(item.row), 0);
    if (Math.abs(value - target) <= tolerance) return group.map((item) => item.index);
  }

  for (let start = 0; start < eligible.length - 1; start++) {
    let total = 0;
    for (let end = start; end < eligible.length; end++) {
      total += reconciliationRowValue(eligible[end].row);
      const count = end - start + 1;
      if (count >= 2 && Math.abs(total - target) <= tolerance) return eligible.slice(start, end + 1).map((item) => item.index);
      if (total > target + tolerance) break;
    }
  }

  if (eligible.length <= 20) {
    const sorted = [...eligible].sort((a, b) => reconciliationRowValue(b.row) - reconciliationRowValue(a.row));
    let found: number[] | null = null;
    const maxGroupSize = Math.min(10, sorted.length);
    const visit = (position: number, selected: number[], total: number) => {
      if (found) return;
      if (selected.length >= 2 && Math.abs(total - target) <= tolerance) {
        found = [...selected];
        return;
      }
      if (position >= sorted.length || selected.length >= maxGroupSize || total > target + tolerance) return;
      for (let i = position; i < sorted.length; i++) {
        selected.push(sorted[i].index);
        visit(i + 1, selected, total + reconciliationRowValue(sorted[i].row));
        selected.pop();
        if (found) return;
      }
    };
    visit(0, [], 0);
    if (found) return found;
  }

  return null;
}

export function reconcileRows(
  expectedRows: ReconciliationRow[],
  actualRows: ReconciliationRow[],
  options: ReconciliationOptions,
): ReconciliationResult {
  const availableExpected = new Set(expectedRows.map((_, index) => index));
  const availableActual = new Set(actualRows.map((_, index) => index));
  const matches: ReconciliationMatch[] = [];

  const referenceGroups = new Map<string, number[]>();
  expectedRows.forEach((row, index) => {
    const ref = normalizeReference(row.reference);
    if (ref.length < 4) return;
    const group = referenceGroups.get(ref) ?? [];
    group.push(index);
    referenceGroups.set(ref, group);
  });

  for (const actualIndex of [...availableActual]) {
    const actual = actualRows[actualIndex];
    const ref = normalizeReference(actual.reference);
    const indexes = referenceGroups.get(ref)?.filter((index) => availableExpected.has(index)) ?? [];
    if (ref.length < 4 || indexes.length < 2) continue;
    const expectedGroup = indexes.map((index) => expectedRows[index]);
    matches.push(makeMatch(expectedGroup, [actual], options, "many_to_one", 100, "Rows sharing the same settlement reference were reconciled as a batch."));
    indexes.forEach((index) => availableExpected.delete(index));
    availableActual.delete(actualIndex);
  }

  for (const expectedIndex of [...availableExpected]) {
    const expected = expectedRows[expectedIndex];
    const expectedRef = normalizeReference(expected.reference);
    if (expectedRef.length < 4) continue;
    let selected: number | null = null;
    for (const actualIndex of availableActual) {
      if (normalizeReference(actualRows[actualIndex].reference) === expectedRef) {
        selected = actualIndex;
        break;
      }
    }
    if (selected === null) continue;
    matches.push(makeMatch([expected], [actualRows[selected]], options, "one_to_one", 100));
    availableExpected.delete(expectedIndex);
    availableActual.delete(selected);
  }

  for (const actualIndex of [...availableActual]) {
    const batchIndexes = findDateWindowBatch(expectedRows, [...availableExpected], actualRows[actualIndex], options);
    if (!batchIndexes || batchIndexes.length < 2) continue;
    const group = batchIndexes.map((index) => expectedRows[index]);
    matches.push(makeMatch(group, [actualRows[actualIndex]], options, "many_to_one", 90, "A date-window group of expected transactions sums to this actual settlement."));
    batchIndexes.forEach((index) => availableExpected.delete(index));
    availableActual.delete(actualIndex);
  }

  for (const expectedIndex of [...availableExpected]) {
    const expected = expectedRows[expectedIndex];
    let bestIndex: number | null = null;
    let best: ReturnType<typeof candidateScore> | null = null;
    for (const actualIndex of availableActual) {
      const candidate = candidateScore(expected, actualRows[actualIndex], options);
      const isExactOperationalMatch = candidate.amountDiff <= options.amountTolerance && candidate.dateDiff <= options.dateToleranceDays;
      if (!isExactOperationalMatch) continue;
      if (!best || candidate.score > best.score || (candidate.score === best.score && candidate.amountDiff < best.amountDiff)) {
        best = candidate;
        bestIndex = actualIndex;
      }
    }
    if (bestIndex === null) continue;
    matches.push(makeMatch([expected], [actualRows[bestIndex]], options, "one_to_one", best?.score ?? 80));
    availableExpected.delete(expectedIndex);
    availableActual.delete(bestIndex);
  }

  for (const expectedIndex of [...availableExpected]) {
    const expected = expectedRows[expectedIndex];
    let bestIndex: number | null = null;
    let best: ReturnType<typeof candidateScore> | null = null;
    for (const actualIndex of availableActual) {
      const candidate = candidateScore(expected, actualRows[actualIndex], options);
      if (!best || candidate.score > best.score || (candidate.score === best.score && candidate.amountDiff < best.amountDiff)) {
        best = candidate;
        bestIndex = actualIndex;
      }
    }

    if (bestIndex !== null && best && best.score >= 20) {
      matches.push(makeMatch([expected], [actualRows[bestIndex]], options, "one_to_one", best.score));
      availableExpected.delete(expectedIndex);
      availableActual.delete(bestIndex);
    }
  }

  for (const expectedIndex of availableExpected) {
    const expected = expectedRows[expectedIndex];
    const expectedValue = reconciliationRowValue(expected);
    matches.push({
      id: `missing-${expected.id}`,
      expectedRows: [expected],
      actualRows: [],
      status: "missing_actual",
      matchType: "one_to_one",
      expectedValue,
      actualValue: 0,
      variance: -expectedValue,
      dateDifferenceDays: null,
      confidence: 0,
      reason: "No sufficiently strong settlement candidate was found.",
    });
  }

  const unmatchedActual = [...availableActual].map((index) => actualRows[index]);
  const matchedGroups = matches.filter((match) => match.status === "matched");
  const exceptionGroups = matches.filter((match) => match.status !== "matched");
  const matchedExpectedRows = matchedGroups.reduce((sum, match) => sum + match.expectedRows.length, 0);
  const expectedValue = sumRows(expectedRows);
  const actualValue = sumRows(actualRows);

  return {
    matches,
    unmatchedActual,
    summary: {
      totalExpected: expectedRows.length,
      totalActual: actualRows.length,
      expectedValue,
      actualValue,
      matchedCount: matchedExpectedRows,
      matchedGroupCount: matchedGroups.length,
      batchMatchedCount: matchedGroups.filter((match) => match.matchType === "many_to_one").length,
      exceptionCount: exceptionGroups.length + unmatchedActual.length,
      missingCount: exceptionGroups.filter((match) => match.status === "missing_actual").reduce((sum, match) => sum + match.expectedRows.length, 0),
      amountMismatchCount: exceptionGroups.filter((match) => match.status === "amount_mismatch").length,
      dateMismatchCount: exceptionGroups.filter((match) => match.status === "date_mismatch").length,
      unmatchedActualCount: unmatchedActual.length,
      matchedValue: matchedGroups.reduce((sum, match) => sum + match.expectedValue, 0),
      exceptionValue: exceptionGroups.reduce((sum, match) => sum + match.expectedValue, 0) + sumRows(unmatchedActual),
      matchRate: expectedRows.length === 0 ? 0 : (matchedExpectedRows / expectedRows.length) * 100,
    },
  };
}
