import { normalizeText, stableId } from "./normalization";
import type { MatchConfig, ReconciliationMatch, ReconciliationResult, Transaction } from "./types";

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  dateToleranceDays: 3,
  amountTolerance: 0.01,
  descriptionWeight: 0.2,
  allowGroupedMatches: true,
};

function dayDistance(left: string, right: string): number {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  return Math.abs(new Date(`${left}T00:00:00Z`).getTime() - new Date(`${right}T00:00:00Z`).getTime()) / 86400000;
}

function tokens(value: string): Set<string> {
  return new Set(
    normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")
      .filter((token) => token.length >= 2 && !["the", "and", "payment", "transfer", "bank"].includes(token)),
  );
}

export function textSimilarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / (a.size + b.size - intersection);
}

function amountDifference(left: number, right: number): number {
  return Math.abs(Math.abs(left) - Math.abs(right));
}

function pairScore(left: Transaction, right: Transaction, config: MatchConfig): { score: number; reasons: string[] } | null {
  const difference = amountDifference(left.amount, right.amount);
  if (difference > Math.max(config.amountTolerance, Math.abs(left.amount) * 0.002)) return null;
  const dateGap = dayDistance(left.date, right.date);
  if (dateGap > config.dateToleranceDays) return null;
  const referenceExact = Boolean(left.reference && right.reference && normalizeText(left.reference).toLowerCase() === normalizeText(right.reference).toLowerCase());
  const description = textSimilarity(`${left.description} ${left.reference ?? ""}`, `${right.description} ${right.reference ?? ""}`);
  const amountScore = Math.max(0, 1 - difference / Math.max(1, Math.abs(left.amount)));
  const dateScore = Math.max(0, 1 - dateGap / Math.max(1, config.dateToleranceDays + 1));
  let score = amountScore * 0.55 + dateScore * (0.45 - config.descriptionWeight) + description * config.descriptionWeight;
  if (referenceExact) score = Math.min(1, score + 0.22);
  const reasons = [difference <= config.amountTolerance ? "Amount agrees" : "Amount within tolerance", dateGap === 0 ? "Same date" : `${dateGap} day date gap`];
  if (referenceExact) reasons.push("Reference agrees");
  else if (description >= 0.5) reasons.push("Description is similar");
  return { score: Math.round(score * 100), reasons };
}

function createMatch(left: Transaction[], right: Transaction[], score: number, reasons: string[]): ReconciliationMatch {
  const leftAmount = left.reduce((sum, item) => sum + Math.abs(item.amount), 0);
  const rightAmount = right.reduce((sum, item) => sum + Math.abs(item.amount), 0);
  const difference = Math.abs(leftAmount - rightAmount);
  return {
    id: stableId([...left.map((item) => item.id), ...right.map((item) => item.id)]),
    leftIds: left.map((item) => item.id),
    rightIds: right.map((item) => item.id),
    leftAmount,
    rightAmount,
    difference,
    score,
    status: score >= 92 && difference <= 0.01 ? "exact" : score >= 75 ? "probable" : "review",
    reasons,
  };
}

function combinations<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  const walk = (start: number, selected: T[]) => {
    if (selected.length === size) { result.push([...selected]); return; }
    for (let index = start; index < items.length; index += 1) walk(index + 1, [...selected, items[index]]);
  };
  walk(0, []);
  return result;
}

function groupedCandidates(
  anchor: Transaction,
  pool: Transaction[],
  config: MatchConfig,
): { items: Transaction[]; score: number; reasons: string[] } | null {
  const nearby = pool.filter((item) => dayDistance(anchor.date, item.date) <= config.dateToleranceDays).slice(0, 24);
  for (const size of [2, 3]) {
    for (const group of combinations(nearby, size)) {
      const sum = group.reduce((total, item) => total + Math.abs(item.amount), 0);
      const difference = amountDifference(anchor.amount, sum);
      if (difference > Math.max(config.amountTolerance, Math.abs(anchor.amount) * 0.002)) continue;
      const description = Math.max(...group.map((item) => textSimilarity(anchor.description, item.description)));
      const score = Math.round(82 + Math.min(10, description * 10) - Math.min(8, difference));
      return { items: group, score, reasons: [`${size}-transaction grouped amount agrees`, description >= 0.4 ? "At least one description is similar" : "Review grouped descriptions"] };
    }
  }
  return null;
}

export function reconcile(
  left: Transaction[],
  right: Transaction[],
  config: MatchConfig = DEFAULT_MATCH_CONFIG,
): ReconciliationResult {
  const candidates: Array<{ left: Transaction; right: Transaction; score: number; reasons: string[] }> = [];
  for (const leftItem of left) {
    for (const rightItem of right) {
      const candidate = pairScore(leftItem, rightItem, config);
      if (candidate) candidates.push({ left: leftItem, right: rightItem, ...candidate });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const usedLeft = new Set<string>();
  const usedRight = new Set<string>();
  const matches: ReconciliationMatch[] = [];
  for (const candidate of candidates) {
    if (usedLeft.has(candidate.left.id) || usedRight.has(candidate.right.id)) continue;
    if (candidate.score < 58) continue;
    usedLeft.add(candidate.left.id);
    usedRight.add(candidate.right.id);
    matches.push(createMatch([candidate.left], [candidate.right], candidate.score, candidate.reasons));
  }

  if (config.allowGroupedMatches) {
    for (const leftItem of left.filter((item) => !usedLeft.has(item.id))) {
      const group = groupedCandidates(leftItem, right.filter((item) => !usedRight.has(item.id)), config);
      if (!group) continue;
      usedLeft.add(leftItem.id);
      group.items.forEach((item) => usedRight.add(item.id));
      matches.push(createMatch([leftItem], group.items, group.score, group.reasons));
    }
    for (const rightItem of right.filter((item) => !usedRight.has(item.id))) {
      const group = groupedCandidates(rightItem, left.filter((item) => !usedLeft.has(item.id)), config);
      if (!group) continue;
      usedRight.add(rightItem.id);
      group.items.forEach((item) => usedLeft.add(item.id));
      matches.push(createMatch(group.items, [rightItem], group.score, group.reasons));
    }
  }

  return {
    matches: matches.sort((a, b) => b.score - a.score),
    unmatchedLeft: left.filter((item) => !usedLeft.has(item.id)),
    unmatchedRight: right.filter((item) => !usedRight.has(item.id)),
  };
}
