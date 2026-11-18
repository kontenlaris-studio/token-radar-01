// Launch Multiple Radar — a token-radar-01 entry (Node 22, standard library only).
//
// What this program does, in order:
//   1. Reads the sealed DefiLlama snapshot (the grader mounts it at /input/snapshot.json;
//      locally pass --input <file|dir> or set MAKEFUN_INPUT_DIR).
//   2. Learns what the market pays for a dollar of TVL from the snapshot's own tokenized
//      protocols: for each category, the median market-cap / TVL multiple of the protocols
//      whose token already trades, shrunk toward the global median when a category has
//      few comparables to lean on.
//   3. Prices every pre-token protocol as TVL x its category multiple, nudged by its
//      seven-day TVL momentum and by how long it has operated with no token.
//   4. Writes the ranked board to board.json, the dashboard's data to data.js, copies
//      dashboard/ and screenshots/ into the output directory, and writes dossier.json
//      with the vendored buildDossier, byte for byte as the gate rebuilds it.
//
// Run locally:
//   mkdir -p out && MAKEFUN_INPUT_DIR=<kit>/input MAKEFUN_OUTPUT_DIR=out node main.ts

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

// ---------------------------------------------------------------------------
// Snapshot shape: exactly the ten fields the sealed input carries per protocol.
// ---------------------------------------------------------------------------

