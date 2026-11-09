# OPENCS

A single-player, CS-inspired browser FPS built with TypeScript, Three.js, and Rapier. Original low-poly characters and map geometry, procedural sound packs, and optional user-supplied audio recordings. No backend, accounts, or external AI services.

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
- Easy / medium / hard bots with perception, shared last-known enemy positions, cover retreats, quiet crouched approaches, sprinting rotations, and physical jumps onto reachable low crates.
- Randomized, spaced-out spawns: round starts use opposite rear zones; deathmatch respawns search the map for concealed positions away from enemies and teammates. Open arenas cannot guarantee complete concealment.
- Locally saved preferences; entirely local matches.
- Movement-speed and jump-gravity sliders, optional double jump, three built-in gunshot styles, and locally imported custom gunshots.
- Floating damage numbers for your hits, including grenades; gold headshot numbers. Numbers show actual health removed, capped at the victim's remaining health.
- Elimination intermissions show all ten players' cumulative kills/deaths and both teams' win counts. Choose an allowed primary and explicitly start the next round; scores persist.
- Configurable weapon restrictions for both teams, up to three carried grenades total, charged throws, and automatic deathmatch ammunition resupply.
- Configurable wall penetration, two-stage AWP optics (no unscoped AWP crosshair), positional footsteps, event-driven team radio, and animated deaths with a killer-camera pan.

## Controls

| Action | Input |
| --- | --- |
| Move / jump / crouch | WASD / Space / Ctrl or C |
| Sprint | Hold Shift while moving forward |
| Fire / cycle AWP zoom | Left mouse / right mouse: normal zoom → 2× zoom → off |
| Throw grenade | Hold left mouse to prepare/charge; release to throw |
| Reload | R |
| Primary / pistol / knife | 1 / 2 / 3 |
| HE / flash / smoke | 4 / 5 / 6 |
| Cycle weapons | Mouse wheel |
| Previous weapon / faster AWP cycle | Q / Q Q after firing |
| Scoreboard | Hold Tab |
| Pause / release mouse | Esc |

Weapon slots compress when restrictions remove equipment: use the HUD's numbered slots or mouse wheel rather than assuming the default keys above.

### Movement and sound preferences

Open **Settings** from the lobby or pause menu. Changes apply immediately and persist locally.

- **Movement speed:** 0.5–2.0×, applied to the player and both bot teams.
- **Double jump:** off by default. When enabled, press Space again in the air for one extra jump; landing replenishes it. Walking off an edge allows one air jump, not two.
- **Jump gravity:** 10–35 m/s² (default 20). Lower values mean higher, floatier jumps. Grenade gravity is unchanged.
- **Start freeze:** 0–10 seconds (default 3), before combat begins at match/round start. **Round-end buffer:** 0–6 seconds (default 2.5), before the loadout or final-results screen. Timing preferences persist; updated durations apply at the next corresponding phase. Round loadout shows cumulative rounds and kills for both teams.
- **Gunshot packs:** Classic (dry/metallic), Punchy (sharp attack and bass tail), Suppressed (soft/filtered), **Asset Recordings** (supplied AK/M4/AWP/USP WAVs), and Custom / Your Files. The original procedural packs and browser imports remain available. Use **Preview gunshot** to compare your selected primary. Packs affect both teams; suppressed audio is cosmetic and does not change bot hearing or weapon balance.
- **Movement & effect sounds:** choose Asset Recordings or Classic Synthesized independently of gunshots. Asset mode maps `footsteps`, `jump1`, `zoom`, `generic_reload`, `hegrenade-2`, and `flashbang` to their matching events. The footstep sample uses a short faded segment to preserve distance-driven cadence; synthetic snow variation remains available in Classic. Missing or undecodable recordings fall back to synthesized effects.
- **Radio chatter & death voices / Voice volume:** independently enable/mute and adjust supplied voice clips. Team radio has named subtitles, randomized variants, per-event cooldowns, and no overlapping callouts. Death cries are positional for both teams. Existing saved sound-pack choices are preserved; select **Asset Recordings** to use the supplied gunshots.

**AWP quick-switch:** Q swaps to the last equipped weapon (USP initially). Tap Q twice after a shot to switch away and back, reducing bolt recovery from 1.35 s to a minimum 0.7 s. Each quick draw takes 0.12 s. This does not replenish ammunition or bypass an empty magazine, and switching cancels an unfinished reload. Other weapons keep independent firing cooldowns.

