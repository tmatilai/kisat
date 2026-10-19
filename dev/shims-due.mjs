// node dev/shims-due.mjs [--open] prints the shims past their date in
// docs/shims.md. With GITHUB_TOKEN and GITHUB_REPOSITORY set
// (.github/workflows/shims.yml), `--open` opens an issue for each one whose
// title no issue has used yet.
import fs from 'node:fs';
import { openIssues } from './github-issues.mjs';
import { shimsDue } from '../public/lib/shims.js';

const shims = fs.readFileSync(new URL('../docs/shims.md', import.meta.url), 'utf8');
const today = new Date().toISOString().slice(0, 10);

const due = shimsDue(shims, today).map((s) => ({
  title: `Delete the ${s.shim} shim (after ${s.after})`,
  body:
    `Delete ${s.del}. Delete its row in docs/shims.md in the same commit.\n\n` +
    'The rule is in AGENTS.md, "A breaking change keeps users working".',
}));
for (const d of due) console.log(d.title);
if (!due.length) console.log('nothing due');

if (process.argv.includes('--open')) await openIssues(due);
