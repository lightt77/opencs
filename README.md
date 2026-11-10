# OPENCS

A solo and local-Wi-Fi multiplayer, CS-inspired browser FPS built with TypeScript, Three.js, and Rapier. Original low-poly characters and map geometry, procedural sound packs, and optional user-supplied audio recordings. Solo needs no server backend; LAN rooms use a small local WebSocket server. No accounts or external AI services.

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

## Local Wi-Fi multiplayer

On **one host computer**, connected to the same LAN/Wi-Fi as the other players:

```sh
npm run lan          # Development: serves the game and LAN rooms; prints Network URLs
# Or, for play without Vite development reloads:
npm run build
npm start            # Serves dist/ and LAN rooms on port 5173; prints Wi-Fi URLs
```

1. Open the host's **Network URL** (for example `http://192.168.1.23:5173`) on every computer. `localhost` works only on the host itself. The room key does not discover computers: everyone must open the same server address first.
2. Host: configure the map/mode/weapons and **Settings → Operators Per Team** (1–10). Enable **Fill LAN Teams With Bots** for mixed human/bot play, or disable it for humans only. With fill on, bots occupy all unused slots at match start; with fill off, only joined humans play. Solo always fills both teams with bots.
3. Choose **Local Wi-Fi → Host / Join Room**, enter a callsign and preferred team, then **Create Room**. Share the six-character key with the other players.
4. Guests enter their callsign, preferred team, and key, then **Join Room**. Team buttons allow changes in the lobby. Human counts may differ by at most one: joins are assigned to the smaller team if necessary; switches that would unbalance/full a team are rejected. Lobby departures also rebalance remaining humans.
5. Host selects **Start LAN Match**. Both teams must have at least one operator. Elimination intermissions wait for the host; everyone can choose their own allowed next-round primary.

The creator's browser is authoritative for movement, hits, inventory, grenades, bots, respawns and scores. Guests send controls—not positions, damage or scores—through the local server. Simulation runs at 60 Hz with 20 Hz state snapshots and smoothed guest rendering. Mouse/sound/display preferences remain local; room gameplay rules are locked at creation. **ESC does not pause a LAN match:** your operator remains vulnerable. Solo pause still freezes the game.

Keep the host browser **open, awake and in the foreground**; background timer throttling can slow the match. This first LAN version has no client prediction/lag compensation, internet matchmaking, host migration, reconnection, or mid-match joining. If a guest leaves, bot-filled matches replace their operator with a bot; human-only matches remove the slot until the room ends (an entirely departed team forfeits). If the host leaves/disconnects, the room closes. Create a new room for another match or different rules.

Allow Node/the app through the host firewall for **private networks**. Wi-Fi guest/client isolation can block device-to-device traffic; use a trusted network without isolation. `PORT=5175 npm start` changes the production port. Do **not** forward the port or use a public tunnel. The room socket rejects public-source IPs and cross-origin browser connections; this is a trusted-LAN prototype, not an internet-hardened dedicated server. Room traffic is unencrypted local HTTP/WebSocket.

### Guest cannot load the page / connection diagnostics

Use **the exact same `http://Wi-Fi-IP:port` URL on the host and guests**, including `http` and the port. Do not use `localhost` on the host for a LAN match: a separate solo server can occupy loopback on the same port on macOS and serve a different set of rooms. Startup warns if it detects this. Stop the old servers, or use a clean port with `npm run lan -- --port 5175` (production: `PORT=5175 npm start`). LAN development uses strict ports instead of silently moving to another port.

1. Open `http://HOST-WIFI-IP:5173/__lan` on the guest. This tiny standalone page needs no game assets or WebGL. It checks HTTP and the room WebSocket and produces a selectable report, including a **server ID** to compare on both machines. Opening a test connection does not join or create a room.
2. If even that page times out, run this **on the guest**; use `curl.exe` instead of `curl` in Windows PowerShell:

   ```sh
   curl -v --noproxy "*" --connect-timeout 5 --max-time 10 http://HOST-WIFI-IP:5173/__lan/health
   ```

   If the guest has this repository and dependencies installed, `npm run lan:check -- http://HOST-WIFI-IP:5173` checks both HTTP and WebSockets without a browser or HTTP proxy. Share the command output. A host-side success alone does **not** prove another device can reach it.
