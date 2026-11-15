// Usage: npm run map:check -- src/maps/custom/my_map.json [--svg out.svg] [--quiet]
import { readFileSync, writeFileSync } from 'node:fs';
import { checkMap } from '../src/map-check';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--svg');
if (!file) { console.error('Usage: npm run map:check -- <map.json> [--svg preview.svg] [--quiet]'); process.exit(2); }
let json: unknown;
try { json = JSON.parse(readFileSync(file, 'utf8')); }
catch (error) { console.error(`ERROR  Cannot read/parse ${file}: ${(error as Error).message}`); process.exit(1); }
const report = checkMap(json);
if (report.stats) {
  const s = report.stats;
  console.log(`${s.name}  [${s.biome}]  ${s.width} x ${s.depth} m  regions=${s.regions} connections=${s.connections} boxes=${s.boxes} spawn-distance=${s.spawnDistance} m`);
}
for (const e of report.errors) console.log(`ERROR  ${e}`);
for (const w of report.warnings) console.log(`WARN   ${w}`);
if (report.ascii && !args.includes('--quiet')) {
  console.log('\nTop-down preview (north/-z at top, 1 char ~ 2 m):  . floor  ^ raised  v lowered  # obstacle  T/C spawns  A/B sites\n');
  console.log(report.ascii);
}
const svgIndex = args.indexOf('--svg');
if (svgIndex >= 0 && report.svg) { writeFileSync(args[svgIndex + 1], report.svg); console.log(`\nSVG preview written to ${args[svgIndex + 1]}`); }
console.log(report.ok ? '\nOK  map is playable' : `\nFAIL  ${report.errors.length} error(s)`);
process.exit(report.ok ? 0 : 1);
