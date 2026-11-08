# OPENCS

A single-player, CS-inspired browser FPS built with TypeScript, Three.js, and Rapier. Original low-poly characters and map geometry; no proprietary game assets, backend, accounts, or external AI services.

## Run

```sh
npm install
npm run dev
```

Open the local URL in a desktop browser with WebGL2. Click **Deploy** to capture the mouse. Audio starts after a user gesture. Use headphones for positional cues.

```sh
npm run build       # Type-check and build to dist/
npm test            # Gameplay unit tests
npm run test:browser # Browser smoke tests (requires Playwright Chromium)
```

## Scope

- Five-on-five: you and four allied bots versus five enemy bots.
- Team deathmatch and round-based elimination, without an economy or bomb objective.
- Dust, Snow, and India: compact, original maps inspired by classic arena themes, not replicas.
- AK, M4, AWP, pistol, knife, HE, flash, and smoke.
- Easy / medium / hard bots with perception, navigation, cover, and shared last-known enemy positions.
- Locally saved preferences; entirely local matches.

## Controls

| Action | Input |
| --- | --- |
| Move / jump / crouch | WASD / Space / Ctrl or C |
| Fire / scope | Left mouse / right mouse |
| Reload | R |
| Primary / pistol / knife | 1 / 2 / 3 |
| HE / flash / smoke | 4 / 5 / 6 |
| Cycle weapons | Mouse wheel |
| Scoreboard | Hold Tab |
| Pause / release mouse | Esc |

## Development

Gameplay runs at a fixed 60 Hz, independently of rendering. Map data, weapon tuning, and pure navigation/combat helpers are separate from the renderer. Geometry, character rigs, weapon models, textures, and audio are generated locally. Procedural audio is intentionally a lightweight starting point rather than recorded firearm audio.

This is an initial playable prototype, not a recreation of Counter-Strike. Movement, balance, tactical behavior, and audio need real playtesting. Multiplayer, bomb defusal, buying, wall penetration, and advanced movement exploits are out of scope.
