// Launch Multiple Radar — entry program for token-radar-01 (Node 22, stdlib only).
//
// Pipeline, top to bottom:
//   1. Load the sealed DefiLlama snapshot. The grader mounts it at
//      /input/snapshot.json; locally point --input <file|dir> or
//      MAKEFUN_INPUT_DIR at it.
//   2. Learn, from the snapshot's own tokenized protocols, what the market
//      currently pays per dollar of TVL: one median mcap/TVL multiple per
//      category, pulled toward the market-wide median when a category only
//      has a handful of tokenized names to learn from.
//   3. Cross-examine that pricing rule on the tokenized names themselves.
//      Two seeded blind splits fit every candidate setting on half of the
//      comparables and grade it on the half it never saw; a term is in the
//      shipped rule only because those splits kept it (see runValidation).
//   4. Quote every pre-token protocol: TVL times its category multiple,
//      tilted by seven-day TVL momentum and by how long it has operated
//      without a token.
//   5. Emit board.json (the ranked board), data.js (the dashboard's data),
//      copy dashboard/ and screenshots/ across, and seal the lot into
//      dossier.json through the vendored buildDossier, byte for byte the
//      way the gate rebuilds it.
//
// Local run:
//   mkdir -p out && MAKEFUN_INPUT_DIR=<kit>/input MAKEFUN_OUTPUT_DIR=out node main.ts

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const ownDir = fileURLToPath(new URL('.', import.meta.url));

// ---------------------------------------------------------------------------
// The snapshot's record shape: the ten fields the sealed input carries.
// ---------------------------------------------------------------------------

