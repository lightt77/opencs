import { checkLan } from './check';

const address = process.argv[2];
if (!address) {
  console.error('Usage: npm run lan:check -- http://HOST-WIFI-IP:5173');
  process.exitCode = 1;
} else {
  try { process.exitCode = await checkLan(address) ? 0 : 1; }
  catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