3. Watch the **host terminal** while retrying. It logs incoming TCP connections, page/health requests, and accepted/rejected WebSockets. **No incoming TCP log means the connection did not reach Node**: check the guest's target IP/port, VPN/proxy, host firewall/security software, and router/AP client isolation. Both devices should use a trusted, non-guest LAN. An allowed IP rejected by the app produces an HTTP response, not a silent connection timeout.
4. On macOS, check **System Settings → Privacy & Security → Local Network** for the terminal/app running Node. This permission is separate from the firewall. If the command-line probe passes but the browser fails, check the browser's Local Network/site permissions where available, HTTPS-only mode, proxy settings, and extensions. Do not disable your firewall globally; allow the relevant app only on the trusted LAN.
5. Both checks pass but the game fails? Open browser developer tools and share Console errors and failed Network requests. `OPENCS_LAN_DEBUG=1 npm run lan` (or `OPENCS_LAN_DEBUG=1 npm start`) additionally logs all HTTP request paths/statuses, including failed asset requests. Logs do not include room keys, controls, or gameplay snapshots; reports contain private IPs, so redact them before sharing publicly.

The application cannot bypass Wi-Fi isolation, OS permissions, or a firewall. Diagnostics distinguish those reachability problems from game loading or room errors; they are not an internet relay.

## Scope

- Configurable 1–10 operators per team (default five-on-five): solo bots, LAN players only, or LAN players plus bots.
- Time-based team deathmatch (no kill cap) and round-based elimination, without an economy or bomb objective.
- Dust II: Dust2-inspired routing with Long A/pit, short/catwalk, mid double doors, covered B tunnels, A/B landmarks, and defender-side rotations. This is a compact, single-level layout adaptation using original geometry—not an exact scale/elevation replica. A/B are landmarks, not bomb objectives. Snow and India remain compact original arenas. Longshot Range is a 320 × 420 m open sniper arena with 370 m spawn sightlines and scattered flank cover.
- AK, M4, AWP, pistol, knife, HE, flash, and smoke.
- Ten configurable bot personalities with individual skill, teamwork and bravery, scaled by easy / medium / hard difficulty. Bots use perception, last-known enemy positions, cover retreats, quiet approaches, sprinting rotations, and physical jumps onto reachable low crates.
- Randomized, spaced-out spawns: round starts use opposite rear zones; deathmatch respawns search the map for concealed positions away from enemies and teammates. Open arenas cannot guarantee complete concealment.
- Locally saved preferences; entirely local matches.
- Movement-speed and jump-gravity sliders, optional double jump, three built-in gunshot styles, and locally imported custom gunshots.
- Floating damage numbers for your hits, including grenades; gold headshot numbers. Numbers show actual health removed, capped at the victim's remaining health.
- Elimination intermissions show all operators' cumulative kills/deaths and both teams' win counts. In manual mode choose an allowed primary and explicitly start the next round (host in LAN); auto mode advances rounds without a loadout interruption.
- Configurable weapon restrictions for both teams, up to three carried grenades total, charged throws, and automatic deathmatch ammunition resupply.
- Configurable wall penetration, two-stage AWP optics (no unscoped AWP crosshair), positional footsteps, event-driven team radio, and animated deaths with a killer-camera pan.

### Maps and biomes

Twelve bundled maps are available in solo and LAN. Filter the battlefield browser by biome; each layout has its own cover, routes, spawn pools and minimap. Biomes independently define palette, lighting, environment scenery and snow effects. Scenery outside the perimeter is decorative; playable cover has matching collision. Static geometry is batched by material to keep draw calls low.

| Arena | Biome | Layout |
| --- | --- | --- |
| Dust II | Desert | Existing compact Long / Mid / Tunnels adaptation |
| Snow Outpost | Snow | Compact central depot and outer flanks |
| India Court | Urban | Open courtyard and column sightlines |
| Longshot Range | Forest | Giant open sniper proving ground |
| Dust II Blockout | Desert | Supplied JSON regions, elevated sites, lowered mid/pit and covered tunnels |
| Canopy Ruins | Jungle | Central temple, broken columns and sheltered outer routes |
| Tideline Dockyard | Coastal | Staggered containers, loading yard and long shipping lanes |
| Alpine Relay | Snow | Offset relay houses and exposed crossings |
| Redrock Pass | Canyon | Offset mesas, winding passes and long outer angles |
| Old Quarter | Urban | Asymmetric alleys and interconnected courtyards |
| Ironworks Foundry | Industrial | Machinery lanes, overhead gantries and tight crossings |
| Pinewatch Camp | Forest | Cabins, timber cover and broad woodland flanks |

