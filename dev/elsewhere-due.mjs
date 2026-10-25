// node dev/elsewhere-due.mjs [host] [--open] prints the championships that
// need a row in elsewhere.json, and the rows that need a fix (docs/elsewhere.md,
// "Keeping elsewhere.json").
// With GITHUB_TOKEN and GITHUB_REPOSITORY set
// (.github/workflows/elsewhere.yml), `--open` opens an issue for each one
// whose title no issue has used yet.
import { openIssues } from './github-issues.mjs';
import {
  elsewhereCandidates,
  elsewhereIsDue,
  elsewhereIsRace,
  elsewhereRecheck,
  elsewhereUpcoming,
  elsewhereYearlyDue,
  olMissingClasses,
} from '../public/lib/elsewhere.js';
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
// The title is the one a meet past its day gets, so no meet gets two issues.
for (const m of elsewhereUpcoming(meets, file, today)) {
  if (!elsewhereIsRace(await json(`${API}/competition/${m.id}`))) continue;
  due.push({
    title: `Add ${m.name.trim()} (${m.id}) to elsewhere.json`,
    body:
      `The meet begins on ${m.date} and runs in a race, so its results will be in the race's files. ` +
      `Its row can go in once they answer.\n\n${GUIDE}`,
  });
}
// Tuloslista can drop a meet once it is over (docs/tuloslista-api.md), and
// such a championship needs a row of its own.
for (const m of elsewhereCandidates(meets, file, today)) {
  const res = await fetch(`${API}/competition/${m.id}`);
  if (res.status === 404) {
    due.push({
      title: `Add ${m.name.trim()} (${m.id}) to elsewhere.json`,
      body:
        `The meet began on ${m.date}, and Tuloslista has dropped it. If its results are on another site, ` +
        `it needs a row of its own, with an \`id\` and \`was: ${m.id}\` (docs/elsewhere.md, ` +
        `"A championship with no meet in Tuloslista").\n\n${GUIDE}`,
    });
    continue;
  }
  if (!res.ok) throw new Error(`${API}/competition/${m.id}: ${res.status}`);
  if (!elsewhereIsDue(await res.json(), today)) continue;
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
// A listed meet that Tuloslista drops, or whose events no longer carry a
// class's name, gets no results.
for (const { row, meet } of elsewhereRecheck(meets, file, today)) {
  const name = `${meet.name.trim()} (${row.comp})`;
  const res = await fetch(`${API}/competition/${row.comp}`);
  if (res.status === 404) {
    due.push({
      title: `Let the row of ${name} stand alone in elsewhere.json`,
      body:
        'Tuloslista answers 404 for the meet. Its row needs an `id` in place of `comp`, and `was` with ' +
        'the meet id (docs/elsewhere.md, "A championship with no meet in Tuloslista").',
    });
    continue;
  }
  if (!res.ok) throw new Error(`${API}/competition/${row.comp}: ${res.status}`);
  const missing = row.ol ? olMissingClasses(row, await res.json()) : [];
  if (!missing.length) continue;
  due.push({
    title: `Fix the classes of ${name} in elsewhere.json`,
    body: `The meet has no event of these names, so they get no results: ${missing.join(', ')}.`,
  });
}
for (const d of due) console.log(d.title);
if (!due.length) console.log('nothing due');

if (open) await openIssues(due);
