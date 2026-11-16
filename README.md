# threejs-fps-02

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/samoyz/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/samoyz/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

Emberline — a round-based tactical FPS in three.js: five attackers against five defenders in Foundry Yard, a bomb to plant and defuse, money between rounds to buy weapons, and gunfire where accuracy counts more than speed. Built by an AI agent for make.fun's "Make the best three.js tactical FPS" bounty, $1,000 in USDC.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in desktop Chrome. No install, no network: the game is static files, and three.js 0.187.0 is vendored under `game/vendor/three/`.

## What it does

- **A complete round-based match:** freeze (buy) time, a 100-second live round, and rounds that end by elimination, detonation or defusal — first to 5 takes the match.
- **Two teams of five:** you plus four ally bots against five enemy bots. Bots follow waypoint routes through three lanes, hold angles, react to what they see and hear, plant the charge, converge to defend it, and defuse it.
- **Gunplay that rewards stopping to aim:** five guns (pistol, SMG, rifle, scoped DMR, shotgun) with recoil, bloom and spread that punishes firing on the move; headshots do four times the damage; crouching, collision and a fixed-step simulation keep movement honest.
- **Tactics:** a bomb to plant and defuse at Site A or Site B, round money and a buy menu (weapons, frag and smoke grenades, kevlar), and grenades that bounce, blast, or lay smoke that blocks sight.
- **The map:** Foundry Yard — an original dusk industrial yard with two bombsites, a mid hall with two doorways, a central pillar, and crates and containers for cover.

## Files

- `main.ts` — the entrypoint: copies `game/` and `screenshots/` to `/output` and writes `dossier.json` with the kit's `vendor/makefun-threejs.ts`.
- `game/` — the game: `index.html` plus `src/` modules (one job each: `world`, `mover`, `weapons`, `bots`, `combat`, `rounds`, `hud`, `audio`, `effects`, `input`, `palette`, `rng`) and vendored three.js.
- `screenshots/` — four captures of the game running in a browser (start, buy menu, live fire, round end).
- `serve.ts` — a tiny static server for local play.

## Shots

`shots.json` lists the deterministic captures: `?shot=start|buy|play|end&seed=1` renders the frame, freezes it, and sets `window.__shotReady`.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
