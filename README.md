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
npx playwright install chromium # One-time browser test setup
npm run test:browser # Real Chromium integration tests, including pointer lock
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

Fonts are bundled locally (Barlow and Barlow Condensed, SIL Open Font License via Fontsource). There are no runtime CDN requests. Production builds split rendering and physics into cacheable chunks; the initial download is approximately 1 MB compressed, plus fonts. Serve `dist/` with any static host, using HTTP compression for the best loading time. To host under a subdirectory, build with `npm run build -- --base=/your-path/`.

### Source map

| File | Responsibility |
| --- | --- |
| `src/game.ts` | Fixed-step simulation, input, combat, grenades, scoring, lifecycle |
| `src/actor.ts`, `src/bots.ts` | Operator state and perception-driven bot decisions |
| `src/maps.ts`, `src/navigation.ts` | Arena definitions, grid A*, route smoothing, sightlines |
| `src/physics.ts` | Rapier world, kinematic characters, grenade dynamics |
| `src/view.ts`, `src/models.ts` | Environment, character rigs, weapon models, effects |
| `src/ui.ts`, `src/style.css` | Lobby, HUD, settings, pause, results |
| `src/config.ts`, `src/math.ts` | Balance values and pure gameplay helpers |
| `src/audio.ts` | Procedural positional audio |

Unit tests cover movement, spread, damage, map connectivity, line-of-sight, and collision. Browser tests exercise actual mouse capture, movement, shooting, reloads, utility, bot firefights, round progression, and menus. They use full headless Chromium (`channel: 'chromium'`) because the separate headless-shell build does not support pointer lock on macOS. Development builds expose `window.__OPENCS__` for integration tests; production builds do not.

This is an initial playable prototype, not a recreation of Counter-Strike. Movement, balance, tactical behavior, and audio need real playtesting. Multiplayer, bomb defusal, buying, wall penetration, and advanced movement exploits are out of scope.

### Match rules

Deathmatch ends at 40 team kills or six minutes, with three-second respawns and brief spawn protection that ends when firing. Elimination is first to five round wins, with a 100-second round clock. On timeout, surviving operator count then total remaining health decide the round; exact ties are draws. A 15-round cap prevents endless drawn matches. Friendly fire is disabled, but your own HE grenade can hurt you. HE and flash effects respect solid cover; smoke and flash affect bot perception as well as the player. HE / flash / smoke each replenish on a new life or round. Pause freezes the entire simulation.