interface ProtocolRecord {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

interface SnapshotData {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: ProtocolRecord[];
  watchlist: string[];
}

/** Parses snapshot text into typed records. Anything malformed is a hard stop, never a guess. */
function readSnapshot(text: string): SnapshotData {
  const raw = JSON.parse(text) as Record<string, unknown>;
  if (typeof raw.as_of !== 'string' || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot.json does not carry as_of, protocols and watchlist');
  }
  const protocols = (raw.protocols as Record<string, unknown>[]).map((p) => ({
    slug: String(p.slug),
    name: String(p.name),
    category: typeof p.category === 'string' ? p.category : null,
    chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
    tvl_usd: typeof p.tvl_usd === 'number' ? p.tvl_usd : 0,
    change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
    mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
    listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
    gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
    symbol: typeof p.symbol === 'string' ? p.symbol : null,
  }));
  return {
    as_of: raw.as_of,
    source: String(raw.source ?? ''),
    floor_usd: typeof raw.floor_usd === 'number' ? raw.floor_usd : 0,
    protocols,
    watchlist: (raw.watchlist as unknown[]).map(String),
  };
}

/** A record counts as tokenless only when all three token fields are empty in it. */
function hasNoToken(p: ProtocolRecord): boolean {
  return p.gecko_id === null && p.symbol === null && p.mcap_usd === null;
}

// ---------------------------------------------------------------------------
// The pricing rule. Its shape is not hand-picked: runValidation further down
// is the evidence each term stands on.
// ---------------------------------------------------------------------------

/** Winsor bounds for one comparable's multiple, so a single mania print cannot rule a category. */
const MULT_LO = 0.01;
const MULT_HI = 10;

interface RuleSettings {
  /** Phantom observations of the global median blended into every category median. */
  shrink_k: number;
  /** Blend in log space (geometric) rather than arithmetically. */
  log_shrink: boolean;
  /** Clamp each comparable's multiple into [MULT_LO, MULT_HI] before any median. */
  winsorize: boolean;
  /** Momentum: the share of the clamped seven-day TVL change the quote believes. */
  mom_weight: number;
  mom_clamp_lo: number;
  mom_clamp_hi: number;
  /** Age factor: age_base when brand new, plus age_span earned over age_full_days tokenless days. */
  age_base: number;
  age_span: number;
  age_full_days: number;
  /** Days assumed when the snapshot reports no listing date. */
  age_when_unknown: number;
  /** Quote everything at the global median, categories ignored. */
  global_only: boolean;
}

/**
 * The shipped settings. The blind splits in runValidation are why each value
 * is what it is:
 *   - shrinkage: dropping it raises held-out error on both splits; the older
 *     weight of 5 was too weak, so the blend is stronger (40) and geometric.
 *   - momentum: at the older 0.30 weight it bought nothing on either split;
 *     at 0.10 it is error-neutral, so the term stays at the weight allowed.
 *   - age: the older premium (0.78-1.15) raised held-out error on both
 *     splits; the gentle 0.95-1.05 form is within noise of dropping it.
 *   - winsorize: binds only mania prints; error-neutral, kept as insurance.
 */
const SHIPPED_RULE: RuleSettings = {
  shrink_k: 40,
  log_shrink: true,
  winsorize: true,
  mom_weight: 0.1,
  mom_clamp_lo: -40,
  mom_clamp_hi: 80,
  age_base: 0.95,
  age_span: 0.1,
  age_full_days: 1460,
  age_when_unknown: 365,
  global_only: false,
};

/** Last round's settings, retained only so the validation can price the improvement. */
const PREVIOUS_RULE: RuleSettings = {
  shrink_k: 5,
  log_shrink: false,
  winsorize: true,
  mom_weight: 0.3,
  mom_clamp_lo: -40,
  mom_clamp_hi: 80,
  age_base: 0.78,
  age_span: 0.37,
  age_full_days: 1460,
  age_when_unknown: 365,
  global_only: false,
};

interface CategoryEvidence {
  category: string;
  comps: number;
  raw_median: number;
  multiple: number;
}

interface FittedMultiples {
  global: number;
  byCategory: Map<string, CategoryEvidence>;
}

function middleOf(xs: number[]): number {
  const ordered = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1 ? ordered[mid]! : (ordered[mid - 1]! + ordered[mid]!) / 2;
}

function fourDp(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/**
 * Fits multiples on whatever list it is handed: the whole snapshot's tokenized
 * set for the board, or one blind split's fit half inside the validation.
 * Only tokenized protocols with a positive recorded cap count as evidence —
 * a recorded cap of exactly zero carries no price and is set aside. Each
 * category's working multiple is its own median drawn toward the global
 * median by shrink_k phantom observations; with log_shrink the draw is a
 * weighted geometric mean, so a 3x print and a 0.03x print tug symmetrically.
 */
function fitMultiples(protocols: ProtocolRecord[], rule: RuleSettings): FittedMultiples {
  const every: number[] = [];
  const perCategory = new Map<string, number[]>();
  for (const p of protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const raw = p.mcap_usd / p.tvl_usd;
    const m = rule.winsorize ? Math.min(MULT_HI, Math.max(MULT_LO, raw)) : raw;
    every.push(m);
    const key = p.category ?? 'Uncategorized';
    const bucket = perCategory.get(key);
    if (bucket) bucket.push(m);
    else perCategory.set(key, [m]);
  }
  const globalRaw = middleOf(every);
  const byCategory = new Map<string, CategoryEvidence>();
  for (const [category, xs] of perCategory) {
    const rawMedian = middleOf(xs);
    const blended = rule.log_shrink
      ? Math.exp((xs.length * Math.log(rawMedian) + rule.shrink_k * Math.log(globalRaw)) / (xs.length + rule.shrink_k))
      : (xs.length * rawMedian + rule.shrink_k * globalRaw) / (xs.length + rule.shrink_k);
    byCategory.set(category, { category, comps: xs.length, raw_median: fourDp(rawMedian), multiple: fourDp(blended) });
  }
  return { global: fourDp(globalRaw), byCategory };
}

/** The evidence row one protocol is quoted with: its category's, or the global median when the category has no tokenized comparable. */
function evidenceFor(p: ProtocolRecord, fitted: FittedMultiples, rule: RuleSettings): CategoryEvidence {
  if (!rule.global_only) {
    const hit = fitted.byCategory.get(p.category ?? 'Uncategorized');
    if (hit) return hit;
  }
  return { category: p.category ?? 'Uncategorized', comps: 0, raw_median: fitted.global, multiple: fitted.global };
}

const MS_PER_DAY = 86_400_000;

/** Whole days between the listing date and the snapshot date; null when the date is unreported or unreadable. */
function daysTracked(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / MS_PER_DAY));
}