**Bundled JSON blockout:** `src/maps/dust2-blockout.json` preserves the supplied specification. `src/map-schema.ts` validates it and deterministically compiles region floors, perimeter walls, tunnel ceilings, simple composite props, rotated collision/cover, spawn zones and named areas. X/Z are horizontal; Y is up. Region X/Z are centers and Y is floor elevation. Prop positions are bottom-centers, sizes are full extents, and `rotY` is radians. `unitScale` scales dimensions into metres; the source X/Z bounds are recentered for the engine.

This is an **interpreted blockout, not an exact Dust2 recreation**: missing connections are inferred as 5m-wide L-shaped corridors. Floors are sampled at 0.5m resolution; elevation boundaries are adjusted into reachable 0.2m steps. Ramp/stair cover entries are treated as traversal hints rather than solid lane-blocking boxes. Jump/drop/window connections receive accessible walking alternatives instead of requiring enhanced jump settings. Navigation follows the same heightfield and checks floor continuity; floors block bullets at every elevation. Window frames/scaffolds and vehicles are simplified composite boxes. Tags such as `buyzone` and `bombsite` remain metadata and landmarks, not new objectives. This compiler supports one walkable floor per X/Z cell, **not stacked, overlapping storeys**. There is no runtime JSON upload or LAN map transfer: new definitions are bundled into the build.

### Timed matches and uninterrupted auto play

- **Settings → Round Timing → Deathmatch Duration:** 30 seconds–60 minutes, default six minutes. Only the playing clock determines a normal deathmatch finish; scores can exceed 40. Most team kills at timeout wins; ties draw. Start freezes and end buffers are separate from playing time.
- **Elimination Round Duration:** 15–600 seconds, default 100. Existing elimination and match-win rules remain unchanged.
- Enable **Auto Map Rotation** in Mission Setup or Settings. After a match, results and the scoreboard remain visible for the **Scoreboard / Map Switch Delay** (3–30 seconds, default eight), then a random **different** bundled map starts automatically with the same mode, rules, teams, operators and current loadouts. Elimination also advances intermediate rounds automatically, retaining the selected primary.
- Each new map resets its **match** score, clock, round, lives and ammunition. The scoreboard separately accumulates **session team totals** (kills in deathmatch, round wins in elimination) and each operator's kills/deaths across maps. Session totals are in memory and reset when starting a fresh session; leaving is not a persistent career record.
- Mouse capture is retained during auto results for seamless continuation. **Esc** releases the mouse so you can stop rotation or leave. If capture was released, the next map shows Resume rather than attempting pointer lock without a gesture; solo waits for that click. LAN simulation continues while anyone's mouse is released.
- LAN rotation is host-authoritative: snapshots carry the map, next-map countdown and session scores. Guests do not choose maps or advance timers. The room stays intact, departed slots remain bots/inactive according to bot-fill rules, and a human-only team forfeit stops rotation. Host departure still closes the room. No mid-session joining, reconnection or host migration is added.
- Auto mode defaults **off**. The old explicit rematch and elimination loadout flow remains available. In auto results the host/solo player can choose **Stop Auto Rotation**; any player can leave normally.

Pre-feature checkpoint: annotated Git tag **`v0.2.1`** points to the LAN-diagnostics baseline (`22f18bb`), before the map/rotation changes. It does not move the older release tags.

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
| Change deathmatch primary (AK / M4 / AWP) | B, or Esc → Deathmatch Primary |
| Previous weapon / faster AWP cycle | Q / Q Q after firing |
| Scoreboard | Hold Tab |
| Pause / release mouse | Esc |

Weapon slots compress when restrictions remove equipment: use the HUD's numbered slots or mouse wheel rather than assuming the default keys above.

