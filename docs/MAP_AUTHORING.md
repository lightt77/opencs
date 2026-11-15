# Authoring custom maps (for humans and coding agents)

A map is **one JSON file** in `src/maps/custom/`. Every file there is discovered automatically,
compiled at startup, and listed in the map picker as `custom_<filename>`. No code changes are needed.
A broken file is skipped with a console error. It never breaks the game.

**Agent workflow:** write the JSON → `npm run map:check -- src/maps/custom/<name>.json` → read the
errors, warnings and ASCII preview → fix → repeat until it prints `OK  map is playable`.
Add `--svg <path>` for a coloured top-down image. A working example is in
[`src/maps/custom/market_district.json`](../src/maps/custom/market_district.json).

## Coordinate system
- `x` = east/west, `z` = north/south (`-z` is drawn at the **top** of previews), `y` = up. Units are metres times `unitScale` (keep it at `1.0`).
- `bounds.min` / `bounds.max` are `[x, y, z]`. Every axis may span at most 512 m. The world is centred on the bounds' centre.
- All positions are **absolute map coordinates**, including cover `pos`. They are not relative to the region.

## Top-level fields
| field | required | notes |
|---|---|---|
| `mapName` | yes | internal name, for example `de_market_district` |
| `displayName` | no | shown in the picker (upper-cased) |
| `biome` | no | `desert` (default), `snow`, `jungle`, `coast`, `canyon`, `urban`, `industrial`, `forest`. Sets sky, fog and colours |
| `subtitle`, `description` | no | picker text, at most 240 characters |
| `unitScale`, `bounds`, `regions`, `connections` | yes | see below |

## Regions: the walkable floor
Each region is an axis-aligned floor rectangle: `bounds: { x, z, y, width, depth, height }`.
`(x, z)` is its **centre**, `width` runs along x, `depth` along z, and `y` is the floor height.
Space that no region or corridor covers is solid. The compiler wraps every floor in 6 m walls automatically.
When regions overlap, the later one wins the floor height.

| `type` | effect |
|---|---|
| `zone`, `lane`, `chokepoint`, `staircase`, … | plain floor and a bot route waypoint |
| `site` | bombsite. Tag it `bombsite_a` or `bombsite_b` (anything else is labelled B) |
| `tunnel` | adds a ceiling slab at `y + height` |
| `cover` | floor only, not used as a bot waypoint |

Required tags: one region tagged `spawn_t` at the **−z end** (top of the preview) and one tagged
`spawn_ct` at the **+z end**, each in the outer 20% of the map depth. Five players spawn in a
row from x−6 to x+6 at the region centre, so **spawn regions must be at least 14 m wide in x** and
have no cover on their centre line. Other tags are free-form notes, such as `mid`, `elevated` or `sniper_line`.

## Connections: corridors between regions
`{ "from": "a", "to": "b", "type": "open" }` carves a **5 m wide, L-shaped corridor** from the
centre of `a`, first along x to `b.x`, then along z to `b`'s centre. It only fills empty space; it
never changes an existing region floor. The floor height ramps linearly from `a.y` to `b.y`.
`type` and `elevationChange` are descriptive only.
- To get a straight corridor, line the two regions up on the same `x`, or the same `z` with the target reached first along x.
- An L-corridor can cut through a third region's space. Check the preview.

## Elevation
Floors are rounded to 0.2 m steps. Any edge higher than 0.2 m is lowered into a stepped slope,
so **every height change is walkable** and there are no ledges or jump-ups. Expect raised regions to slope
at their borders: about 1 m of rise needs about 2.5 m of run. Keep `y` within about −3 to +4 m.

## Cover (inside `regions[].cover`)
`{ "type": "...", "pos": [x, y, z], "size": [w, h, d], "rotY": radians }`. `pos` is the centre of the
**bottom** face, in absolute coordinates. `y` is raised to the floor automatically. The `type` name picks the shape by keyword:

| keyword in `type` | result |
|---|---|
| `crate`, `boxes`, `container` | crate (brown; `container` is metal) |
| `door` | door slab (shoot-through, blocks movement) |
| `window_frame`, `double_doors`, `scaffold` | two posts plus a lintel. You can walk through the middle |
| `car`, `pickup_truck` | two-tier vehicle |
| `stairs`, `stair_steps`, `ramp` | **ignored** (decoration, since elevation is automatic) |
| anything else (`wall`, `half_wall`, `pillar`, …) | solid block |

Keep corridors open. Leave at least 2.5 m of clear width beside cover, and don't put cover in a 5 m connection corridor unless you mean to block it.

## Design rules that play well
- Spawn distance should be 50–110 m. A total size of 80–140 m per side suits 5v5.
- Classic two-site layout: T spawn → three routes (A, mid, B). CT spawn sits closer to both sites than T does. Mid connects to a CT rotation area.
- Break any straight sightline from spawn to spawn with cover or a corridor bend.
- Put two or three cover pieces on each site, and one or two in each lane.

## Checker output
`ERROR` lines make the map fail. The checker catches islands, unreachable spawns or sites, blocked spawn slots,
regions outside the bounds, and schema problems. `WARN` lines are advice. In the ASCII preview, `.` is floor,
`^` raised, `v` lowered, `#` obstacle or wall, `T`/`C` spawns, and `A`/`B` sites.