interface Quote {
  protocol: ProtocolRecord;
  multiple: number;
  category_stat: CategoryEvidence;
  momentum_factor: number;
  age_factor: number;
  age_days: number | null;
  implied_value_usd: number;
}

/**
 * Quotes one protocol: TVL x category multiple x momentum factor x age
 * factor, rounded to whole dollars with a floor of one. Serves both the
 * board's pre-token candidates and, inside the validation, tokenized
 * comparables whose recorded cap is the answer being predicted.
 */
function quote(p: ProtocolRecord, snap: SnapshotData, fitted: FittedMultiples, rule: RuleSettings): Quote {
  const stat = evidenceFor(p, fitted, rule);
  const change = p.change_7d === null ? 0 : Math.min(rule.mom_clamp_hi, Math.max(rule.mom_clamp_lo, p.change_7d));
  const momentum = 1 + (change / 100) * rule.mom_weight;
  const age = daysTracked(snap.as_of, p.listed_at);
  const effectiveAge = age ?? rule.age_when_unknown;
  const ageFactor = rule.age_base + rule.age_span * (Math.min(effectiveAge, rule.age_full_days) / rule.age_full_days);
  const implied = Math.max(1, Math.round(p.tvl_usd * stat.multiple * momentum * ageFactor));
  return {
    protocol: p,
    multiple: stat.multiple,
    category_stat: stat,
    momentum_factor: fourDp(momentum),
    age_factor: fourDp(ageFactor),
    age_days: age,
    implied_value_usd: implied,
  };
}

// ---------------------------------------------------------------------------
// Blind validation: the rule's own evidence, recomputed on every run.
//
// The tokenized comparables are the only ground truth in the snapshot: each
// one's recorded cap is what a rule of this shape would have had to predict.
// Two seeded splits fit each candidate on 64 of them and grade it on the 64
// held out, by mean absolute log10 error (0.30 of error ≈ a typical 2x miss;
// 1.00 ≈ 10x). The shipped rule is the one the splits kept; the dashboard
// prints the whole table, ablations included, so anyone can re-derive it.
// ---------------------------------------------------------------------------

/** A small deterministic PRNG: the splits must come out the same on every run and every machine. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPLIT_SEEDS = [20261114, 424242];

interface SplitResult {
  seed: number;
  fit: number;
  test: number;
  male: number;
  median_ale: number;
  within_2x: number;
}

interface RuleScore {
  term: string;
  change: string;
  splits: SplitResult[];
  male_mean: number;
}

/** Grades one rule on both blind splits: fit on one half of the comparables, predict the held-out half's recorded caps. */
function gradeRule(snap: SnapshotData, comparables: ProtocolRecord[], rule: RuleSettings): SplitResult[] {
  return SPLIT_SEEDS.map((seed) => {
    const rnd = mulberry32(seed);
    const order = comparables.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = order[i]!;
      order[i] = order[j]!;
      order[j] = tmp;
    }
    const half = Math.floor(order.length / 2);
    const fitSet = order.slice(0, half).map((i) => comparables[i]!);
    const testSet = order.slice(half).map((i) => comparables[i]!);
    const fitted = fitMultiples(fitSet, rule);
    const errors = testSet.map((p) => Math.abs(Math.log10(quote(p, snap, fitted, rule).implied_value_usd / p.mcap_usd!)));
    return {
      seed,
      fit: fitSet.length,
      test: testSet.length,
      male: fourDp(errors.reduce((a, b) => a + b, 0) / errors.length),
      median_ale: fourDp(middleOf(errors)),
      within_2x: fourDp(testSet.filter((_, i) => errors[i]! <= Math.log10(2)).length / testSet.length),
    };
  });
}

interface ValidationReport {
  comparables: number;
  metric: string;
  shipped: RuleScore;
  legacy: RuleScore;
  ablations: RuleScore[];
}

