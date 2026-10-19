import { parse } from 'parse5';
import { T4R_FINAL_RE, t4rMark, t4rWanted } from './elsewhere.js';

// --- The other site's pages (docs/elsewhere.md, "The pages") ---
// Only worker.js and the tests import this file. parse5 is a package, and
// `make serve` serves public/ unbundled, so a file the page loads must not
// import this one.

// Lists a parsed node's descendants in document order. A comment is a node of
// its own, so markup switched off inside one is never an element.
function t4rNodes(node, into = []) {
  for (const child of node?.childNodes ?? []) {
    into.push(child);
    t4rNodes(child, into);
  }
  return into;
}
const t4rAll = (node, tag) => t4rNodes(node).filter((n) => n.tagName === tag);
const t4rSpaces = (text) => text.replace(/\s+/g, ' ').trim();
const t4rText = (node) =>
  t4rSpaces(
    t4rNodes(node)
      .map((n) => (n.nodeName === '#text' ? n.value : ''))
      .join(''),
  );
// Splits a cell into lines at <br> and drops the empty tail. A line pairs with
// the header's line at the same position, so an empty line inside stays: it is
// a bar the jumper came in above.
const t4rLines = (node) => {
  const lines = [''];
  for (const n of t4rNodes(node)) {
    if (n.tagName === 'br') lines.push('');
    else if (n.nodeName === '#text') lines[lines.length - 1] += n.value;
  }
  const kept = lines.map(t4rSpaces);
  while (kept.length && !kept[kept.length - 1]) kept.pop();
  return kept;
};
const t4rCells = (tr) => tr.childNodes.filter((n) => n.tagName === 'td' || n.tagName === 'th');
// Joins the attribute values under a node, where an index row's links are.
const t4rAttrs = (node) =>
  t4rNodes(node)
    .flatMap((n) => (n.attrs || []).map((a) => a.value))
    .join(' ');
// Reads the heat's wind from the row over its table. A field group's row has
// none, and an event with no reading has the word alone (docs/elsewhere.md).
const t4rHeatWind = (label) => (label || []).map((t) => /^Tuuli:\s*(\S+)/i.exec(t)?.[1]).find(Boolean) || null;

// Reads a day's index page as {days, rows}, where `days` are the other days'
// directories and a row is a result page in the index's order. `time` is the
// site's only clock, `dir` the page's directory and `startList` its start list.
function t4rIndex(html, dir = '') {
  const doc = parse(String(html ?? ''));
  const days = [
    ...new Set(
      t4rNodes(doc).flatMap((n) => {
        const day = /^\.\/([a-z]{2})\/?$/.exec(n.attrs?.find((a) => a.name === 'href')?.value ?? '')?.[1];
        return day ? [`${day}/`] : [];
      }),
    ),
  ];
  const rows = t4rAll(doc, 'tr').flatMap((tr) => {
    const links = t4rAttrs(tr);
    const href = /showEvent\('([\w-]+-r\.html)'\)/.exec(links)?.[1];
    const startList = /showEvent\('([\w-]+-sl\.html)'\)/.exec(links)?.[1];
    const cells = t4rCells(tr).map(t4rText);
    return href && cells.length >= 3
      ? [
          {
            event: cells[1],
            round: cells[2],
            time: cells[0],
            dir,
            href: dir + href,
            startList: startList ? dir + startList : null,
          },
        ]
      : [];
  });
  return { days, rows };
}