interface Protocol {
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

interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** Reads and lightly validates the snapshot; anything else is a hard stop, never a guess. */
function loadSnapshot(text: string): Snapshot {
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

/** A protocol records no token when all three token fields are empty in its record. */
const recordsNoToken = (p: Protocol): boolean => p.gecko_id === null && p.symbol === null && p.mcap_usd === null;

// ---------------------------------------------------------------------------
// The valuation model: category multiples learned from tokenized comparables.
// ---------------------------------------------------------------------------

/** One tokenized protocol's market-cap / TVL multiple, winsorized so one mania print cannot rule a category. */
const MULT_FLOOR = 0.01;
const MULT_CEIL = 10;
/** Pseudo-count of global-median evidence blended into every category median. */
const SHRINK_K = 5;
/** Momentum: the clamped seven-day TVL change, and how much of it the price believes. */
const MOM_CLAMP_LO = -40;
const MOM_CLAMP_HI = 80;
const MOM_WEIGHT = 0.3;
/** Age: a protocol earns the full survival premium after four tokenless years. */
const AGE_FULL_DAYS = 1460;
const AGE_BASE = 0.78;
const AGE_SPAN = 0.37;
const AGE_WHEN_UNKNOWN = 365;

interface CategoryStat {
  category: string;
  comps: number;
  raw_median: number;
  multiple: number;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/**
 * Multiples by category. Tokenized protocols with a positive recorded market cap are
 * the only evidence (a recorded cap of zero carries no price, so it is set aside).
 * Each contributes mcap/TVL clamped to [MULT_FLOOR, MULT_CEIL]. A category's
 * working multiple is its median pulled toward the global median by SHRINK_K phantom
 * observations, so a category priced off two prints lands near the market, not on them.
 */
function learnMultiples(protocols: Protocol[]): { global: number; byCategory: Map<string, CategoryStat> } {
  const all: number[] = [];
  const buckets = new Map<string, number[]>();
  for (const p of protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const m = Math.min(MULT_CEIL, Math.max(MULT_FLOOR, p.mcap_usd / p.tvl_usd));
    all.push(m);
    const key = p.category ?? 'Uncategorized';
    const bucket = buckets.get(key);
    if (bucket) bucket.push(m);
    else buckets.set(key, [m]);
  }
  const global = median(all);
  const byCategory = new Map<string, CategoryStat>();
  for (const [category, xs] of buckets) {
    const raw = median(xs);
    byCategory.set(category, {
      category,
      comps: xs.length,
      raw_median: round4(raw),
      multiple: round4((xs.length * raw + SHRINK_K * global) / (xs.length + SHRINK_K)),
    });
  }
  return { global: round4(global), byCategory };
}

/** The multiple one protocol is priced with: its category's, or the global median when the category has no tokenized comparable. */
function multipleFor(p: Protocol, learned: { global: number; byCategory: Map<string, CategoryStat> }): CategoryStat {
  const stat = learned.byCategory.get(p.category ?? 'Uncategorized');
  if (stat) return stat;
  return { category: p.category ?? 'Uncategorized', comps: 0, raw_median: learned.global, multiple: learned.global };
}

const DAY_MS = 86_400_000;

/** Whole days the protocol has been tracked, as of the snapshot date; null when unreported. */
function trackedDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

interface Priced {
  protocol: Protocol;
  multiple: number;
  category_stat: CategoryStat;
  momentum_factor: number;
  age_factor: number;
  age_days: number | null;
  implied_value_usd: number;
}

/** Prices one pre-token protocol: TVL x category multiple x momentum factor x age factor. */
function price(p: Protocol, snapshot: Snapshot, learned: { global: number; byCategory: Map<string, CategoryStat> }): Priced {
  const stat = multipleFor(p, learned);
  const change = p.change_7d === null ? 0 : Math.min(MOM_CLAMP_HI, Math.max(MOM_CLAMP_LO, p.change_7d));
  const momentum = 1 + (change / 100) * MOM_WEIGHT;
  const age = trackedDays(snapshot.as_of, p.listed_at);
  const ageForFactor = age ?? AGE_WHEN_UNKNOWN;
  const ageFactor = AGE_BASE + AGE_SPAN * (Math.min(ageForFactor, AGE_FULL_DAYS) / AGE_FULL_DAYS);
  const implied = Math.max(1, Math.round(p.tvl_usd * stat.multiple * momentum * ageFactor));
  return { protocol: p, multiple: stat.multiple, category_stat: stat, momentum_factor: round4(momentum), age_factor: round4(ageFactor), age_days: age, implied_value_usd: implied };
}

// ---------------------------------------------------------------------------
// Board assembly: the whole watchlist, then the strongest pre-token names below it.
// ---------------------------------------------------------------------------

/** Board size: the watchlist plus the early names below the floor, capped here. */
const BOARD_ROWS = 180;

/** Categories that are wrappers of an asset that already trades, never a launch of their own. */
const WRAPPER_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** May the board add this protocol below the watchlist floor? Pre-token, and not a wrapped or versioned product of something else. */
function isEarlyCandidate(p: Protocol): boolean {
  if (!recordsNoToken(p)) return false;
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

/** Builds the ranked board: watchlist first as the floor, early candidates by TVL up to BOARD_ROWS, then priced and ranked by implied value. */
function buildBoard(snapshot: Snapshot, learned: { global: number; byCategory: Map<string, CategoryStat> }): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, Protocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isEarlyCandidate(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, Math.max(0, BOARD_ROWS - chosen.size));
  for (const p of early) chosen.set(p.slug, p);

  const priced = [...chosen.values()].map((p) => price(p, snapshot, learned));
  priced.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.protocol.slug < b.protocol.slug ? -1 : 1));
  return priced.map((s, i) => ({
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
    farm_steps: farmPlan(s.protocol, s.age_days),
  }));
}

/** Refuses a board the gate would refuse, in the gate's own terms, before anything is written. */
function boardProblem(board: BoardRow[], snapshot: Snapshot): string | null {
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
  for (const slug of snapshot.watchlist) if (!seen.has(slug)) return `watchlist slug ${slug} is missing`;
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.rank !== i + 1) return `rank ${i + 1} is out of place`;
    if (i > 0 && board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i}`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  return null;
}

// ---------------------------------------------------------------------------
// Farm plans: one plan per protocol, built from its own record — its category
// picks the actions, its chains pick where, its TVL picks the capital band and
// its age picks the holding period. Every step states a cost and a time.
// ---------------------------------------------------------------------------

/** The working-capital band for one farm position, scaled to the protocol's own size. */
function capitalBand(tvl: number): number {
  if (tvl >= 5_000_000_000) return 500;
  if (tvl >= 1_000_000_000) return 250;
  if (tvl >= 250_000_000) return 150;
  if (tvl >= 50_000_000) return 100;
  return 50;
}

/** How long a position must sit to count as real usage: younger protocols ask for a longer window. */
function holdWindow(ageDays: number | null): number {
  if (ageDays === null) return 45;
  if (ageDays < 180) return 60;
  if (ageDays < 730) return 45;
  return 30;
}

/** The product family a category belongs to; the family chooses the plan's actions. */
type Family = 'lending' | 'exchange' | 'perps' | 'vault' | 'staking' | 'stable' | 'prediction' | 'rwa' | 'bridge' | 'generic';

function familyOf(p: Protocol): Family {
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
function openingAction(family: Family, p: Protocol, chain: string, capital: number): string {
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

/** The family's weekly qualifying action: the habit that makes a wallet read as a user. */
function weeklyAction(family: Family, p: Protocol): string {
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

/** The points and rewards step, worded for the family: where its programs actually live. */
function rewardsStep(family: Family, p: Protocol): string {
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
 * One protocol's farm plan: six steps from its own record. The shape is fixed —
 * wallet, opening position, weekly habit, second front, holding window, rewards,
 * log — and every figure inside comes from the protocol's category, chains, TVL
 * and age, so two protocols never receive quite the same plan.
 */
function farmPlan(p: Protocol, ageDays: number | null): string[] {
  const family = familyOf(p);
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const capital = capitalBand(p.tvl_usd);
  const hold = holdWindow(ageDays);
  const steps: string[] = [
    `Set up a fresh wallet for ${p.name} alone, funded with the farm capital plus a small gas float on ${chain}, and keep its seed phrase offline. Cost: under $3 in gas to fund. Time: 10 minutes.`,
    openingAction(family, p, chain, capital),
    weeklyAction(family, p),
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
    `Hold every position for at least ${hold} days without a full withdrawal, so the activity spans more than one usage snapshot of ${p.name}. Cost: the capital stays committed for the full ${hold} days. Time: ${hold} days.`,
    rewardsStep(family, p),
    `Keep a farm log for ${p.name} — wallet, dates, amounts, transaction hashes — and re-check the plan whenever the protocol announces a points season or a snapshot. Cost: nothing. Time: 5 minutes per entry.`,
  );
  return steps;
}

// ---------------------------------------------------------------------------
// Dashboard data and the run itself.
// ---------------------------------------------------------------------------

/** --name value (or --name=value) out of argv, else the fallback. */
function argOf(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function main(): void {
  const inputArg = argOf('input', process.env.MAKEFUN_INPUT_DIR ?? '/input');
  const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
  if (!existsSync(inputFile)) {
    process.stderr.write(`launch radar: no snapshot at ${inputFile}\n`);
    process.exit(2);
  }
  const outDir = argOf('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

  const snapshot = loadSnapshot(readFileSync(inputFile, 'utf8'));
  const learned = learnMultiples(snapshot.protocols);
  const board = buildBoard(snapshot, learned);
  const problem = boardProblem(board, snapshot);
  if (problem !== null) {
    process.stderr.write(`launch radar: refusing to write the board: ${problem}\n`);
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board }, null, 1)}\n`);
  writeFileSync(join(outDir, 'data.js'), dataScript(snapshot, learned, board));

  const copyTree = (from: string, to: string): string[] => {
    if (!existsSync(from)) return [];
    mkdirSync(to, { recursive: true });
    const names: string[] = [];
    for (const name of readdirSync(from)) {
      if (name.startsWith('.')) continue;
      const src = join(from, name);
      if (!statSync(src).isFile()) continue;
      copyFileSync(src, join(to, name));
      names.push(name);
    }
    return names;
  };
  copyTree(join(here, 'dashboard'), join(outDir, 'dashboard'));
  const shots = copyTree(join(here, 'screenshots'), join(outDir, 'screenshots'));
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
    `launch radar: ${snapshot.protocols.length} protocols, global multiple ${learned.global}, ${board.length} rows (${board.filter((r) => r.on_watchlist).length} watchlist, ${board.filter((r) => !r.on_watchlist).length} early)\n` +
      `launch radar: #1 ${top.name} at $${top.implied_value_usd.toLocaleString('en-US')} implied on $${top.tvl_usd.toLocaleString('en-US')} TVL\n`,
  );
}