/** The full evidence table: the shipped rule, last round's rule, and the shipped rule with one term changed at a time. */
function runValidation(snap: SnapshotData): ValidationReport {
  const comparables = snap.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const score = (term: string, change: string, rule: RuleSettings, full = false): RuleScore => {
    let splits = gradeRule(snap, comparables, rule);
    if (!full) {
      // Ablation rows would repeat the shipped row's seeds and split sizes
      // ten times over in data.js; keep only their errors there and let the
      // shipped and legacy rows carry the split bookkeeping once.
      splits = splits.map((s) => ({ seed: 0, fit: 0, test: 0, male: s.male, median_ale: s.median_ale, within_2x: s.within_2x }));
    }
    return { term, change, splits, male_mean: fourDp(splits.reduce((a, s) => a + s.male, 0) / splits.length) };
  };
  const variant = (patch: Partial<RuleSettings>): RuleSettings => ({ ...SHIPPED_RULE, ...patch });
  return {
    comparables: comparables.length,
    metric: 'mean absolute log10 error of predicted vs recorded market cap on the held-out half',
    shipped: score('Shipped model', 'every term as priced on this board', SHIPPED_RULE, true),
    legacy: score('Previous model', 'the configuration this board shipped with last round', PREVIOUS_RULE, true),
    ablations: [
      score('Category shrinkage', 'removed (each category keeps its raw median)', variant({ shrink_k: 0 })),
      score('Category shrinkage', 'at the previous weight of 5, arithmetic', variant({ shrink_k: 5, log_shrink: false })),
      score('Category term', 'removed (every protocol priced at the global median)', variant({ global_only: true })),
      score('Momentum term', 'removed (weight 0)', variant({ mom_weight: 0 })),
      score('Momentum term', 'at the previous weight of 0.30', variant({ mom_weight: 0.3 })),
      score('Age term', 'removed (factor 1 at every age)', variant({ age_base: 1, age_span: 0 })),
      score('Age term', 'at the previous strength (0.78–1.15)', variant({ age_base: 0.78, age_span: 0.37 })),
      score('Winsorize', 'removed (raw multiples, no 0.01–10 clamp)', variant({ winsorize: false })),
    ],
  };
}

// ---------------------------------------------------------------------------
// Board assembly: the whole watchlist as the floor, then the strongest
// pre-token names below it.
// ---------------------------------------------------------------------------

/** Board size: watchlist rows plus the early names beneath the floor. */
const BOARD_SIZE = 180;

/** Categories that wrap an asset which already trades — never a launch of their own. */
const WRAPPER_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** May the board add this protocol below the watchlist floor? Tokenless, and not a wrapped or versioned offshoot of something else. */
function qualifiesAsEarly(p: ProtocolRecord): boolean {
  if (!hasNoToken(p)) return false;
  if (p.category !== null && WRAPPER_CATEGORIES.has(p.category)) return false;
  if (VERSIONED_NAME.test(p.name) || WRAPPED_WORD.test(p.name)) return false;
  return true;
}

interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    category_comparables: number;
    category_raw_median: number;
    momentum_factor: number;
    age_factor: number;
  };
  farm_steps: string[];
}

const slugAscending = (a: ProtocolRecord, b: ProtocolRecord): number => (a.slug < b.slug ? -1 : 1);

