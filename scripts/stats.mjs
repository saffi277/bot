/**
 * Prints what the service has been doing, in a shape a person can read.
 *
 *   npm run stats
 *
 * It calls the deployed site rather than the database, because production D1
 * is reachable only from inside the Worker. That also means this works from
 * any machine holding the token, with no database access at all.
 *
 * Output is English for the same reason every other tool here is: terminals
 * reorder Arabic and hand back scrambled text.
 */

const url = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const token = process.env.ADMIN_TOKEN;

if (!token) {
  console.error('\nADMIN_TOKEN is not set.');
  console.error('Add it to .env.local (and to the hosting settings) with at least 16 random characters:');
  console.error('  openssl rand -hex 24\n');
  process.exit(1);
}

let payload;
try {
  const response = await fetch(`${url}/api/stats`, { headers: { authorization: `Bearer ${token}` } });
  if (response.status === 404) {
    console.error(`\nRefused by ${url}. Either ADMIN_TOKEN differs there, or the site is not deployed yet.\n`);
    process.exit(1);
  }
  if (!response.ok) {
    console.error(`\n${url} answered ${response.status}.\n`);
    process.exit(1);
  }
  payload = await response.json();
} catch (error) {
  console.error(`\nCould not reach ${url} - ${error.message}\n`);
  process.exit(1);
}

const money = (n) => `$${n.toFixed(2)}`;
const bar = '-'.repeat(58);

console.log(`\nSaffi usage - ${url}`);
console.log(bar);

for (const w of payload.windows) {
  console.log(`\n${w.label.toUpperCase()}`);
  if (!w.total) {
    console.log('  nothing yet');
    continue;
  }
  console.log(`  photos     : ${w.ok} done, ${w.failed} failed  (${w.successRate}% success)`);
  console.log(`  visitors   : ${w.visitors}`);
  console.log(`  spent      : ${money(w.estimatedCostUsd)}  (estimate, successful calls only)`);
  if (w.medianSeconds !== null) {
    // p95 is the number that decides whether processing must go async.
    const flag = w.p95Seconds > 20 ? '   <-- over 20s, revisit async processing' : '';
    console.log(`  time       : ${w.medianSeconds}s median, ${w.p95Seconds}s p95${flag}`);
  }
  const top = w.referrals.slice(0, 5).map((r) => `${r.source} ${r.count}`).join(', ');
  if (top) console.log(`  came from  : ${top}`);
}

// The bill is what the owner is actually watching, so it is restated alone.
const month = payload.windows.find((w) => w.days === 30);
if (month?.total) {
  console.log(`\n${bar}`);
  console.log(`Last 30 days cost ${money(month.estimatedCostUsd)} for ${month.ok} photo(s).`);
  if (month.ok) console.log(`That is ${money(month.estimatedCostUsd / month.ok)} per photograph.`);
}
console.log('');