/** The dashboard's dataset as one script: the board, the category evidence, and the live-token set kept apart. */
function dataScript(snapshot: Snapshot, learned: { global: number; byCategory: Map<string, CategoryStat> }, board: BoardRow[]): string {
  const categories = [...learned.byCategory.values()].sort((a, b) => b.comps - a.comps || (a.category < b.category ? -1 : 1));
  const live = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug, name: p.name, category: p.category, chains: p.chains,
      tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d,
      multiple: p.tvl_usd > 0 ? round4(p.mcap_usd! / p.tvl_usd) : null,
    }));
  const comparables = new Map<string, { name: string; mcap_usd: number; tvl_usd: number; multiple: number }[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const key = p.category ?? 'Uncategorized';
    const list = comparables.get(key) ?? [];
    list.push({ name: p.name, mcap_usd: p.mcap_usd, tvl_usd: p.tvl_usd, multiple: round4(p.mcap_usd / p.tvl_usd) });
    comparables.set(key, list);
  }
  const rows = board.map((row) => ({
    ...row,
    comparables: (comparables.get(row.category ?? 'Uncategorized') ?? [])
      .sort((a, b) => b.mcap_usd - a.mcap_usd)
      .slice(0, 4),
  }));
  const data = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    watchlist_size: snapshot.watchlist.length,
    protocol_count: snapshot.protocols.length,
    model: {
      version: 'launch-multiple-1',
      global_multiple: learned.global,
      shrink_k: SHRINK_K,
      mult_floor: MULT_FLOOR,
      mult_ceil: MULT_CEIL,
      momentum_weight: MOM_WEIGHT,
      momentum_clamp: [MOM_CLAMP_LO, MOM_CLAMP_HI],
      age_base: AGE_BASE,
      age_span: AGE_SPAN,
      age_full_days: AGE_FULL_DAYS,
    },
    categories,
    rows,
    live,
  };
  return `window.RADAR=${JSON.stringify(data)};\n`;
}

main();
