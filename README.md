<div align="center">

<img src="assets/logo.png?v=1" width="280">

<p><em>A token launch radar ranking 180 pre-token protocols by implied value from a sealed DefiLlama snapshot, with per-protocol farm plans.</em></p>

<p>
<img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&labelColor=FF7A00&color=0A1931" alt="TypeScript">
<img src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge&labelColor=FF7A00&color=0A1931" alt="MIT License">
<img src="https://img.shields.io/badge/By-Kontenlaris%20Studio-orange?style=for-the-badge&labelColor=FF7A00&color=0A1931" alt="By Kontenlaris Studio">
</p>

</div>

# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/kontenlaris-studio/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/kontenlaris-studio/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A launch radar built on one sealed DefiLlama snapshot (14 Nov 2026). It ranks 180 protocols that record no token yet by an implied launch value, and — unusually for a board like this — it shows its working: every price can be re-derived by hand from the snapshot, and the pricing rule itself was fitted and graded blind before it was allowed to ship.

How a price is made:

- The snapshot's 128 tokenized protocols are the only teachers. Each contributes a market-cap / TVL multiple, winsorized to [0.01, 10]; per category, the median of those multiples is shrunk toward the global median (0.2138) with a geometric blend at weight 40, so a category priced off one print lands near the market instead of on that print.
- Two seeded blind splits (mulberry32, seeds 20261114 and 424242) fit the rule on 64 comparables and grade it on the 64 held out. The shipped configuration scores a mean absolute log10 error of 0.8150 against 0.8357 for the previous round's configuration; the ablations that justify each term ship in the dashboard's "Tested blind" panel.
- A board row is TVL × its category multiple × a momentum factor (7-day TVL change, clamped to [−40%, +80%], weight 0.10) × an age factor (0.95–1.05 over 1,460 tracked days). All 40 watchlist protocols are on the board; the other 140 are the strongest tokenless names below the floor, with wrapped, staked, bridged and versioned offshoots excluded.

Each row also carries a seven-step farm plan generated from its own record — the category picks the actions, the chains pick where, the TVL picks the capital band ($50–$500), the age picks the holding window (30–60 days) — and every step states a cost and a time.

The dashboard is fully static and offline: search, category / chain / value filters, five sort orders, a per-protocol detail view with the complete value breakdown and its largest comparables, an evidence-grade and risk-flag layer, and a category-evidence panel. Tokenized protocols are never ranked; the largest of them appear in a separate panel, labelled as the market's own values.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=<snapshot dir> MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` reads the snapshot and writes `board.json`, the dashboard's `data.js`, and `dossier.json` (through the vendored `buildDossier`) into the output directory. Two consecutive runs produce byte-identical output: the model is a pure function of the snapshot — medians, clamps and sorts with slug tie-breaks, no clocks, no randomness outside the two fixed validation seeds.

---

<sub>Entered on [make.fun](https://make.fun/?ref=e1py682r&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