**Sprint / crouch / footsteps:** Shift + forward moves at 1.5× weapon speed, lowers accuracy through movement, and cancels scope. Firing stops sprinting; the remaining momentum still hurts accuracy. Hold Ctrl or C for a lower eye/hitbox, 48% speed, and quieter steps. You cannot stand into a low ceiling. Footsteps follow actual grounded distance, not held movement keys: blocked movement and airborne motion make no steps. Snow has a crunchier sound. Bots hear walking within 13 m, sprinting within 23 m, and crouching within 3 m.

**AWP zoom:** right-click cycles the existing 24° view (12° on Longshot), a second level with exactly double the optical magnification (~12.13° / ~6.02°), then unscoped. Shooting, reloading, switching weapons, sprinting, and dying clear zoom. Second-stage mouse sensitivity is reduced accordingly.

**Wall shots:** Settings → Match Weapon Rules → Bullet Wall Penetration defaults to **All Walls**, allowing firearm shots through ordinary walls/buildings with reduced damage. Actual 3D thickness, material, weapon, angle, and additional layers reduce damage, down to a 2.5% minimum multiplier. AWP penetrates best; USP loses more damage. **Thin Cover Only** retains the original cumulative thickness budget/two-layer cap; **Off** blocks every wall hit. Floors always stop bullets; knife never penetrates. No multi-player piercing. Bots do not gain vision through walls or deliberately target unseen opponents.

**Deaths:** operators fall onto their backs; lethal headshots add a short airborne, backward impulse (~0.85 m / 2.8 ft when unobstructed). Wall clearance limits knockback. Your view falls for ~0.8 s, then pans toward and zooms onto the killer over 1.5 s, before ordinary teammate spectating / deathmatch respawn. This is a procedural animation, not a full physics ragdoll. Shortening the round-end buffer can cut the cinematic short. Bots climb reachable crates up to 1.35 m, not arbitrary buildings or roofs.

**Longshot Range:** choose an AWP for sightlines exceeding 370 m. Spawns are now randomized and prefer concealment, so the opening is not always a face-to-face sniper duel. Bots use sniper rifles, respect cover, and can perceive visible targets across the map. The AWP has a 700 m hitscan range, gentler damage falloff, and a stronger 12° first-stage scope on Longshot; rifle and pistol ranges are unchanged. The larger arena has appropriately extended rendering/fog distances and a coarser navigation grid to keep pathfinding lightweight.

### Import your own sound pack

1. Open **Settings → Import / Manage Custom Sounds**.
2. For AK, M4, AWP, or USP, click **Choose File** and select that weapon's gunshot. File names do not matter.
3. Use **▶** to preview. Importing automatically selects **Custom / Your Files**. You can switch back to a built-in style at any time.

Use individual **WAV, MP3, or OGG** files, **at most 2 MB and 5 seconds each**, mono or stereo. Standard PCM WAV at 44.1/48 kHz is the safest choice across browsers. Trim leading silence for immediate firing feedback. Unsupported or corrupt files are rejected without replacing your current sample. Missing weapon samples fall back to Classic. The browser importer customizes gunshots only; movement/effect recordings and radio voices come from the project's assets folder.

Files are decoded locally and stored in **IndexedDB on this browser/origin**; they are never uploaded. Reopening the same local URL restores them. Changing browser, port, or hostname uses different storage; clearing site data removes them. If storage is blocked or full, the importer explicitly reports that the sound works **for this session only**. Use **×** beside a weapon to remove its sample. **Restore Defaults** switches the selected sound style back to Classic but does not delete imported files.

ZIP packs and game-specific archives are not imported directly: extract their audio first, then assign each gunshot through the file pickers. Use recordings you own or have permission to use.

### Supplied radio scenarios

`src/audio-assets.ts` maps scenarios to existing files without renaming or deleting any supplied audio. Filename variants such as `nice_shot2`, `theyre_everywhere2`, and `theyre_all_over_the_place2` are handled explicitly.

| Event | Behavior |
| --- | --- |
| Big victory | A random celebration when at least three allies survive elimination, or a deathmatch win leads by at least ten kills |
| Close victory | One of the two “last guy/last one” clips for narrower wins |
| Teammate headshot | “Nice shot”/“Nice” from a living teammate who can see the hit, including nonlethal headshots |
| Overwhelmed | A bot sees more enemies than nearby allies; cooldown prevents repeated panic |
| One/two enemies left | Elimination only; based on deaths witnessed by allied bots plus a current enemy sighting, not omniscient alive counts |
| Friendly-fire hit | A bot complains without losing health; friendly fire stays off |
| Death | Random positional `pain2/4/5/8/9/10` cry, with a short global spam limit |