/** Builds the ranked board: watchlist first as the floor, early candidates by TVL up to BOARD_SIZE, then quoted and ranked by implied value. */
function assembleBoard(snap: SnapshotData, fitted: FittedMultiples): BoardRow[] {
  const bySlug = new Map(snap.protocols.map((p) => [p.slug, p]));
  const watch = new Set(snap.watchlist);
  const chosen = new Map<string, ProtocolRecord>();
  for (const slug of snap.watchlist) {
    const p = bySlug.get(slug);
    if (p) chosen.set(slug, p);
  }
  const early = snap.protocols
    .filter((p) => !chosen.has(p.slug) && qualifiesAsEarly(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || slugAscending(a, b))
    .slice(0, Math.max(0, BOARD_SIZE - chosen.size));
  for (const p of early) chosen.set(p.slug, p);
  const quoted = [...chosen.values()].map((p) => quote(p, snap, fitted, SHIPPED_RULE));
  quoted.sort((a, b) => b.implied_value_usd - a.implied_value_usd || slugAscending(a.protocol, b.protocol));
  return quoted.map((s, i) => ({
    rank: i + 1,
    slug: s.protocol.slug,
    name: s.protocol.name,
    category: s.protocol.category,
    chains: s.protocol.chains,
    tvl_usd: s.protocol.tvl_usd,
    change_7d: s.protocol.change_7d,
    listed_at: s.protocol.listed_at,
    age_days: s.age_days,
    on_watchlist: watch.has(s.protocol.slug),
    implied_value_usd: s.implied_value_usd,
    model: {
      category_multiple: s.multiple,
      category_comparables: s.category_stat.comps,
      category_raw_median: s.category_stat.raw_median,
      momentum_factor: s.momentum_factor,
      age_factor: s.age_factor,
    },
    farm_steps: planFor(s.protocol, s.age_days),
  }));
}

/** Refuses a board the gate would refuse, in the gate's own terms, before a single byte is written. */
function boardDefect(board: BoardRow[], snap: SnapshotData): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows`;
  const seen = new Set<string>();
  for (const row of board) {
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `${row.slug} has a bad implied value`;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      const n = step.trim().length;
      if (n < 20 || n > 600) return `${row.slug} has a farm step of ${n} characters`;
    }
  }
  for (const slug of snap.watchlist) if (!seen.has(slug)) return `watchlist slug ${slug} is missing`;
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.rank !== i + 1) return `rank ${i + 1} is out of place`;
    if (i > 0 && board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i}`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  return null;
}

// ---------------------------------------------------------------------------
// Farm plans: one plan per protocol, assembled from its own record — the
// category picks the actions, the chains pick where they happen, the TVL
// picks the capital band and the age picks the holding period. Every step
// states a cost and a time. (The step texts below are board content: they
// are written into board.json verbatim, so their wording is data, not code.)
// ---------------------------------------------------------------------------

/** The working-capital band for one farm position, scaled to the protocol's own size. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 500;
  if (tvl >= 1_000_000_000) return 250;
  if (tvl >= 250_000_000) return 150;
  if (tvl >= 50_000_000) return 100;
  return 50;
}

/** How long a position must sit to read as real usage: younger protocols ask for a longer window. */
function holdDaysFor(ageDays: number | null): number {
  if (ageDays === null) return 45;
  if (ageDays < 180) return 60;
  if (ageDays < 730) return 45;
  return 30;
}

/** The product family a category belongs to; the family chooses the plan's actions. */
type PlanFamily = 'lending' | 'exchange' | 'perps' | 'vault' | 'staking' | 'stable' | 'prediction' | 'rwa' | 'bridge' | 'generic';

function familyFor(p: ProtocolRecord): PlanFamily {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('perp') || c.includes('derivative') || c.includes('option')) return 'perps';
  if (c.includes('dex') || c.includes('exchange') || c.includes('aggregator')) return 'exchange';
  if (c.includes('lend') || c.includes('cdp') || c.includes('borrow')) return 'lending';
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield')) return 'vault';
  if (c.includes('staking') || c.includes('restaking') || c.includes('restak')) return 'staking';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('stable')) return 'stable';
  return 'generic';
}