In deathmatch, **B** opens the pause/loadout menu. Select an allowed AK, M4 or AWP, then click **Back in the Fight**. The new primary equips immediately while alive, or at your next respawn if dead, and persists through respawns/auto map rotation. This works for hosts and guests in LAN; the host validates changes, and the match stays live while the menu is open. Switching back preserves that gun's ammo and fire cooldown; it does not heal you or refill sidearms/grenades. Normal timed resupply still applies. Elimination keeps its between-round loadout rules.

### Movement and sound preferences

Open **Settings** from the lobby or pause menu. Preferences persist locally. Solo gameplay changes apply immediately or at the indicated next deployment/round; LAN gameplay settings are locked to the room, while local mouse/audio/display options remain editable.

- **Movement speed:** 0.5–2.0×, applied to the player and both bot teams.
- **Double jump:** off by default. When enabled, press Space again in the air for one extra jump; landing replenishes it. Walking off an edge allows one air jump, not two.
- **Jump gravity:** 10–35 m/s² (default 20). Lower values mean higher, floatier jumps. Grenade gravity is unchanged.
- **Air steering:** WASD can brake and reverse a jump's horizontal direction before landing (including left → right). Steering accelerates smoothly toward weapon/movement-scaled speed without a diagonal boost; releasing movement preserves horizontal momentum. Jump impulse/gravity and airborne shot inaccuracy are unchanged.
- **Start freeze:** 0–10 seconds (default 3), before combat begins at match/round start. **Round-end buffer:** 0–6 seconds (default 2.5), before the loadout or final-results screen. Timing preferences persist; updated durations apply at the next corresponding phase. Round loadout shows cumulative rounds and kills for both teams.
- **Gunshot packs:** Classic (dry/metallic), Punchy (sharp attack and bass tail), Suppressed (soft/filtered), **Asset Recordings** (supplied AK/M4/AWP/USP WAVs), and Custom / Your Files. The original procedural packs and browser imports remain available. Use **Preview gunshot** to compare your selected primary. Packs affect both teams; suppressed audio is cosmetic and does not change bot hearing or weapon balance.
- **Movement & effect sounds:** choose Asset Recordings or Classic Synthesized independently of gunshots. Asset mode maps `footsteps`, `jump1`, `zoom`, `generic_reload`, `hegrenade-2`, and `flashbang` to their matching events. The footstep sample uses a short faded segment to preserve distance-driven cadence; synthetic snow variation remains available in Classic. Missing or undecodable recordings fall back to synthesized effects.
- **Radio chatter & death voices / Voice volume:** independently enable/mute and adjust supplied voice clips. Team radio has named subtitles, randomized variants, per-event cooldowns, and no overlapping callouts. Death cries are positional for both teams. Existing saved sound-pack choices are preserved; select **Asset Recordings** to use the supplied gunshots.

**AWP quick-switch:** Q swaps to the last equipped weapon (USP initially). Tap Q twice after a shot to switch away and back, reducing bolt recovery from 1.35 s to a minimum 0.7 s. Each quick draw takes 0.12 s. This does not replenish ammunition or bypass an empty magazine, and switching cancels an unfinished reload. Other weapons keep independent firing cooldowns.

**AWP firing animation:** a stronger rearward stock kick and muzzle rise settle over ~0.24 s, followed by a visible bolt-handle lift, rearward pull, and return by ~0.72 s. This is cosmetic and does not change damage, recoil accuracy, ammunition, or quick-switch timing. The same bolt/recoil motion is visible on bot rifles.

**Sprint / crouch / footsteps:** Shift + forward moves at 1.5× weapon speed, lowers accuracy through movement, and cancels scope. Firing stops sprinting; the remaining momentum still hurts accuracy. Hold Ctrl or C for a lower eye/hitbox, 48% speed, and quieter steps. You cannot stand into a low ceiling. Footsteps follow actual grounded distance, not held movement keys: blocked movement and airborne motion make no steps. Snow has a crunchier sound. Bots hear walking within 13 m, sprinting within 23 m, and crouching within 3 m.

**AWP zoom:** right-click cycles the existing 24° view (12° on Longshot), a second level with exactly double the optical magnification (~12.13° / ~6.02°), then unscoped. A scoped shot temporarily unscopes for the bolt animation, then returns to the same zoom level after ~0.72 s in solo and LAN. Unscoped shots stay unscoped. Reloading, switching weapons, sprinting, dying, or manually changing zoom cancels the automatic return. Second-stage mouse sensitivity is reduced accordingly.

