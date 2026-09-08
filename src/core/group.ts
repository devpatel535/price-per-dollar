import type { GroupingMode, ItemGroup, NormalizedItem } from './types.ts';
import type { Basis } from './normalize.ts';
import { availableBases, basesCompatible, basisKey, chooseDisplayBase } from './normalize.ts';
import { ALL_ALIASES } from './units.ts';

/**
 * Deciding what may be compared with what.
 *
 * Ranking every price on a page against every other produces confident
 * nonsense — bulk rice "beating" an avocado. Items are therefore bucketed by
 * physical dimension, clustered by how similar their titles are, and finally
 * checked for a shared basis so rolls are never ranked against sheets.
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'with', 'for', 'of', 'in', 'on', 'by', 'to',
  'from', 'plus', 'per', 'each', 'new', 'value', 'family', 'mega', 'jumbo',
  'giant', 'super', 'extra', 'size', 'sized', 'bulk', 'case', 'multipack',
  'pack', 'packs', 'count', 'ct', 'bag', 'box', 'bottle', 'can', 'jar', 'pouch',
  'ea', 'oz', 'lb', 'lbs', 'ml', 'l', 'g', 'kg', 'fl', 'total', 'approx',
  'assorted', 'variety', 'brand', 'item', 'items', 'product',
]);

const UNIT_WORDS = new Set(ALL_ALIASES.map((alias) => alias.replace(/\s+/g, '')));

/** Reduce a title to the words that actually identify the product. */
export function tokenizeTitle(title: string): string[] {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 2)
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !STOPWORDS.has(token))
    .filter((token) => !UNIT_WORDS.has(token))
    // Fold trivial plurals so "almond" and "almonds" are the same word.
    .map((token) => (token.length > 4 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function bigrams(value: string): Set<string> {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const out = new Set<string>();
  for (let i = 0; i < cleaned.length - 1; i += 1) out.add(cleaned.slice(i, i + 2));
  return out;
}

function dice(a: string, b: string): number {
  const setA = bigrams(a);
  const setB = bigrams(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const gram of setA) if (setB.has(gram)) shared += 1;
  return (2 * shared) / (setA.size + setB.size);
}

/**
 * 0..1 similarity between two product titles.
 *
 * Token overlap catches "Kirkland Almond Butter" vs "Almond Butter Organic";
 * character bigrams catch spelling and spacing drift that tokenising misses.
 * Whichever sees the match more clearly wins.
 */
export function titleSimilarity(a: string, b: string): number {
  const tokensA = new Set(tokenizeTitle(a));
  const tokensB = new Set(tokenizeTitle(b));
  return Math.max(jaccard(tokensA, tokensB), dice(a, b));
}

class UnionFind {
  private parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }

  find(node: number): number {
    let root = node;
    while (this.parent[root] !== root) root = this.parent[root] as number;
    let cursor = node;
    while (this.parent[cursor] !== root) {
      const next = this.parent[cursor] as number;
      this.parent[cursor] = root;
      cursor = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent[rootB] = rootA;
  }
}

/** Express a normalized item under a specific basis, or null if it cannot be. */
function rebase(member: NormalizedItem, basis: Basis): NormalizedItem | null {
  const quantity = member.item.quantity;
  if (!quantity) return null;
  for (const candidate of availableBases(quantity)) {
    if (!basesCompatible(candidate.basis, basis)) continue;
    if (candidate.base <= 0) continue;
    return {
      item: member.item,
      dimension: basis.dimension,
      base: candidate.base,
      pricePerBase: member.item.price.amount / candidate.base,
      basePerCurrencyUnit: candidate.base / member.item.price.amount,
    };
  }
  return null;
}

/**
 * Pick the basis a cluster should be ranked in.
 *
 * The winner is whichever basis the most members can express; ties go to the
 * more specific noun and then to the finer granularity, so a group that knows
 * about sheets ranks in sheets rather than collapsing back to rolls.
 */
function chooseGroupBasis(members: NormalizedItem[]): Basis {
  const candidates = new Map<string, { basis: Basis; coverage: number; totalBase: number }>();
  for (const member of members) {
    const quantity = member.item.quantity;
    if (!quantity) continue;
    for (const { basis } of availableBases(quantity)) {
      const key = basisKey(basis);
      const entry = candidates.get(key) ?? { basis, coverage: 0, totalBase: 0 };
      const rebased = rebase(member, basis);
      if (rebased) {
        entry.coverage += 1;
        entry.totalBase += rebased.base;
      }
      candidates.set(key, entry);
    }
  }

  const ranked = [...candidates.values()].sort((a, b) => {
    if (a.coverage !== b.coverage) return b.coverage - a.coverage;
    const aSpecific = a.basis.dimension === 'count' && a.basis.countNoun !== 'ct' ? 1 : 0;
    const bSpecific = b.basis.dimension === 'count' && b.basis.countNoun !== 'ct' ? 1 : 0;
    if (aSpecific !== bSpecific) return bSpecific - aSpecific;
    return b.totalBase - a.totalBase;
  });

  const first = members[0];
  const fallback: Basis = {
    dimension: first?.dimension ?? 'count',
    countNoun: first?.item.quantity?.countNoun ?? 'ct',
  };
  return ranked[0]?.basis ?? fallback;
}

/** Words every member shares, used to name the group. */
function groupLabel(members: NormalizedItem[]): string {
  const tokenSets = members.map((m) => new Set(tokenizeTitle(m.item.title)));
  const first = tokenSets[0];
  if (!first) return 'Items';
  let shared = [...first];
  for (const set of tokenSets.slice(1)) shared = shared.filter((token) => set.has(token));
  const words = (shared.length ? shared : [...first]).slice(0, 4);
  if (!words.length) return 'Items';
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

export interface BuildGroupsOptions {
  mode?: GroupingMode;
  /** 0..1 — how alike two titles must be to share a group. */
  similarityThreshold?: number;
  /** Groups smaller than this are still returned, but flagged by the caller. */
  minGroupSize?: number;
}

/**
 * Bucket, cluster and rank items.
 *
 * `smart` mode compares like with like. `page` mode drops the title check and
 * ranks everything sharing a physical basis, which is what you want when you
 * deliberately do want one leaderboard for the whole page.
 */
export function buildGroups(
  items: NormalizedItem[],
  options: BuildGroupsOptions = {},
): ItemGroup[] {
  const mode = options.mode ?? 'smart';
  const threshold = options.similarityThreshold ?? 0.4;
  if (items.length === 0) return [];

  // Bucket by physical dimension first — mass never competes with volume.
  const buckets = new Map<string, NormalizedItem[]>();
  for (const item of items) {
    const key = mode === 'page'
      ? basisKey({ dimension: item.dimension, countNoun: item.item.quantity?.countNoun ?? 'ct' })
      : item.dimension;
    const bucket = buckets.get(key) ?? [];
    bucket.push(item);
    buckets.set(key, bucket);
  }

  const clusters: NormalizedItem[][] = [];
  for (const bucket of buckets.values()) {
    if (mode === 'page' || bucket.length === 1) {
      clusters.push(bucket);
      continue;
    }
    const uf = new UnionFind(bucket.length);
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const a = bucket[i];
        const b = bucket[j];
        if (!a || !b) continue;
        if (titleSimilarity(a.item.title, b.item.title) >= threshold) uf.union(i, j);
      }
    }
    const byRoot = new Map<number, NormalizedItem[]>();
    bucket.forEach((member, index) => {
      const root = uf.find(index);
      const list = byRoot.get(root) ?? [];
      list.push(member);
      byRoot.set(root, list);
    });
    clusters.push(...byRoot.values());
  }

  const groups: ItemGroup[] = [];
  // Members that cannot express the basis their cluster settled on are not
  // dropped — they are re-queued and form their own group. A pack measured in
  // sheets alongside packs measured in rolls still gets ranked, just separately.
  const pending: NormalizedItem[][] = [...clusters];
  while (pending.length > 0) {
    const cluster = pending.shift();
    if (!cluster || cluster.length === 0) continue;

    const basis = chooseGroupBasis(cluster);
    const rebased: NormalizedItem[] = [];
    const leftover: NormalizedItem[] = [];
    for (const member of cluster) {
      const converted = rebase(member, basis);
      if (converted) rebased.push(converted);
      else leftover.push(member);
    }
    rebased.sort((a, b) => a.pricePerBase - b.pricePerBase);

    // `rebased` always holds at least the member the basis came from, so the
    // leftover queue shrinks every pass and this terminates.
    if (rebased.length === 0) continue;
    if (leftover.length > 0) pending.push(leftover);

    const best = rebased[0];
    if (!best) continue;
    const display = chooseDisplayBase(
      basis.dimension,
      rebased.map((member) => member.pricePerBase),
      basis.countNoun || 'ct',
    );

    groups.push({
      id: `${basisKey(basis)}::${best.item.id}`,
      dimension: basis.dimension,
      label: groupLabel(rebased),
      members: rebased,
      best,
      worst: rebased.length > 1 ? (rebased[rebased.length - 1] ?? null) : null,
      display,
    });
  }

  // Biggest, most decision-relevant comparisons first.
  return groups.sort((a, b) => b.members.length - a.members.length || a.label.localeCompare(b.label));
}

/** Look up the group a given item ended up in. */
export function findGroupForItem(groups: ItemGroup[], itemId: string): ItemGroup | null {
  return groups.find((group) => group.members.some((member) => member.item.id === itemId)) ?? null;
}