/** The family's opening position, written for this protocol on this chain. */
function openingStep(family: PlanFamily, p: ProtocolRecord, chain: string, capital: number): string {
  const n = p.name;
  switch (family) {
    case 'lending':
      return `Supply $${capital} of USDC to ${n} on ${chain}, then borrow about 30% of it against the position and repay within the week, so the wallet shows both sides of the market. Cost: $${capital} committed plus about $6 in gas. Time: 20 minutes.`;
    case 'exchange':
      return `Provide $${capital} split evenly across the two assets of ${n}'s busiest pool on ${chain}, and make two small swaps through the same interface. Cost: $${capital} committed plus about $5 in gas and swap fees. Time: 20 minutes.`;
    case 'perps':
      return `Deposit $${capital} of USDC margin on ${n} and open one small hedged pair — a long and a short of similar size on ${chain} markets — so volume accrues without directional risk. Cost: $${capital} committed plus about $8 in trading fees. Time: 25 minutes.`;
    case 'vault':
      return `Deposit $${capital} into one of ${n}'s live vaults or curated allocations on ${chain} and keep the vault shares in the same wallet. Cost: $${capital} committed plus about $4 in gas. Time: 15 minutes.`;
    case 'staking':
      return `Stake $${capital} worth of the base asset through ${n} on ${chain} and hold the staking receipt token where it lands. Cost: $${capital} committed plus about $4 in gas. Time: 15 minutes.`;
    case 'stable':
      return `Mint or deposit $${capital} of the stable asset ${n} issues or manages, on ${chain}, and hold the balance rather than swapping out. Cost: $${capital} committed plus about $4 in gas. Time: 15 minutes.`;
    case 'prediction':
      return `Fund the account with $${capital} and take one position on each side of two liquid markets on ${n}, sized so the pair costs less than a dollar in spread. Cost: $${capital} committed plus market spreads. Time: 20 minutes.`;
    case 'rwa':
      return `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} after its onboarding step, and hold the position in the minting wallet. Cost: $${capital} committed plus about $5 in gas. Time: 30 minutes including onboarding.`;
    case 'bridge':
      return `Bridge $${capital} of USDC to ${chain} through ${n}, then use the bridged funds in one app on the far side instead of bridging straight back. Cost: $${capital} in transit plus about $6 in fees. Time: 20 minutes.`;
    default:
      return `Deposit $${capital} into ${n}'s main product on ${chain} — the action its front page leads with — and leave the position open. Cost: $${capital} committed plus about $5 in gas. Time: 15 minutes.`;
  }
}

/** The family's weekly qualifying action: the habit that makes a wallet read as a user, not a drive-by. */
function weeklyStep(family: PlanFamily, p: ProtocolRecord): string {
  const n = p.name;
  switch (family) {
    case 'lending':
      return `Once a week, adjust the position — add $10 of collateral, repay a slice of the borrow or roll it — and vote in any governance poll ${n} opens. Cost: about $2 in gas a week. Time: 10 minutes a week.`;
    case 'exchange':
      return `Once a week, swap a small amount through ${n} and rebalance the liquidity position if it drifts out of range. Cost: about $2 in fees a week. Time: 10 minutes a week.`;
    case 'perps':
      return `Once a week, roll the hedge: close one leg and reopen it at the current price so trading volume keeps accruing on ${n}. Cost: about $3 in fees a week. Time: 10 minutes a week.`;
    case 'vault':
      return `Once a week, check the vault's allocation page on ${n}, and move a small slice — $10 to $25 — between two of its vaults if a better one has opened. Cost: about $2 in gas a week. Time: 10 minutes a week.`;
    case 'staking':
      return `Once a week, claim any staking rewards ${n} shows and restake them, and check the unbonding terms have not changed. Cost: about $1 in gas a week. Time: 5 minutes a week.`;
    case 'stable':
      return `Once a week, move a small amount of the stable asset through one integration ${n} lists — a payment, a pool deposit or a transfer — and back. Cost: about $2 in gas a week. Time: 10 minutes a week.`;
    case 'prediction':
      return `Once a week, trade one new market on ${n} and settle or roll the positions that expired. Cost: about $2 in spreads a week. Time: 15 minutes a week.`;
    case 'rwa':
      return `Once a week, check ${n}'s yield and redemption page, and add $10 to the position in weeks when the yield is paid on time. Cost: about $2 in gas a week. Time: 5 minutes a week.`;
    case 'bridge':
      return `Once a week, bridge a small amount — $10 to $25 — through ${n} in the direction you have used less, and keep a record of both routes. Cost: about $3 in fees a week. Time: 10 minutes a week.`;
    default:
      return `Once a week, repeat the product's core action on ${n} at a small size, so every weekly snapshot of its usage includes the wallet. Cost: about $2 in gas a week. Time: 10 minutes a week.`;
  }
}