**Wall shots:** Settings → Match Weapon Rules → Bullet Wall Penetration defaults to **All Walls**, allowing firearm shots through ordinary walls/buildings with reduced damage. Actual 3D thickness, material, weapon, angle, and additional layers reduce damage, down to a 2.5% minimum multiplier. AWP penetrates best; USP loses more damage. **Thin Cover Only** retains the original cumulative thickness budget/two-layer cap; **Off** blocks every wall hit. Floors always stop bullets; knife never penetrates. No multi-player piercing. Bots do not gain vision through walls or deliberately target unseen opponents.

**Deaths:** operators fall onto their backs; lethal headshots add a short airborne, backward impulse (~0.85 m / 2.8 ft when unobstructed). Lethal HE blasts launch bodies upward (~1.6 m) and outward from the explosion, not the thrower; horizontal travel is up to ~5.85 m. Wall clearance limits knockback. Your view falls for ~0.8 s, then pans toward and zooms onto the killer over 1.5 s, before ordinary teammate spectating / deathmatch respawn. This is a procedural animation, not a full physics ragdoll. Shortening the round-end buffer can cut the cinematic short. Bots climb reachable crates up to 1.35 m, not arbitrary buildings or roofs.

**Longshot Range:** choose an AWP for sightlines exceeding 370 m. Spawns are now randomized and prefer concealment, so the opening is not always a face-to-face sniper duel. Bots use sniper rifles, respect cover, and can perceive visible targets across the map. The AWP has a 700 m hitscan range, gentler damage falloff, and a stronger 12° first-stage scope on Longshot; rifle and pistol ranges are unchanged. The larger arena has appropriately extended rendering/fog distances and a coarser navigation grid to keep pathfinding lightweight.

### Bot personalities

Open **Bot Profiles** beside lobby difficulty, or **Settings → Bot Personalities** (also available while paused or between rounds). Enable the profiles you want in the random pool, and edit each profile's Skill, Co-op, and Bravery independently. At least one profile must remain enabled. **Reset Bot Profiles** restores all ten profiles and their original traits without changing other settings.

| Profile | Skill | Co-op | Bravery |
| --- | --- | --- | --- |
| Vanguard | High | High | High |
| Sentinel | High | High | Low |
| Hunter | High | Low | High |
| Shade | High | Low | Low |
| Wingman | Mid | High | High |
| Anchor | Mid | High | Low |
| Raider | Mid | Low | High |
| Lurker | Mid | Low | Low |
| Rookie | Low | High | Low |
| Hothead | Low | Low | High |

- **Skill:** low/mid/high controls aim error, reaction delay, tracking speed, burst length and headshot preference. Overall lobby difficulty scales reaction/aim/tracking for every profile; it does not replace their individual skills.
- **Co-op:** high bots share real sightings, act on fresh team intel, and regroup with an ally when they have no recent contact of their own. Low bots neither publish nor follow shared sightings and roam independently. Both still avoid collisions, hear nearby sounds, and obey visibility rules; no wall vision is added.
- **Bravery:** low bots avoid sprinting except when escaping danger, crouch near a recently known threat, seek cover earlier, and favor held/flanking angles. High bots sprint rotations, push forward between firing bursts, and retreat at lower health. Snipers retain planted long-range firing behavior.