// Parses a result page as t4rGraft's {event, round, heats}. A header row that
// starts "Sija" opens a heat, and a result row has both a name and a club
// (docs/elsewhere.md). A leg's points are its one unheaded cell of digits.
function t4rResultPage(html) {
  const doc = parse(String(html ?? ''));
  const heats = [];
  let heat = null;
  let columns = [];
  let blanks = [];
  let label = [];
  for (const tr of t4rAll(doc, 'tr')) {
    const cells = t4rCells(tr);
    if (cells.some((c) => c.tagName === 'th')) {
      const opens = t4rText(cells[0]) === 'Sija';
      const after = opens ? cells.slice(3).map((c, i) => [t4rLines(c), i + 3]) : [];
      columns = after.filter(([head]) => head.length);
      blanks = after.filter(([head]) => !head.length).map(([, at]) => at);
      heat = opens ? { wind: t4rHeatWind(label), heads: columns.map(([head]) => head), rows: [] } : null;
      if (heat) heats.push(heat);
      label = [];
      continue;
    }
    const [name, club] = t4rLines(cells[1]);
    const team = heat?.rows.at(-1);
    if (team && !club && name && !t4rText(cells[0])) team.runners = t4rRunners(name);
    if (!heat || cells.length < 3 || !club) {
      label = cells.map(t4rText);
      continue;
    }
    const [result, wind] = t4rLines(cells[2]);
    const scored = blanks.map((at) => t4rText(cells[at])).filter((t) => /^\d+$/.test(t));
    heat.rows.push({
      place: t4rText(cells[0]),
      name,
      club,
      result,
      wind: wind || null,
      qual:
        cells
          .slice(3)
          .map(t4rText)
          .find((t) => /^[Qq]$/.test(t)) || '',
      points: scored.length === 1 ? Number(scored[0]) : null,
      attempts: columns.map(([, at]) => t4rLines(cells[at])),
    });
  }
  return { event: t4rText(t4rAll(doc, 'h1')[0]), round: t4rText(t4rAll(doc, 'h2')[0]), heats };
}

// Reads a start list's rule for going through as a round's QRank and QResult
// (docs/elsewhere.md). A field round gives the mark before "(Q)" and a track
// round two counts. A page with no rule gives null.
function t4rQualRule(html) {
  const texts = t4rNodes(parse(String(html ?? ''))).filter((n) => n.nodeName === '#text');
  const text = texts.map((n) => /Jatkoonpääsy:([\s\S]*)/u.exec(n.value)?.[1]).find((t) => t != null) ?? '';
  const at = text.indexOf('(Q)');
  const rank =
    at < 0
      ? ''
      : (text
          .slice(0, at)
          .match(/\d+(?:,\d+)?/g)
          ?.at(-1) ?? '');
  const fill = /(\d+)[^\d(]*\(q\)/u.exec(text.slice(at + 1))?.[1] ?? '';
  return rank || fill ? { QRank: t4rMark(rank), QResult: fill } : null;
}

// Splits a relay row's runners at commas. A long relay writes each leg's split
// after the name, and the split's comma cuts its fraction into an item with no
// letter (docs/elsewhere.md). Both parts of the split drop out.
const T4R_SPLIT_RE = /\s+\d+(?:[.:]\d\d)?$/u;
const t4rRunners = (text) =>
  String(text ?? '')
    .split(/\s*,\s*/)
    .filter((s) => /\p{L}/u.test(s))
    .map((s) => s.replace(T4R_SPLIT_RE, '').trim())
    .filter(Boolean);

// Decodes the site's pages as a browser does. Their label is iso-8859-1, which
// the encoding standard, Node and workerd all read as windows-1252. So a byte
// the two encodings differ in is a letter and not a control code.
const t4rDecode = (buffer) => new TextDecoder('windows-1252').decode(buffer);

// Reads the pages t4rGraft needs in the site's order, an earlier round's with
// its start list's `qualRule`. `read(path, parse)` answers parse's result, or
// null where the page cannot be read, and `each(items, fn)` caps the reads.
async function t4rSitePages(read, eventResults, each = (items, fn) => Promise.all(items.map(fn))) {
  const front = await read('', (html) => t4rIndex(html));
  if (!front) return [];
  const days = await each(front.days, (dir) => read(dir, (html) => t4rIndex(html, dir)));
  const rows = [...days.flatMap((day) => day?.rows || []), ...front.rows];
  const wanted = t4rWanted(rows, eventResults);
  const read1 = async (row) => {
    const [page, qualRule] = await Promise.all([
      read(row.href, t4rResultPage),
      row.startList && !T4R_FINAL_RE.test(row.round) ? read(row.startList, t4rQualRule) : null,
    ]);
    return page && { ...page, time: row.time, dir: row.dir, ...(qualRule ? { qualRule } : {}) };
  };
  return (await each(wanted, read1)).filter(Boolean);
}

export { t4rDecode, t4rIndex, t4rQualRule, t4rResultPage, t4rSitePages };