Victories can interrupt lower-priority radio; old callouts are not queued. Unused supplied clips remain in `assets/sounds` for future scenarios. **Audio provenance/licensing has not been verified:** these recordings were supplied locally, not created for OPENCS. Confirm permission before publishing or redistributing them.

## Development

Gameplay runs at a fixed 60 Hz, independently of rendering. Map data, weapon tuning, and pure navigation/combat helpers are separate from the renderer. Geometry, character rigs, weapon models, textures, and procedural audio are generated locally. Supplied WAV files are bundled by Vite and decoded/cached through Web Audio after a user gesture; no external audio service is required.

Fonts are bundled locally (Barlow and Barlow Condensed, SIL Open Font License via Fontsource). There are no runtime CDN requests. Production builds split rendering and physics into cacheable chunks; code is approximately 1 MB compressed, plus fonts and supplied audio. Serve `dist/` with any static host, using HTTP compression for the best loading time. To host under a subdirectory, build with `npm run build -- --base=/your-path/`.

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
| `src/ballistics.ts`, `src/spawns.ts` | 3D cover thickness / penetration and randomized safe spawning |
| `src/movement.ts`, `src/animation.ts` | Stance speeds, optics, jump rules, and two-bone leg animation |
| `src/audio.ts`, `src/audio-assets.ts`, `src/radio.ts` | Procedural/recorded positional audio, scenario manifest, and radio scheduling |
| `src/grenades.ts` | Capped throw power and accuracy from charge duration |
| `src/custom-audio.ts` | Custom-file validation and browser-only sample persistence |

Unit tests cover movement, spread, damage, map connectivity, line-of-sight, and collision. Browser tests exercise actual mouse capture, movement, shooting, reloads, utility, bot firefights, round progression, and menus. They use full headless Chromium (`channel: 'chromium'`) because the separate headless-shell build does not support pointer lock on macOS. Development builds expose `window.__OPENCS__` for integration tests; production builds do not.

This is an initial playable prototype, not a recreation of Counter-Strike. Movement, balance, tactical behavior, and audio need real playtesting. Multiplayer, bomb defusal, buying, full ragdoll physics, arbitrary-surface climbing, and advanced movement exploits are out of scope.

### Match rules

Deathmatch ends at 40 team kills or six minutes, with three-second respawns and brief spawn protection that ends when firing. Elimination is first to five round wins, with a 100-second round clock. On timeout, surviving operator count then total remaining health decide the round; exact ties are draws. A 15-round cap prevents endless drawn matches. Friendly fire is disabled, but your own HE grenade can hurt you. HE and flash effects respect solid cover; smoke and flash affect bot perception as well as the player. Pause freezes the entire simulation.

**Weapon restrictions:** open **Weapon Rules** in Mission Setup, **Match Weapon Rules** in Settings, or **Change Next Round Weapon Rules** during elimination intermission. Toggle individual weapons or use All / AWP Only / AWP + AK / USP Only / Knife Only / Grenades Only presets. Both teams receive one selected allowed primary (if any), plus only allowed sidearm/knife/utility; restricted weapons cannot be equipped or restored on respawn. At least one weapon must remain selected. Loadout changes take effect on deployment, respawn, or the next round reset—not halfway through a life.

**Grenade capacity:** 1–3 total carried grenades, default 3, distributed in HE → flash → smoke order across allowed types. All types enabled gives one each; HE only gives three HE; HE + smoke gives two HE and one smoke. A throw has a shared one-second grenade cooldown. Holding LMB prepares the grenade without spending ammo or starting its fuse; charging up to 1.5 s increases launch speed from 8 to 22 m/s and reduces throw spread to zero. Releasing launches it and starts its fuse. Switching weapons, pausing, dying, or changing rounds safely cancels preparation. Empty utility switches back to an available allowed weapon when possible.

**Infinite deathmatch supplies:** the first shot/throw starts a per-weapon refill timer (default 10 s, configurable 1–30 s). Further use does not postpone it. At expiry, that gun's magazine/reserves or grenade type's assigned count refills; health and firing/throw cooldowns do not reset. A HUD countdown shows the currently equipped weapon's refill. Both bot teams receive the same supplies. Elimination replenishes only on new rounds/lives; grenade-only rounds can run out, and flash/smoke-only restrictions cannot cause kills.
