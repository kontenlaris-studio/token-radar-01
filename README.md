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

---

## Try it live on SkillSafe

This project is published as a security-scanned skill with a hosted app on SkillSafe — use it right in your browser:

- **App:** [Pre-Token Screener](https://pre-token-screener.skillsafe.ai)
- **Skill (installable):** https://skillsafe.ai/share/shr_8qwjpv5flz94

## License this engine

The **Token Radar Model** is available under a perpetual commercial license (Indie $149 / Commercial $449 / Studio $1,199) for use in your own products: [catalog & terms](https://kontenlaris-studio.github.io/engine-licensing/) · order via kontenlaris.studio@gmail.com.