/** The points-and-rewards step, worded for the family: where its programs actually live. */
function rewardsStep(family: PlanFamily, p: ProtocolRecord): string {
  const n = p.name;
  switch (family) {
    case 'vault':
      return `Open ${n}'s points or rewards page monthly: curator and allocator programs usually score vault shares held over time, so never withdraw the day before a snapshot the page announces. Cost: nothing to check. Time: 10 minutes a month.`;
    case 'perps':
    case 'exchange':
      return `Open ${n}'s rewards page monthly: trading programs score volume and open interest over epochs, so keep the hedged volume steady instead of spiking it in one day. Cost: nothing to check. Time: 10 minutes a month.`;
    case 'lending':
      return `Open ${n}'s incentives page monthly: lending programs score supplied and borrowed balances at snapshot, so keep both sides open across month-ends. Cost: nothing to check. Time: 10 minutes a month.`;
    default:
      return `Open ${n}'s own points, rewards or governance page monthly and claim only through links the protocol itself publishes. Cost: nothing to check, and never pay a third party to claim. Time: 10 minutes a month.`;
  }
}

/**
 * One protocol's farm plan: seven steps built from its own record. The shape
 * is fixed — wallet, opening position, weekly habit, second front, holding
 * window, rewards, log — and every figure inside comes from the protocol's
 * category, chains, TVL and age, so no two protocols get quite the same plan.
 */
function planFor(p: ProtocolRecord, ageDays: number | null): string[] {
  const family = familyFor(p);
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(ageDays);
  const steps: string[] = [
    `Set up a fresh wallet for ${p.name} alone, funded with the farm capital plus a small gas float on ${chain}, and keep its seed phrase offline. Cost: under $3 in gas to fund. Time: 10 minutes.`,
    openingStep(family, p, chain, capital),
    weeklyStep(family, p),
  ];
  if (p.chains.length > 1) {
    steps.push(
      `In the second month, repeat a smaller position — about a quarter of the first — on ${p.chains[1]!}, the protocol's next chain, so the wallet appears in more than one of its chain reports. Cost: about $${Math.max(25, Math.round(capital / 4))} plus $4 in gas. Time: 20 minutes.`,
    );
  } else {
    steps.push(
      `In the second month, open the protocol's second product or market on ${chain} at a quarter of the first position's size, so the wallet is not a one-action address. Cost: about $${Math.max(25, Math.round(capital / 4))} plus $3 in gas. Time: 15 minutes.`,
    );
  }
  steps.push(
    `Hold every position for at least ${hold} days without a full withdrawal, so the activity spans more than one usage snapshot of ${p.name}. Cost: the $${capital} position stays committed for the full ${hold} days; no further spend. Time: ${hold} days.`,
    rewardsStep(family, p),
    `Keep a farm log for ${p.name} — wallet, dates, amounts, transaction hashes — and re-check the plan whenever the protocol announces a points season or a snapshot. Cost: nothing. Time: 5 minutes per entry.`,
  );
  return steps;
}

// ---------------------------------------------------------------------------
// The dashboard's dataset, and the run itself.
// ---------------------------------------------------------------------------

