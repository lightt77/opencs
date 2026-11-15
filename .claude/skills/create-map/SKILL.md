---
name: create-map
description: Create a new OpenCS map from a natural-language description. Writes src/maps/custom/<name>.json and iterates with npm run map:check until the map is playable.
---

# Create an OpenCS map

The user describes a map (theme, sites, routes, chokepoints, size). Turn it into one JSON file.

1. Read `docs/MAP_AUTHORING.md` fully, and `src/maps/custom/market_district.json` as a template.
2. Sketch the layout first: list the regions with centre, size and floor height on a rough grid, then the connections. Check each L-corridor path (x first, then z).
3. Write `src/maps/custom/<snake_case_name>.json`, with `displayName`, `biome`, `subtitle` and `description` filled in.
4. Run `npm run map:check -- src/maps/custom/<name>.json`. Fix every `ERROR`, and consider every `WARN`.
   Compare the ASCII preview against the description: are the routes, sites and chokepoints where the user asked? Repeat until it prints `OK`.
5. Run `npx vitest run tests/custom-maps.test.ts`. It compiles every custom map and runs bot navigation across it.
6. Tell the user the map id (`custom_<name>`), paste the final ASCII preview, and say it now appears in the map picker (`npm run dev`).