Both teams draw from the same shuffled pool at match start and every elimination round. No profile repeats until the enabled pool is exhausted (nine bots draw nine different profiles with the full pool). Deathmatch respawns retain their current personality. Pool/trait edits are saved immediately but apply only at the next match or round, not halfway through a life. Names and cumulative scores remain tied to operators, not profiles. Scoreboards show the assigned profile beside each bot; its tooltip lists all three traits.

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
| `src/biomes.ts`, `src/map-schema.ts`, `src/maps/dust2-blockout.json` | Reusable biomes, validated JSON compilation, original blockout source and floor heightfield |
| `src/rotation.ts` | Random map selection without immediate repeats |
| `src/physics.ts` | Rapier world, kinematic characters, grenade dynamics |
| `src/view.ts`, `src/models.ts` | Environment, character rigs, weapon models, effects |
| `src/ui.ts`, `src/style.css` | Lobby, HUD, settings, pause, results |
| `src/config.ts`, `src/math.ts` | Balance values and pure gameplay helpers |
| `src/ballistics.ts`, `src/spawns.ts` | 3D cover thickness / penetration and randomized safe spawning |
| `src/movement.ts`, `src/animation.ts` | Stance speeds, optics, jump rules, and two-bone leg animation |
| `src/audio.ts`, `src/audio-assets.ts`, `src/radio.ts` | Procedural/recorded positional audio, scenario manifest, and radio scheduling |
| `src/grenades.ts` | Configurable charged throws, weight/bounce tuning, throw pose and blast flight |
| `src/lan.ts`, `src/lan-protocol.ts` | LAN client, control validation, team balance and roster planning |
| `server/rooms.ts`, `server/index.ts` | Local room relay, room keys, access checks and production static server |
| `src/custom-audio.ts` | Custom-file validation and browser-only sample persistence |

Unit tests cover movement, spread, damage, map connectivity, line-of-sight, and collision. Browser tests exercise actual mouse capture, movement, shooting, reloads, utility, bot firefights, round progression, and menus. They use full headless Chromium (`channel: 'chromium'`) because the separate headless-shell build does not support pointer lock on macOS. Development builds expose `window.__OPENCS__` for integration tests; production builds do not.

This is an initial playable prototype, not a recreation of Counter-Strike. Movement, balance, tactical behavior, audio and real-device Wi-Fi latency need playtesting. Internet multiplayer, bomb defusal, buying, full ragdoll physics, arbitrary-surface climbing, and advanced movement exploits are out of scope.

### Match rules

Deathmatch ends at 40 team kills or six minutes, with three-second respawns and brief spawn protection that ends when firing. Elimination is first to five round wins, with a 100-second round clock. On timeout, surviving operator count then total remaining health decide the round; exact ties are draws. A 15-round cap prevents endless drawn matches. Friendly fire is disabled, but your own HE grenade can hurt you. HE and flash effects respect solid cover; smoke and flash affect bot perception as well as the player. Pause freezes solo matches only.

**Weapon restrictions:** open **Weapon Rules** in Mission Setup, **Match Weapon Rules** in Settings, or **Change Next Round Weapon Rules** during elimination intermission. Toggle individual weapons or use All / AWP Only / AWP + AK / USP Only / Knife Only / Grenades Only presets. Both teams receive one selected allowed primary (if any), plus only allowed sidearm/knife/utility; restricted weapons cannot be equipped or restored on respawn. At least one weapon must remain selected. Loadout changes take effect on deployment, respawn, or the next round reset—not halfway through a life.

**Grenade capacity:** 1–3 total carried grenades, default 3, distributed in HE → flash → smoke order across allowed types. All types enabled gives one each; HE only gives three HE; HE + smoke gives two HE and one smoke. A throw has a shared one-second grenade cooldown. Holding LMB prepares the grenade without spending ammo or starting its fuse; charging up to 1.5 s increases launch speed from ~36% to 100% of the configured cap and reduces spread to zero. **Max Throw Speed** is 12–65 m/s, default **34 m/s** (formerly 22). Throws inherit 45% of horizontal/jumping momentum and show a wind-up/follow-through with a spinning grenade model. **Grenade Weight** has Light/Normal/Heavy drop-and-drag presets; **Bouncy Grenades** toggles lively rebounds versus deadened impacts. All teams use these settings. Releasing launches it and starts its fuse. Switching weapons, opening the pause menu, dying, or changing rounds safely cancels preparation. Empty utility switches back to an available allowed weapon when possible.

**Infinite deathmatch supplies:** the first shot/throw starts a per-weapon refill timer (default 10 s, configurable 1–30 s). Further use does not postpone it. At expiry, that gun's magazine/reserves or grenade type's assigned count refills; health and firing/throw cooldowns do not reset. A HUD countdown shows the currently equipped weapon's refill. Both bot teams receive the same supplies. Elimination replenishes only on new rounds/lives; grenade-only rounds can run out, and flash/smoke-only restrictions cannot cause kills.