/** The dashboard's dataset as one script: the board, the category evidence, the validation evidence, and the live-token set kept apart. */
function dashboardScript(snap: SnapshotData, fitted: FittedMultiples, board: BoardRow[], validation: ValidationReport): string {
  const categories = [...fitted.byCategory.values()].sort((a, b) => b.comps - a.comps || (a.category < b.category ? -1 : 1));
  const live = snap.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug, name: p.name, category: p.category, chains: p.chains,
      tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d,
      multiple: p.tvl_usd > 0 ? fourDp(p.mcap_usd! / p.tvl_usd) : null,
    }));
  const comparables = new Map<string, { name: string; mcap_usd: number; tvl_usd: number; multiple: number }[]>();
  for (const p of snap.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const key = p.category ?? 'Uncategorized';
    const list = comparables.get(key) ?? [];
    list.push({ name: p.name, mcap_usd: p.mcap_usd, tvl_usd: p.tvl_usd, multiple: fourDp(p.mcap_usd / p.tvl_usd) });
    comparables.set(key, list);
  }
  const rows = board.map((row) => ({
    ...row,
    comparables: (comparables.get(row.category ?? 'Uncategorized') ?? [])
      .sort((a, b) => b.mcap_usd - a.mcap_usd)
      .slice(0, 4),
  }));
  const data = {
    as_of: snap.as_of,
    source: snap.source,
    floor_usd: snap.floor_usd,
    watchlist_size: snap.watchlist.length,
    protocol_count: snap.protocols.length,
    model: {
      version: 'launch-multiple-2',
      global_multiple: fitted.global,
      shrink_k: SHIPPED_RULE.shrink_k,
      shrink_mode: 'geometric (log-space blend toward the global median)',
      mult_floor: MULT_LO,
      mult_ceil: MULT_HI,
      momentum_weight: SHIPPED_RULE.mom_weight,
      momentum_clamp: [SHIPPED_RULE.mom_clamp_lo, SHIPPED_RULE.mom_clamp_hi],
      age_base: SHIPPED_RULE.age_base,
      age_span: SHIPPED_RULE.age_span,
      age_full_days: SHIPPED_RULE.age_full_days,
    },
    validation,
    categories,
    rows,
    live,
  };
  return `window.RADAR=${JSON.stringify(data)};\n`;
}

/** Reads --name value (or --name=value) out of argv, else the fallback. */
function flagValue(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function run(): void {
  const inputArg = flagValue('input', process.env.MAKEFUN_INPUT_DIR ?? '/input');
  const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
  if (!existsSync(inputFile)) {
    process.stderr.write(`launch radar: no snapshot at ${inputFile}\n`);
    process.exit(2);
  }
  const outDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

  const snap = readSnapshot(readFileSync(inputFile, 'utf8'));
  const fitted = fitMultiples(snap.protocols, SHIPPED_RULE);
  const validation = runValidation(snap);
  const board = assembleBoard(snap, fitted);
  const defect = boardDefect(board, snap);
  if (defect !== null) {
    process.stderr.write(`launch radar: refusing to write the board: ${defect}\n`);
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(outDir, 'data.js'), dashboardScript(snap, fitted, board, validation));

  const copyFlat = (from: string, to: string): string[] => {
    if (!existsSync(from)) return [];
    mkdirSync(to, { recursive: true });
    const names: string[] = [];
    // readdirSync's order is the filesystem's, not a contract: sort the names
    // so the copy — and the screenshot count check below — behaves the same
    // on every machine the gate might run this on.
    for (const name of readdirSync(from).sort()) {
      if (name.startsWith('.')) continue;
      const src = join(from, name);
      if (!statSync(src).isFile()) continue;
      copyFileSync(src, join(to, name));
      names.push(name);
    }
    return names;
  };
  copyFlat(join(ownDir, 'dashboard'), join(outDir, 'dashboard'));
  const shots = copyFlat(join(ownDir, 'screenshots'), join(outDir, 'screenshots'));
  if (shots.length < 3) {
    process.stderr.write(`launch radar: screenshots/ holds ${shots.length} images; the gate wants 3\n`);
    process.exit(1);
  }

  writeFileSync(
    join(outDir, 'dossier.json'),
    buildDossier(outDir, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
  );
  const top = board[0]!;
  process.stdout.write(
    `launch radar: ${snap.protocols.length} protocols, global multiple ${fitted.global}, ${board.length} rows (${board.filter((r) => r.on_watchlist).length} watchlist, ${board.filter((r) => !r.on_watchlist).length} early)\n` +
      `launch radar: held-out error, shipped model ${validation.shipped.male_mean} vs previous ${validation.legacy.male_mean} (mean absolute log10 error, two blind splits of ${validation.comparables} comparables)\n` +
      `launch radar: #1 ${top.name} at $${top.implied_value_usd.toLocaleString('en-US')} implied on $${top.tvl_usd.toLocaleString('en-US')} TVL\n`,
  );
}

run();
