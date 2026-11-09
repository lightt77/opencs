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
- Dust II: Dust2-inspired routing with Long A/pit, short/catwalk, mid double doors, covered B tunnels, A/B landmarks, and defender-side rotations. This is a compact, single-level layout adaptation using original geometry—not an exact scale/elevation replica. A/B are landmarks, not bomb objectives. Snow and India remain compact original arenas. Longshot Range is a 320 × 420 m open sniper arena with 370 m spawn sightlines and scattered flank cover.
- AK, M4, AWP, pistol, knife, HE, flash, and smoke.
- Easy / medium / hard bots with perception, navigation, cover, and shared last-known enemy positions.
- Locally saved preferences; entirely local matches.
- Movement-speed and jump-gravity sliders, optional double jump, three built-in gunshot styles, and locally imported custom gunshots.
- Floating damage numbers for your hits, including grenades; gold headshot numbers. Numbers show actual health removed, capped at the victim's remaining health.
- Elimination intermissions wait for you to choose an AK, M4, or AWP and start the next round. Scores persist; ammunition and utility replenish.

## Controls

| Action | Input |
| --- | --- |
| Move / jump / crouch | WASD / Space / Ctrl or C |
| Fire / scope | Left mouse / right mouse |
| Reload | R |
| Primary / pistol / knife | 1 / 2 / 3 |
| HE / flash / smoke | 4 / 5 / 6 |
| Cycle weapons | Mouse wheel |
| Previous weapon / faster AWP cycle | Q / Q Q after firing |
| Scoreboard | Hold Tab |
| Pause / release mouse | Esc |

### Movement and sound preferences

Open **Settings** from the lobby or pause menu. Changes apply immediately and persist locally.

- **Movement speed:** 0.5–2.0×, applied to the player and both bot teams.
- **Double jump:** off by default. When enabled, press Space again in the air for one extra jump; landing replenishes it. Walking off an edge allows one air jump, not two.
- **Jump gravity:** 10–35 m/s² (default 20). Lower values mean higher, floatier jumps. Grenade gravity is unchanged.
- **Gunshot packs:** Classic (dry/metallic), Punchy (sharp attack and bass tail), and Suppressed (soft/filtered). Use **Preview gunshot** to compare your selected primary weapon. Packs affect both teams and are original procedural sounds, not sampled CS audio. The suppressed pack is cosmetic: bot hearing and weapon balance do not change.

**AWP quick-switch:** Q swaps to the last equipped weapon (USP initially). Tap Q twice after a shot to switch away and back, reducing bolt recovery from 1.35 s to a minimum 0.7 s. Each quick draw takes 0.12 s. This does not replenish ammunition or bypass an empty magazine, and switching cancels an unfinished reload. Other weapons keep independent firing cooldowns.

**Longshot Range:** choose an AWP for the 370 m opening sightline. Bots use sniper rifles, respect cover, and can perceive visible targets across the map. The AWP has a 700 m hitscan range, gentler damage falloff, and a stronger 12° scope on Longshot; rifle and pistol ranges are unchanged. The larger arena has appropriately extended rendering/fog distances and a coarser navigation grid to keep pathfinding lightweight.

### Import your own sound pack

1. Open **Settings → Import / Manage Custom Sounds**.
2. For AK, M4, AWP, or USP, click **Choose File** and select that weapon's gunshot. File names do not matter.
3. Use **▶** to preview. Importing automatically selects **Custom / Your Files**. You can switch back to a built-in style at any time.

Use individual **WAV, MP3, or OGG** files, **at most 2 MB and 5 seconds each**, mono or stereo. Standard PCM WAV at 44.1/48 kHz is the safest choice across browsers. Trim leading silence for immediate firing feedback. Unsupported or corrupt files are rejected without replacing your current sample. Missing weapon samples fall back to Classic. Only firing sounds are customizable for now; reloads, footsteps, and grenades keep their existing audio.

Files are decoded locally and stored in **IndexedDB on this browser/origin**; they are never uploaded. Reopening the same local URL restores them. Changing browser, port, or hostname uses different storage; clearing site data removes them. If storage is blocked or full, the importer explicitly reports that the sound works **for this session only**. Use **×** beside a weapon to remove its sample. **Restore Defaults** switches the selected sound style back to Classic but does not delete imported files.

ZIP packs and game-specific archives are not imported directly: extract their audio first, then assign each gunshot through the file pickers. Use recordings you own or have permission to use.

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
| `src/movement.ts`, `src/animation.ts` | Jump rules and distance-driven two-bone leg animation |
| `src/audio.ts` | Procedural positional audio |
| `src/custom-audio.ts` | Custom-file validation and browser-only sample persistence |

Unit tests cover movement, spread, damage, map connectivity, line-of-sight, and collision. Browser tests exercise actual mouse capture, movement, shooting, reloads, utility, bot firefights, round progression, and menus. They use full headless Chromium (`channel: 'chromium'`) because the separate headless-shell build does not support pointer lock on macOS. Development builds expose `window.__OPENCS__` for integration tests; production builds do not.

This is an initial playable prototype, not a recreation of Counter-Strike. Movement, balance, tactical behavior, and audio need real playtesting. Multiplayer, bomb defusal, buying, wall penetration, and advanced movement exploits are out of scope.

### Match rules

Deathmatch ends at 40 team kills or six minutes, with three-second respawns and brief spawn protection that ends when firing. Elimination is first to five round wins, with a 100-second round clock. On timeout, surviving operator count then total remaining health decide the round; exact ties are draws. A 15-round cap prevents endless drawn matches. Friendly fire is disabled, but your own HE grenade can hurt you. HE and flash effects respect solid cover; smoke and flash affect bot perception as well as the player. HE / flash / smoke each replenish on a new life or round. Pause freezes the entire simulation.
