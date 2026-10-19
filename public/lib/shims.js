import { shiftIsoDay } from './dates.js';

// --- Shims to delete (docs/shims.md) -------------------------------------

const SHIMS_HEADING = '# Shims to delete';

// Returns the table under SHIMS_HEADING as {after, shim, del, cells} rows, or
// null with no such heading. The table's first two lines are its head.
function shimRows(markdown) {
  const text = `\n${String(markdown ?? '')}`;
  const at = text.indexOf(`\n${SHIMS_HEADING}\n`);
  if (at < 0) return null;
  const section = text.slice(at + SHIMS_HEADING.length + 2).split('\n## ')[0];
  return section
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .slice(2)
    .map((line) => {
      const cells = line
        .replace(/^\||\|\s*$/g, '')
        .split('|')
        .map((c) => c.trim());
      return { after: cells[0], shim: cells[1] ?? '', del: cells[2] ?? '', cells: cells.length };
    });
}

// Returns what is wrong with the shim table. shimsDue compares the dates as
// strings, so a date not written as YYYY-MM-DD comes due on the wrong day.
function shimProblems(markdown) {
  const rows = shimRows(markdown);
  if (!rows) return [`no "${SHIMS_HEADING}" section`];
  let last = '';
  return rows.flatMap((r, i) => {
    if (r.cells !== 3) return [`row ${i + 1}: not three cells`];
    if (!/^\d{4}-\d\d-\d\d$/.test(r.after) || shiftIsoDay(r.after, 0) !== r.after)
      return [`row ${i + 1}: ${r.after} is not a day as YYYY-MM-DD`];
    const problems = r.after < last ? [`row ${i + 1}: ${r.after} is out of order`] : [];
    last = r.after;
    return !r.shim || !r.del ? [...problems, `row ${i + 1}: a cell is empty`] : problems;
  });
}

// Returns the shim table's rows past their date. A shim goes on any day after it.
function shimsDue(markdown, todayIso) {
  return (shimRows(markdown) || []).filter((r) => r.after < todayIso);
}

export { shimProblems, shimsDue };
