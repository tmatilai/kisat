// node dev/elsewhere-due.mjs [host] [--open] prints the championships that
// need a row in elsewhere.json (docs/elsewhere.md, "Keeping elsewhere.json").
// With GITHUB_TOKEN and GITHUB_REPOSITORY set
// (.github/workflows/elsewhere.yml), `--open` opens an issue for each one
// whose title no issue has used yet.
import { openIssues } from './github-issues.mjs';
import { elsewhereCandidates, elsewhereIsDue, elsewhereYearlyDue } from '../public/lib/elsewhere.js';
import { API } from '../public/lib/schedule.js';
import file from '../public/data/elsewhere.json' with { type: 'json' };

const args = process.argv.slice(2);
const open = args.includes('--open');
const host = args.find((a) => a !== '--open') || 'kisat.matilainen.fi';
const today = new Date().toISOString().slice(0, 10);
const GUIDE =
  'How to add a row is in docs/elsewhere.md, "Keeping elsewhere.json". ' +
  'Close this issue with no row when the meet needs none.';

async function json(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

const { meets } = await json(`https://${host}/api/meets`, { 'x-kisat-client': '1' });
const due = [];
for (const m of elsewhereCandidates(meets, file, today)) {
  if (!elsewhereIsDue(await json(`${API}/competition/${m.id}`), today)) continue;
  due.push({
    title: `Add ${m.name.trim()} (${m.id}) to elsewhere.json`,
    body: `The meet began on ${m.date} and has no results in Tuloslista: https://live.tuloslista.com/${m.id}\n\n${GUIDE}`,
  });
}
for (const c of elsewhereYearlyDue(meets, file, today)) {
  due.push({
    title: `Add ${c.name} ${c.year} to elsewhere.json`,
    body: `${c.name} ${c.year} has no row and no Tuloslista meet. It stands alone as \`${c.word}-${c.year}\`.\n\n${GUIDE}`,
  });
}
for (const d of due) console.log(d.title);
if (!due.length) console.log('nothing due');

if (open) await openIssues(due);
