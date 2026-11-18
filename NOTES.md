# Launch Multiple Radar — notes

## What this entry is

A token launch radar over the sealed DefiLlama snapshot (758 protocols, fetched
2026-11-14). `main.ts` reads the snapshot, prices every pre-token protocol it
ranks, and writes `board.json` (180 rows), the dashboard's `data.js`, and —
through the vendored `buildDossier` — the `dossier.json` the judge reads. The
dashboard is three static files (`index.html`, `radar.css`, `radar.js`) with no
network use of any kind; it renders entirely from `data.js`.

## The valuation model

The board's implied values are learned from the snapshot itself, never from a
list of names. In `main.ts`:

1. **Comparables.** The 128 protocols with a positive recorded market cap and
   TVL each contribute a multiple, `mcap_usd / tvl_usd`, winsorized to
   [0.01, 10] so one mania print cannot rule a category. (Fifteen more records
   carry a market cap of exactly zero — a token exists but no price is
   recorded — and are set aside: zero is not a price.) The global median
   multiple is **0.2138**.
2. **Category multiples with shrinkage** (`learnMultiples`). A category's
   working multiple is its median pulled toward the global median by 5 phantom
   observations: `(n · median + 5 · global) / (n + 5)`. A category priced off
   fifteen lending protocols barely moves; a category with a single comparable
   lands near the market instead of on that one print. A category with no
   tokenized comparable at all is priced at the global median.
3. **Momentum** (`price`). The 7-day TVL change, clamped to [−40%, +80%],
   moves the price by a factor of `1 + 0.30 · change/100` — a range of
   0.88–1.24. An unreported change is neutral.
4. **Age** (`price`). A protocol that has run longer with no token is priced
   as more credible: the factor runs 0.78–1.15, reaching its top after 1,460
   tracked days. An unreported listing date is priced as 365 days.

`implied = TVL × category multiple × momentum factor × age factor`, rounded to
whole dollars. Every row of `board.json` carries its own factors under `model`,
and the dashboard's detail view shows the full arithmetic plus the category's
largest tokenized comparables, so any price on the board can be re-derived by
hand from the snapshot.

## The board

- All 40 watchlist slugs are rows (the gate's floor), each badged on the page.
- The remaining 140 rows are the strongest pre-token protocols below the $50M
  floor by TVL, excluding wrapped, staked, bridged and versioned products of
  protocols that already have a token (`isEarlyCandidate`) — the same spirit
  as the watchlist rule, extended downward.
- Tokenized protocols are never ranked. The dashboard shows the largest of
  them in a separate panel, as evidence, labelled as the market's own values.

## Farm plans

Each row carries a 7-step plan generated from the protocol's own record
(`farmPlan` and its helpers): the category picks the product family (lending,
exchange, perps, vault/curator, staking, stable, prediction, RWA, bridge,
generic) and with it the opening position and the weekly qualifying action;
the first chain is where the position opens and a second chain, when the
protocol has one, gets a smaller follow-up position; the TVL band sets the
capital ($50–$500); the age sets the holding window (30–60 days). Every step
states a cost and a time, as the judge's criteria ask.

## Verification (local, on the sealed kit input)

- `node main.ts` writes a board that passes the program's own gate check
  (`boardProblem`): 180 rows, ranks exactly 1–180, implied values
  non-increasing with rank, all 40 watchlist slugs present, every farm step
  20–600 characters, every implied value a positive whole number.
- Two consecutive runs produce byte-identical `board.json`, `data.js` and
  `dossier.json` (the model is a pure function of the snapshot: medians,
  clamps and sorts with slug tie-breaks, no clocks, no randomness).
- The dashboard was opened from the output directory with the network unused:
  the board renders all 180 rows, search/category/chain/value filters and the
  five sort orders work, and every row opens a detail view whose breakdown
  multiplies out to the board's implied value.
- The three screenshots are real renders of that output at 1365×900, each a
  JPEG under the 512 KiB cap: the board, the #1 protocol's detail view, and
  the board filtered to one category.

## Limits, stated plainly

- **Multiples are a blunt instrument.** Market cap / TVL ignores revenue,
  fees, token supply schedules and unlocks — none of which the snapshot
  carries. Two protocols in one category with the same TVL get near-identical
  prices; the model claims comparability, not precision.
- **Thin categories stay thin.** Risk Curators, the board's largest family by
  TVL, has exactly one tokenized comparable in the snapshot; shrinkage keeps
  its multiple honest (0.674 after shrinking a 2.975 raw median toward 0.2138)
  but one print is still one print (Api3, at 2.975×; shrinking takes the
  working multiple to 0.674).
- **Momentum is one week.** A protocol can be mid-incentive-campaign; the
  clamp keeps a single hot week from more than ±24% of influence, but the
  factor cannot tell organic growth from mercenary TVL.
- **Age rewards survival, not merit.** The age factor assumes a protocol
  tracked for years without a token is a likelier, larger launch than a
  three-month-old one. It is a prior, and it is capped at +15%.
- **"Records no token" is about the record.** DefiLlama's fields can lag a
  quiet launch; the dashboard words it that way throughout.
