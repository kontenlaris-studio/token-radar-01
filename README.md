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

A token launch radar over a sealed DefiLlama snapshot (14 Nov 2026): 180 pre-token protocols ranked by implied launch value — TVL × a category multiple learned from the snapshot's own tokenized protocols (median mcap/TVL, shrunk toward the global median for thin categories), adjusted for 7-day momentum and protocol age. Every row carries a 7-step farm plan; the static dashboard adds search, category/chain/value filters, a per-protocol detail view with the full value breakdown and its comparables, and a category-multiples evidence panel. `main.ts` reads /input/snapshot.json and writes board.json, the dashboard data, and dossier.json to /output.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=<snapshot dir> MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=e1py682r&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
