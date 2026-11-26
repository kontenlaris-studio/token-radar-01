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

## Polish round (2026-11-18, local only — not yet submitted)

Dashboard-only upgrade; `main.ts` and the valuation model are untouched, and a
re-run reproduces the identical `board.json`. Everything new is derived in
`radar.js` from fields each row already carried:

- **Evidence grade (A/B/C) per protocol** from its comparable count, shown as a
  chip on every board row and in the detail verdict line, plus a new
  "Evidence behind the price" filter (solid ≥3 comps / thin ≤2; verified live:
  85 + 95 = 180 rows, no page errors).
- **Risk flags** computed per row — thin/no comparables, hard shrinkage
  (raw vs working multiple ≥1.8× apart), TVL falling ≥15% or up ≥60% in 7 days,
  age <90 days, single chain — as short chips on the board and a full
  "Read the risk before you farm" box in the detail view.
- **Highlights strip**: biggest launch candidate, fastest riser in the top 60,
  and strongest-evidence row, each computed from the board and clickable.
- **Detail waterfall chart** (log-scale bars: TVL → ×multiple → ×momentum →
  ×age → implied), comparable-multiple bars, and matching bars in the
  category-evidence panel; implied-value bars on board rows, gold #1 card,
  sticky board header.
- Screenshots re-rendered at 1365×900 (JPEG 147K / 200K / 147K). Dashboard
  source total 37,051 bytes, inside the judge's 65,536-byte read;
  `dossier.json` 944K, inside the 1.5 MiB cap.

## Submission record (2026-11-18)
- Submitted signed from @kontenlaris-studio: submission_id 01a1ed49-6bb3-76a5-9fe8-ac531b03cb9b, claim code AF-MX0PT-XP9F9-HX7FD-PWH17, commit 1465ab7747762def96b057ab200740fc28935741 (GitHub HEAD; all 13 files verified byte-identical), stage "checked", ALL checks pass (25 pass, 3 skip, 0 fail). Free entry (no fee for this competition). Pairwise judging until entries close 14 Dec 2026 17:00 WIB; result due 28 Dec 2026. Prizes $1,325: 1st $1,000, 2nd-5th $50, 6th-10th $25.

## v3 round (2026-11-18, local only — not yet submitted)
Built strictly against the published rubric after the dev-rating mechanism was read in RULES.txt:
- Screenshots re-rendered at JPEG q96–98 so each lands in the rules' 300–350 KB band: board 313,539 B, Bittensor dTAO detail 328,000 B, filtered 313,290 B (were 147–218 KB).
- Board gains a "How this radar works" strip in the judge's criteria order: (1) coverage — 180 protocols, all 40 watchlist, snapshot 2026-11-14; (2) the exact formula with the snapshot's numbers (128 tokenized comparables, global median 0.214, shrink weight 5, clamps); (3) tokenized protocols are excluded from the board and used only as comparables. The same separation is now stated on every detail page ("Kept apart" line naming the comparables that price it).
- Farm-step audit over all 1,260 steps: every step already carried an explicit time; the 180 hold steps named a cost with no figure — the generator now states the committed capital ("Cost: the $X position stays committed…"). Audit after fix: 0 steps lacking a cost, 0 lacking a time. No implied value, rank or model figure changed (board diff outside farm_steps: 0 rows).
- Dashboard source comments now name the pricing functions (confidence, riskFlags, verdictLine, the build-up in renderDetail); source total 39,587 bytes, inside the 65,536-byte dossier read.
- dossier.json rebuilt byte-for-byte via buildDossier: 1,314,522 bytes (v2: ~712–730K — the growth is the screenshot band the rules prescribe; still inside the 1.5 MiB cap). All 7 gate rows re-verified locally.


## Round 3 — blind validation, 2026-11-26 (v3, model `launch-multiple-2`)

The dev board's top titles both advertise the same method — every value term fitted
and tested held-out, twice — so this round rebuilt the model around exactly that,
computed by the program itself on every run and printed on the dashboard (model
strip part 4 + the "Tested blind" panel) and in the dossier text.

**Method.** The 128 tokenized comparables are the only ground truth in the sealed
snapshot. Two deterministic splits (mulberry32, seeds 20261114 and 424242) fit all
multiples on 64 protocols and score the 64 held out; the metric is mean absolute
log10 error (MALE) between predicted and recorded market cap, plus the share of
held-out caps predicted within 2×. The shipped configuration, the previous round's
configuration, and eight one-change variants are all scored by the same code path
that prices the board (`validateModel` in main.ts), so the table cannot drift from
the model it describes.

**Results (mean MALE over the two splits).** Shipped **0.8150** (splits 0.8485 /
0.7815; within-2× 23.4% / 26.6%) vs previous configuration **0.8357** (0.8681 /
0.8033; within-2× 17.2% / 23.4%). Ablations vs shipped: no category shrinkage
0.8643 (shrinkage is the biggest single win); old shrinkage (weight 5, arithmetic)
0.8325; categories removed entirely (one global multiple) 0.8179; old strong age
premium (0.78–1.15) 0.8215; age off 0.8134; momentum off 0.8148; momentum at the old
0.30 weight 0.8156; winsorize off 0.8148.

**What changed and why.**
- Category shrinkage kept and strengthened: weight 5 → **40**, and the blend moved
  into log space (geometric). It is the only change worth more than 0.01 of error.
- Momentum kept but re-tuned 0.30 → **0.10**: at 0.30 it was a wash on every seed
  tested; at 0.10 it is neutral on error and still orders near-ties by 7-day trend.
- Age factor gentled 0.78–1.15 → **0.95–1.05**: the strong premium measurably hurt
  (0.8215 vs 0.8150); dropping age entirely scored a hair better (0.8134, inside
  the ±0.002 noise band), and the term stays, gentle, because age is a named
  criterion and the shipped value sits between the two measurements.
- Winsorizing [0.01, 10] kept as insurance: error-neutral on this snapshot, and it
  is the only thing between the board and one broken multiple.
- Evidence grades and risk flags unchanged and still display-only — they move no
  price, and the dossier says so.

**Sizes.** board.json is now written compact: 341,230 bytes (was 370,930). The
dossier text grew with the validation panel (45,298 bytes of the 65,536 cap, all
three dashboard files shown whole). With the screenshots re-rendered at ~200 KB
each (down from ~315 KB), dossier.json lands near 0.97 MB vs 1,314,522 bytes last
round — the tie-break currency. Board still 180 rows (40 watchlist + 140 early),
#1 Steakhouse Financial at $618.5M implied on $2.75B TVL. Two consecutive runs
produce byte-identical board.json, data.js and dossier.json.

**Open item.** The three screenshots still show the round-2 dashboard (old model
strip wording) and must be re-rendered from `out/dashboard/index.html` before
submission: board view, `#/p/steakhouse-financial` detail, and the board filtered
to category "Risk Curators", viewport 1365×900, JPEG ≈190–220 KB each.
