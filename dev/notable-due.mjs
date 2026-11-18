// node dev/notable-due.mjs [host] [--open] prints what notable.json lacks
// (docs/notable.md, "Keeping notable.json"), and `--open` opens its issues
// (openIssues).
import { openIssues } from './github-issues.mjs';
import { notableDue } from '../public/lib/medals.js';
import elsewhere from '../public/data/elsewhere.json' with { type: 'json' };
import notable from '../public/data/notable.json' with { type: 'json' };

const args = process.argv.slice(2);
const host = args.find((a) => a !== '--open') || 'kisat.matilainen.fi';
const today = new Date().toISOString().slice(0, 10);
const GUIDE = 'How to add a meet is in docs/notable.md, "Keeping notable.json".';

const res = await fetch(`https://${host}/api/meets`, { headers: { 'x-kisat-client': '1' } });
if (!res.ok) throw new Error(`https://${host}/api/meets: ${res.status}`);
const { meets } = await res.json();
const due = notableDue(notable, meets, today, elsewhere).map(({ entry, meet, year }) =>
  meet
    ? {
        title: `Add ${meet.name.trim()} (${meet.id}) to notable.json`,
        body:
          `The meet begins on ${meet.date}, and its name holds "${entry.name}". If it is part of ` +
          `that meet's edition, its id goes in the \`comps\` of \`${entry.id}\`. Close this issue if it is not.\n\n${GUIDE}`,
      }
    : {
        title: `Find ${entry.name} ${year} for notable.json`,
        body:
          `No meet of ${year} in the meet index has a name that holds "${entry.name}". If the meet ran ` +
          `under another name or on another site, it goes in the \`comps\` of \`${entry.id}\`.\n\n${GUIDE}`,
      },
);
for (const d of due) console.log(d.title);
if (!due.length) console.log('nothing due');

if (args.includes('--open')) await openIssues(due, 'notable');
