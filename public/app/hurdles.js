import { parseTs } from '../lib/dates.js';
import {
  hurdleDistance,
  hurdleMarkGlyph,
  hurdleRelayLeg,
  hurdleSetupBlocks,
  hurdleSheetBlocks,
  hurdleStartSetups,
  isHurdleStart,
  laneRange,
  shuttleBandNames,
  shuttleStartRows,
  steepleDistance,
  steepleStartRows,
} from '../lib/hurdles.js';
import { defaultTrack, isTrackLength } from '../lib/lap-counter.js';
import { TABLE_PAGE_PATH, TABLE_PAGE_TITLE, dayPath, hurdleSheetPath, tablePageHash } from '../lib/routes.js';
import { groupRounds, roundDetails, startFinished } from '../lib/schedule.js';
import { venueFullName, venueGroups, venueTable } from '../lib/venues.js';
import { eventStoreFor, fetchCompProps, fetchJson, fetchSchedule } from './data.js';
import { copyAppLink } from './follow.js';
import {
  appEl,
  el,
  keptOpen,
  navigate,
  render,
  renderSeq,
  setBack,
  setScrollKey,
  setTitleMenu,
  svgEl,
  timeFmt,
} from './shell.js';

// --- The hurdle table, the kentät and what a device keeps ---

const fiNum = (n) => String(n).replace('.', ',');
// Every height carries one decimal, so a column never mixes "60" with "83,8".
const hurdleHeight = (setup) => `${setup.height.map((n) => fiNum(n.toFixed(1))).join(' tai ')} cm`;

// Holds hurdles.json once it has loaded, until the page reloads. A failed fetch
// is not kept, so the box stays out and the next hurdle start tries again.
let hurdleTable = null;

async function loadHurdleTable() {
  if (!hurdleTable) hurdleTable = await fetchJson('/data/hurdles.json').catch(() => null);
  return hurdleTable;
}

// venueIndex holds the fetch of venues/index.json, so callers that ask at the
// same time share it, and venueFiles holds the file of each chosen kenttä
// (docs/venues.md, "The files"). Both last until the page reloads, and a failed
// fetch is not kept.
let venueIndex = null;
const venueFiles = new Map();

async function loadVenues() {
  venueIndex ??= fetchJson('/data/venues/index.json').then(
    (b) => b?.venues || null,
    () => null,
  );
  const venues = await venueIndex;
  if (!venues) venueIndex = null;
  return venues || [];
}

// Returns the chosen kenttä as its index row merged with its file, or null. A
// kenttä whose file does not load counts as none, so the federations' own
// marks stand (venueTable).
async function loadChosenVenue(compId) {
  return loadVenue(storedVenue(compId));
}

// A 404 is a kenttä with no board file, kept as null. Any other failure is
// not kept, so the next call asks again, as loadVenues does.
async function loadVenue(id) {
  if (!id) return null;
  const entry = (await loadVenues()).find((v) => v.id === id);
  if (!entry) return null;
  let file = venueFiles.get(id);
  if (file === undefined) {
    file = await fetchJson(`/data/venues/${id}.json`).catch((e) => (e.status === 404 ? null : undefined));
    if (file !== undefined) venueFiles.set(id, file);
  }
  return file ? { ...entry, ...file } : null;
}

// The chosen kenttä has a key of its own, because track:<compId> keeps its
// format (docs/juoksut.md, "What the counter requires of the rest").
function venueKey(compId) {
  return `venue:${compId}`;
}

function storedVenue(compId) {
  try {
    return JSON.parse(localStorage.getItem(venueKey(compId)))?.id || null;
  } catch {
    return null;
  }
}

function saveVenue(compId, id) {
  try {
    if (id) localStorage.setItem(venueKey(compId), JSON.stringify({ id, t: Date.now() }));
    else localStorage.removeItem(venueKey(compId));
  } catch {
    /* With the store full, the choice is not kept. */
  }
}

// The flip says which way the meet's taping figures face (figureBlock,
// docs/hurdles.md, "The day sheet").
function flipKey(compId) {
  return `flip:${compId}`;
}

function storedFlip(compId) {
  try {
    return !!JSON.parse(localStorage.getItem(flipKey(compId)))?.flip;
  } catch {
    return false;
  }
}

function saveFlip(compId, flip) {
  try {
    if (flip) localStorage.setItem(flipKey(compId), JSON.stringify({ flip: true, t: Date.now() }));
    else localStorage.removeItem(flipKey(compId));
  } catch {
    /* With the store full, the choice is not kept. */
  }
}

// The kenttä link /c/<id>/k/<venueId or length> writes what the select would
// (docs/venues.md). An unknown id writes nothing, and the schedule falls back
// as it does for a kenttä dropped from the index.
async function activateVenueLink(compId, venueId) {
  const seq = renderSeq;
  const venues = await loadVenues();
  if (seq !== renderSeq) return;
  if (venueId === '400' || venueId === '200') {
    saveVenue(compId, null);
    saveTrack(compId, Number(venueId));
  } else {
    const venue = venues.find((v) => v.id === venueId);
    if (venue) {
      saveVenue(compId, venue.id);
      saveTrack(compId, venue.length);
    }
  }
  navigate(`/c/${compId}`, { replace: true });
}

// Makes the title menu's row to the table page, set to the meet's kenttä
// (renderHurdleTable). The link keeps location.search, which carries the dev
// host's ?mode=.
function tablePageRow(compId, open = null) {
  return {
    label: TABLE_PAGE_TITLE,
    href: `${TABLE_PAGE_PATH}${location.search}${tablePageHash('aidat', [], storedVenue(compId), open)}`,
  };
}

// Names the table page's folded section that a relay or steeple start opens.
// Other starts get null.
function tablePageSection(event) {
  if (hurdleRelayLeg(event) != null) return 'viestit';
  return steepleDistance(event) != null ? 'esteet' : null;
}

function trackKey(compId) {
  return `track:${compId}`;
}

// Returns the meet's stored track, or the season's guess from the start's day
// (docs/lap-counter.md, "Distance, crossings and the track"). A meet held
// across 30 April opens its two days on different tracks.
function storedTrack(compId, when) {
  try {
    const stored = JSON.parse(localStorage.getItem(trackKey(compId)))?.track;
    if (isTrackLength(stored)) return stored;
  } catch {
    /* An unreadable entry falls back to the season. */
  }
  return defaultTrack(when);
}

function saveTrack(compId, track) {
  // The stamp lets pruneLapsStore sweep the choice with the lap logs.
  try {
    localStorage.setItem(trackKey(compId), JSON.stringify({ track, t: Date.now() }));
  } catch {
    /* With the store full, the choice is not kept. */
  }
}

// --- A setup's marks and rows ---

// The paint's colours do not follow the theme, so a stroke outlines each shape
// and a black mark still shows on a dark page. The shapes stand at least half
// a unit inside the viewBox so the stroke is not clipped.
const MARK_SHAPES = {
  circle: () => svgEl('circle', { cx: 7, cy: 7, r: 5.5 }),
  // It stops short of the full width, or it reads as the line glyph.
  rectangle: () => svgEl('rect', { x: 2, y: 4.5, width: 10, height: 5 }),
  // A board may paint both a square and a rectangle. Height alone tells the
  // two glyphs apart.
  square: () => svgEl('rect', { x: 2, y: 2, width: 10, height: 10 }),
  // A mitred apex spikes past the viewBox at this size.
  triangle: () => svgEl('polygon', { points: '7,1 13.2,12.8 0.8,12.8', 'stroke-linejoin': 'round' }),
  // It is drawn whole, although the paint is two pieces at the lane's sides.
  line: () => svgEl('rect', { x: 0.5, y: 5.5, width: 13, height: 3 }),
};

function markGlyph(mark) {
  const glyph = hurdleMarkGlyph(mark);
  return (
    glyph &&
    svgEl(
      'svg',
      {
        class: `hurdle-mark hurdle-mark-${glyph.colour}`,
        viewBox: '0 0 14 14',
        'aria-hidden': 'true',
        focusable: 'false',
      },
      MARK_SHAPES[glyph.shape](),
    )
  );
}

// Builds the setup tables' header row. `lead` heads the first column. A null
// lead drops that column, as for a one-class undrawn relay.
function setupHeadRow(lead, steeple = false) {
  return el(
    'tr',
    { class: 'setup-cols' },
    lead != null ? el('th', {}, lead) : null,
    el('th', { class: 'num' }, 'Korkeus'),
    // A steeple's Merkintä spans the last three columns. The day sheet's
    // shared table then keeps every Korkeus in one column (renderHurdleSheet).
    el('th', { class: 'setup-mark', colspan: steeple ? '3' : null }, 'Merkintä'),
    // Aitoja is not muted, because the count changes between classes as the
    // height does.
    steeple ? null : el('th', { class: 'num' }, 'Aitoja'),
    // Mitat is SUL's alkusileä / väli / loppusileä.
    steeple ? null : el('th', { class: 'num hurdle-dim' }, 'Mitat'),
  );
}

// Builds one setting's row, led by its lanes. The classes go under the lanes
// only where the start has several. With nothing drawn, the classes come first.
function hurdleSettingRow(drawn, { setup, mark, categories, lanes }, venueName, showCats) {
  // Without a mark the distances are what gets taped out, so they stay unmuted.
  const dist = mark ? 'num hurdle-dim' : 'num';
  return el(
    'tr',
    {},
    drawn
      ? el(
          'td',
          { class: 'hurdle-lanes' },
          lanes.length ? laneRange(lanes) : '–',
          showCats ? el('div', { class: 'hurdle-cats' }, categories.join(', ')) : null,
        )
      : el('td', {}, el('span', { class: 'hurdle-cats-cell' }, categories.join(', '))),
    setup ? null : el('td', { class: 'hurdle-none', colspan: '4' }, 'Tuntematon sarja'),
    setup ? el('td', { class: 'num' }, hurdleHeight(setup)) : null,
    setup ? el('td', mark ? {} : { class: 'hurdle-none' }, mark ? markParts(setup, mark, venueName) : '–') : null,
    setup ? el('td', { class: 'num' }, String(setup.count)) : null,
    setup ? el('td', { class: dist }, hurdleDims(setup)) : null,
  );
}

// Builds a block's rows (hurdleSetupBlocks), an array per section. The "Erä N"
// headings appear only where several drawn heats need telling apart.
function hurdleBlockRows({ drawn, sections }, venueName, showCats) {
  const headings = drawn && sections.length > 1;
  return sections.map(({ heat, rows }) => [
    headings ? el('tr', { class: 'hurdle-heat' }, el('th', { colspan: '5', scope: 'rowgroup' }, `Erä ${heat}`)) : null,
    ...rows.map((r) => hurdleSettingRow(drawn, r, venueName, showCats)),
  ]);
}

// Puts a block in one table, so every heat's Korkeus stands in one column.
function hurdleSetupTable(block, venueName, showCats) {
  return el(
    'div',
    { class: 'tbl-wrap' },
    el(
      'table',
      { class: 'tbl setup-tbl' },
      el('thead', {}, setupHeadRow(block.drawn ? 'Radat' : 'Sarja')),
      hurdleBlockRows(block, venueName, showCats).map((trs) => el('tbody', {}, trs)),
    ),
  );
}

const hurdleDims = (setup) => [setup.toFirst, setup.interval, setup.toFinish].map(fiNum).join(' / ');

// `mark.of` means the setting uses only the first few spots of a longer mark.
// Saying so keeps the unused spots from reading as missing hurdles. The
// kenttä is named only where its board differs from the sheet.
function markParts(setup, mark, venueName) {
  return [
    el('span', { class: 'hurdle-mark-name' }, markGlyph(mark), mark.colour),
    ` ${mark.symbol}`,
    mark.of ? el('span', { class: 'hurdle-dim' }, ` — ${setup.count}/${mark.of} ensimmäistä`) : null,
    mark.venue ? el('span', { class: 'hurdle-dim' }, ` — ${venueName}`) : null,
  ];
}

// A steeple start is a group start with no lanes, so its box has a row per
// bar (steepleStartRows, lib/hurdles.js).
function steepleSettingRow({ setup, mark, categories }) {
  return el(
    'tr',
    {},
    el('td', {}, el('span', { class: 'hurdle-cats-cell' }, categories.join(', '))),
    setup ? null : el('td', { class: 'hurdle-none', colspan: '4' }, 'Tuntematon sarja'),
    setup ? el('td', { class: 'num' }, hurdleHeight(setup)) : null,
    setup
      ? el('td', { class: mark ? null : 'hurdle-none', colspan: '3' }, mark ? markParts(setup, mark, '') : '–')
      : null,
  );
}

function steepleSetupTable(info) {
  return el(
    'div',
    { class: 'tbl-wrap' },
    el(
      'table',
      { class: 'tbl setup-tbl' },
      el('thead', {}, setupHeadRow('Sarja', true)),
      el('tbody', {}, info.rows.map(steepleSettingRow)),
    ),
  );
}

// Writes a pair of legs as "1 ja 3", the relay sheet's form. More legs become
// a range.
const legsText = (legs) => (legs.length === 2 ? legs.join(' ja ') : laneRange(legs));

// The first column holds the drawn lanes. Before the draw it holds the legs
// where a setting covers only some of them, and otherwise the classes. A
// one-class undrawn start has no first column.
function shuttleSettingRows(rows, missing, venueName, multiClass) {
  const catOf = (r) => r.class || (multiClass ? r.categories.join(', ') : null);
  const legsVary = rows.some((r) => r.legs.length !== 4);
  const drawn = rows.some((r) => r.lanes.length);
  const lead = drawn ? 'Radat' : legsVary ? 'Osuudet' : rows.some(catOf) || missing.length ? 'Sarja' : null;
  const trs = [
    ...rows.map((r) => {
      const cats = catOf(r);
      const catsBelow = cats ? el('div', { class: 'hurdle-cats' }, cats) : null;
      return el(
        'tr',
        {},
        lead
          ? el(
              'td',
              { class: 'hurdle-lanes' },
              drawn
                ? [r.lanes.length ? laneRange(r.lanes) : '–', catsBelow]
                : legsVary
                  ? [legsText(r.legs), catsBelow]
                  : cats,
            )
          : null,
        el('td', { class: 'num' }, hurdleHeight(r)),
        el('td', r.mark ? {} : { class: 'hurdle-none' }, r.mark ? shuttleMarkParts(r, venueName) : '–'),
        el('td', { class: 'num' }, String(r.count)),
        el('td', { class: r.mark ? 'num hurdle-dim' : 'num' }, hurdleDims(r)),
      );
    }),
    ...missing.map((label) =>
      el('tr', {}, el('td', {}, label), el('td', { class: 'hurdle-none', colspan: '4' }, 'Tuntematon sarja')),
    ),
  ];
  return { lead, trs };
}

function shuttleSetupTable(rows, missing, venueName, multiClass) {
  const { lead, trs } = shuttleSettingRows(rows, missing, venueName, multiClass);
  return el(
    'div',
    { class: 'tbl-wrap' },
    el('table', { class: 'tbl setup-tbl' }, el('thead', {}, setupHeadRow(lead)), el('tbody', {}, trs)),
  );
}

function shuttleMarkParts(row, venueName) {
  return [
    ...markParts(row, row.mark, venueName),
    row.markLegs ? el('span', { class: 'hurdle-dim' }, ` (os ${legsText(row.markLegs)})`) : null,
  ];
}

// --- The setup box on a start ---

// Whether each start's setup box is open, by its groupKey, until the event
// view is left (keptOpen, app/shell.js).
const hurdleOpen = keptOpen('group');

// Shows what an official puts on the track before this start (docs/hurdles.md,
// "The box on a start"). A setting that is taped out over other races' paint
// also gets its taping figure (hurdleTapes).
function hurdleBox(detailed, table, run, groupKey, venue, compId) {
  const info = hurdleStartSetups(detailed, table);
  if (!info) return null;
  return hurdleShell(run, groupKey, [
    ...hurdleSetupBlocks(info).map((b) => hurdleSetupTable(b, venueFullName(venue), info.multiClass)),
    ...info.rows
      .filter((r) => r.tapes)
      .map((r) => figureBlock(compId, (flip, onFlip) => hurdleFigure(info, r, flip, onFlip))),
  ]);
}

// Wraps every setup box in a <details>. It is open until the start has run,
// and a reader's toggle holds across the refresh (hurdleOpen).
function hurdleShell(run, groupKey, children, label = 'Aidat') {
  return el('details', { class: 'fold hurdles', ...hurdleOpen(groupKey, !run) }, el('summary', {}, label), ...children);
}

function steepleBox(detailed, table, run, groupKey) {
  const info = steepleStartRows(
    (detailed || []).map((e) => ({ label: e.label, round: e.schedRound })),
    table,
  );
  return info && hurdleShell(run, groupKey, [steepleSetupTable(info)], 'Esteet');
}

// The aitaviesti box holds the setup table and the taping figure under it
// (docs/hurdles.md, "Aitaviesti").
function shuttleBox(detailed, table, run, groupKey, venue, compId) {
  const info = shuttleStartRows(
    (detailed || []).map((e) => ({ label: e.label, round: e.schedRound, drawn: e.round })),
    table,
  );
  if (!info) return null;
  const venueName = venueFullName(venue);
  const parts = [shuttleSetupTable(info.rows, info.missing, venueName, info.multiClass)];
  if (info.rows.length) {
    parts.push(shuttleFigureBlock(info, compId));
  }
  return hurdleShell(run, groupKey, parts);
}

// --- The figures ---

// Returns the app column's width inside its padding. A figure is drawn to it.
function appColumnWidth() {
  const cs = getComputedStyle(appEl);
  return appEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
}

// The figures drawn to the column are redrawn when its width changes. Height is
// ignored, as a phone's URL bar hiding fires a resize too. A figure drops out
// once its node has left the page.
const columnFigures = new Set();
let columnPx = 0;

function redrawColumn() {
  const w = appColumnWidth();
  if (w === columnPx) return;
  columnPx = w;
  for (const f of columnFigures) {
    if (f.node.isConnected) f.build();
    else columnFigures.delete(f);
  }
}

// Redraws once more after the render. A figure is built before the page holds
// it, and a page that scrolls loses the scroll bar's width (355 px against 370
// on the day sheet at a 402 px viewport).
function redrawOnResize(node, build) {
  columnPx = appColumnWidth();
  columnFigures.add({ node, build });
  setTimeout(redrawColumn);
}

window.addEventListener('resize', redrawColumn);

// Wraps a figure that a tap turns end for end. Which way the figures face is
// one stored choice per meet, so a start's figure and the day sheet's turn
// together (storedFlip, docs/hurdles.md, "The day sheet").
function figureBlock(compId, render) {
  const wrap = el('div', {});
  const build = () => {
    const flip = storedFlip(compId);
    wrap.replaceChildren(
      ...render(flip, () => {
        saveFlip(compId, !flip);
        build();
      }),
    );
  };
  build();
  redrawOnResize(wrap, build);
  return wrap;
}

function shuttleFigureBlock(info, compId) {
  return figureBlock(compId, (flip, onFlip) => shuttleFigure(info, flip, onFlip));
}

// Draws the one-lane figure of a setting that is taped out (hurdleTapes,
// lib/hurdles.js). Where the box has several rows, a caption names the row by
// its lanes, or by its classes when the start is perHeat or the row is undrawn.
function hurdleFigure(info, row, flip, onFlip) {
  const caption =
    info.rows.length === 1
      ? null
      : !info.perHeat && row.lanes.length
        ? `Radat ${laneRange(row.lanes)}`
        : row.categories.join(', ');
  return [
    caption ? el('div', { class: 'shuttle-legend' }, caption) : null,
    hurdleTapeFigure(info.distance, row.tapes, flip, onFlip),
  ].filter(Boolean);
}

// The legend is rebuilt with the strip because its arrows turn with the flip.
function shuttleFigure({ distance, rows, tapes }, flip, onFlip) {
  return [shuttleLegend(rows, flip), shuttleTapeFigure(distance, tapes, shuttleBandNames(rows), flip, onFlip)];
}

// Names the legs running each way over the figure. Even legs run toward the
// maali end, whichever side the flip has put it on.
function shuttleLegend(rows, flip) {
  const dirs = [];
  const say = (cls, legs, right) =>
    dirs.push(
      (right ? [cls, `osuudet ${legsText(legs)}`, '→'] : ['←', cls, `osuudet ${legsText(legs)}`])
        .filter(Boolean)
        .join(' '),
    );
  for (const r of rows) {
    const odd = r.legs.filter((l) => l % 2);
    const even = r.legs.filter((l) => l % 2 === 0);
    if (even.length) say(r.class, even, !flip);
    if (odd.length) say(r.class, odd, flip);
  }
  return el('div', { class: 'shuttle-legend' }, [...new Set(dirs)].join(' · '));
}

// Measures the figure's 10 px labels (.shuttle-dim-label, .shuttle-lane-name)
// on a canvas, because the figure is built off the page. The margins are cut
// to these widths so the strip runs edge to edge (dev/probe-hurdles.js).
let labelCtx;

function labelWidth(text) {
  if (!labelCtx) labelCtx = document.createElement('canvas').getContext('2d');
  labelCtx.font = `10px ${getComputedStyle(document.body).fontFamily}`;
  return labelCtx.measureText(text).width;
}

// Returns half the wider end label's width, which the right margin has to
// hold. The flip decides which of the two labels stands there.
function endLabelHalf(farLabel) {
  return Math.max(labelWidth(farLabel), labelWidth('maali')) / 2 + 1;
}

// The strip is a plan view with the lane running across the page, so paint
// laid across the lane stands upright here. Each shape's width decides
// whether the glyph row fits under the tapes (tapeFigure).
const STRIP_SHAPES = {
  circle: { width: 10, draw: (cx, cy) => svgEl('circle', { cx, cy, r: 5 }) },
  rectangle: { width: 5, draw: (cx, cy) => svgEl('rect', { x: cx - 2.5, y: cy - 5, width: 5, height: 10 }) },
  square: { width: 8, draw: (cx, cy) => svgEl('rect', { x: cx - 4, y: cy - 4, width: 8, height: 8 }) },
  triangle: {
    width: 10,
    draw: (cx, cy) =>
      svgEl('polygon', {
        points: `${cx},${cy - 5} ${cx + 5},${cy + 5} ${cx - 5},${cy + 5}`,
        'stroke-linejoin': 'round',
      }),
  },
  line: { width: 3, draw: (cx, cy) => svgEl('rect', { x: cx - 1.5, y: cy - 5, width: 3, height: 10 }) },
};

// Draws an aitaviesti's taping strip, a lane per direction (docs/hurdles.md,
// "Aitaviesti").
function shuttleTapeFigure(distance, tapes, names, flip, onFlip) {
  return tapeFigure(distance, tapes, { names, flip, onFlip });
}

// Draws the one-lane strip of an individual setting that is taped out
// (hurdleTapes, lib/hurdles.js). That race starts at the far end, which is
// named lähtö.
function hurdleTapeFigure(distance, tapes, flip, onFlip) {
  return tapeFigure(distance, tapes, { flip, onFlip });
}

// Draws a taping strip to scale. With `names` it is an aitaviesti's two
// lanes, the far end named by its distance (docs/hurdles.md, "Aitaviesti").
// Without them it is one lane that starts at lähtö.
function tapeFigure(distance, tapes, { names, flip, onFlip }) {
  const farLabel = names ? `${distance} m` : 'lähtö';
  // The left end's line stands M in from the edge. The right margin R holds
  // half the right end's centred label, or the band names beside it.
  const M = 8;
  const R = Math.ceil(
    Math.max(endLabelHalf(farLabel), names ? 6 + Math.max(labelWidth(names.evenLegs), labelWidth(names.oddLegs)) : 0),
  );
  const S = Math.min(12, (appColumnWidth() - M - R) / distance);
  const x = (m) => (flip ? M + (distance - m) * S : M + m * S);
  // The left end's label starts at the page edge, so its line stands at M
  // whatever the label says.
  const endLabel = (m, text) =>
    svgEl(
      'text',
      m === (flip ? distance : 0)
        ? { x: x(m) - M, y: 12, class: 'shuttle-dim-label' }
        : { x: x(m), y: 12, 'text-anchor': 'middle', class: 'shuttle-dim-label' },
      text,
    );
  const dir = flip ? -1 : 1;
  const lanes = names
    ? [
        { tape: 20, foot: 40 },
        { tape: 48, foot: 68 },
      ]
    : [{ tape: 20, foot: 40 }];
  const evenLane = flip && names ? lanes[1] : lanes[0];
  const oddLane = flip && names ? lanes[0] : lanes[1];
  const Y = 22 + 28 * lanes.length;
  const width = Math.round(M + distance * S + R);
  const marks = tapes.map((t) => hurdleMarkGlyph(t.mark));
  const widest = Math.max(0, ...marks.filter(Boolean).map((g) => STRIP_SHAPES[g.shape].width));
  const pitch = Math.min(Infinity, ...tapes.slice(1).map((t, i) => (t.at - tapes[i].at) * S));
  const tier = widest > 0 && pitch >= widest + 4;
  const numY = tier ? Y + 30 : Y + 18;
  const height = tier ? Y + 50 : Y + 38;
  const kids = [
    svgEl('line', { x1: x(0), y1: Y, x2: x(distance), y2: Y, class: 'shuttle-measure' }),
    svgEl('line', { x1: x(0), y1: 16, x2: x(0), y2: Y + 6, class: 'shuttle-end' }),
    svgEl('line', { x1: x(distance), y1: 16, x2: x(distance), y2: Y + 6, class: 'shuttle-end' }),
    endLabel(0, farLabel),
    endLabel(distance, 'maali'),
    names
      ? svgEl('text', { x: M + distance * S + 6, y: evenLane.tape + 15, class: 'shuttle-lane-name' }, names.evenLegs)
      : null,
    names
      ? svgEl('text', { x: M + distance * S + 6, y: oddLane.tape + 15, class: 'shuttle-lane-name' }, names.oddLegs)
      : null,
  ];
  const spans = tapes.map((t, i) => ({ from: i ? tapes[i - 1].at : 0, to: t.at, gap: t.gap }));
  const last = tapes[tapes.length - 1];
  spans.push({ from: last.at, to: distance, gap: Math.round((distance - last.at) * 100) / 100 });
  const tiered = spans.some((s) => (s.to - s.from) * S < 36);
  spans.forEach((s, i) =>
    kids.push(
      svgEl(
        'text',
        {
          x: x((s.from + s.to) / 2),
          y: numY + (tiered && i % 2 ? 14 : 0),
          'text-anchor': 'middle',
          class: 'shuttle-num',
        },
        fiNum(s.gap),
      ),
    ),
  );
  tapes.forEach((t, i) => {
    const g = tier && marks[i];
    const legs = t.legs || [2];
    kids.push(svgEl('line', { x1: x(t.at), y1: Y - 4, x2: x(t.at), y2: g ? Y : Y + 4, class: 'shuttle-tick' }));
    if (g)
      kids.push(
        svgEl('g', { class: `shuttle-mark hurdle-mark-${g.colour}` }, STRIP_SHAPES[g.shape].draw(x(t.at), Y + 7)),
      );
    if (legs.some((l) => l % 2 === 0)) {
      kids.push(svgEl('rect', { x: x(t.at) - 1.5, y: evenLane.tape, width: 3, height: 22, class: 'shuttle-tape' }));
      kids.push(
        svgEl('line', {
          x1: x(t.at) - 1.5 * dir,
          y1: evenLane.foot,
          x2: x(t.at) - 9.5 * dir,
          y2: evenLane.foot,
          class: 'shuttle-foot',
        }),
      );
    }
    if (legs.some((l) => l % 2)) {
      kids.push(svgEl('rect', { x: x(t.at) - 1.5, y: oddLane.tape, width: 3, height: 22, class: 'shuttle-tape' }));
      kids.push(
        svgEl('line', {
          x1: x(t.at) + 1.5 * dir,
          y1: oddLane.foot,
          x2: x(t.at) + 9.5 * dir,
          y2: oddLane.foot,
          class: 'shuttle-foot',
        }),
      );
    }
  });
  return el(
    'div',
    {
      class: 'shuttle-tapes',
      role: 'button',
      tabindex: '0',
      'aria-label': 'Käännä kuva toisin päin',
      onclick: onFlip,
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onFlip();
        }
      },
    },
    svgEl(
      'svg',
      {
        width,
        height,
        viewBox: `0 0 ${width} ${height}`,
        role: 'img',
        'aria-label': names ? 'Aitojen paikat molempiin suuntiin' : 'Aitojen paikat',
      },
      kids,
    ),
  );
}

// Makes figure rows for one shared table, all redrawn together on a flip or a
// resize. `flipOf` reads which way they face and `toggle` turns them. The day
// sheet stores that per meet, and the table page keeps it for the page alone.
function sheetFigures(flipOf, toggle) {
  const rebuilds = [];
  const onFlip = () => {
    toggle();
    for (const build of rebuilds) build();
  };
  const row = (render) => {
    const wrap = el('div', {});
    const build = () => wrap.replaceChildren(...render(flipOf(), onFlip));
    build();
    rebuilds.push(build);
    redrawOnResize(wrap, build);
    return el('tr', {}, el('td', { class: 'aidat-figure', colspan: '5' }, wrap));
  };
  return { row };
}

// --- A Juoksut page's kenttä, title menu and setup box ---

// Builds the meet view's kenttä select. Until a kenttä is chosen, the season
// sets the length (storedTrack). A change re-renders the day list.
async function trackSelect(compId, when) {
  const venues = await loadVenues();
  const trackSel = el(
    'select',
    {
      // A visible label would wrap a phone's bar (dev/probe-aidat.js).
      'aria-label': 'Kenttä',
      onchange: () => {
        const venue = venues.find((v) => `v:${v.id}` === trackSel.value);
        saveVenue(compId, venue?.id || null);
        saveTrack(compId, venue ? venue.length : Number(trackSel.value));
        render(true);
      },
    },
    // The plain choices are the season's two lengths. A hall's own lap length
    // comes with its kenttä.
    el(
      'optgroup',
      { label: 'Yleiset' },
      [400, 200].map((t) => el('option', { value: String(t) }, `${t} m`)),
    ),
    // Each locality is a group heading, which keeps the select narrow
    // (docs/venues.md, "The files").
    venueGroups(venues).map((g) =>
      el(
        'optgroup',
        { label: g.locality },
        g.venues.map((v) => el('option', { value: `v:${v.id}` }, v.name)),
      ),
    ),
  );
  // A stored kenttä missing from the index falls back to the stored length.
  const chosen = venues.find((v) => v.id === storedVenue(compId));
  const pick = chosen ? chosen.id : String(storedTrack(compId, when));
  trackSel.value = chosen ? `v:${pick}` : pick;
  return { pick, el: el('label', { class: 'track-pick' }, trackSel) };
}

// Returns the meet view's own title menu rows. The kenttä link sets the same
// kenttä on another device (docs/venues.md). Päivän aidat checks the whole day
// for a hurdle start, run or not, because its sheet covers the whole day.
function dayMenuRows(compId, date, groups, pick) {
  return [
    { label: 'Jaa kenttälinkki', onclick: () => copyAppLink(`/c/${compId}/k/${pick}`) },
    ...(groups.some((g) => isHurdleStart(g.event))
      ? [{ label: 'Päivän aidat', href: hurdleSheetPath(compId, date) }]
      : []),
    tablePageRow(compId),
  ];
}

// Returns a hurdle start's setup box, or null where the tables have none.
async function setupBox(detailed, hasAnyResults, groupKey, compId) {
  const [table, venue] = await Promise.all([loadHurdleTable(), loadChosenVenue(compId)]);
  const vtable = table && venueTable(table, venue);
  return (
    (vtable &&
      (hurdleBox(detailed, vtable, hasAnyResults, groupKey, venue, compId) ||
        shuttleBox(detailed, vtable, hasAnyResults, groupKey, venue, compId) ||
        steepleBox(detailed, vtable, hasAnyResults, groupKey))) ||
    null
  );
}

// --- The day's hurdle lines ---

// Builds one setting's line on the day list (docs/hurdles.md,
// "The day's lines"). `withCats` starts the line with its classes, muted, for a
// start of several classes.
function hurdleLine({ setup, mark, lanes, categories }, venueName, withCats = false) {
  const head = withCats ? [el('span', { class: 'hurdle-lead' }, `${categories.join(', ')}: `)] : [];
  if (!setup) return [...head, el('span', { class: 'hurdle-none' }, 'Tuntematon sarja')];
  const bits = [
    lanes.length ? laneRange(lanes) : null,
    hurdleHeight(setup),
    mark ? el('span', {}, markParts(setup, mark, venueName)) : null,
    `${setup.count} aitaa`,
  ];
  // The mitat are muted only behind a mark, as in the box (hurdleSettingRow).
  return lineItems(head, bits, hurdleDims(setup), !!mark);
}

// Lays a line's parts out as the flex items of .hurdle-line (public/index.html),
// the mitat last and muted only behind a mark.
function lineItems(head, bits, dims, muted) {
  return [
    ...head,
    ...bits.filter(Boolean).map((b) => el('span', { class: 'hurdle-bit' }, b)),
    dims ? el('span', { class: muted ? 'hurdle-dims hurdle-dim' : 'hurdle-dims' }, dims) : null,
  ];
}

// Builds a steeple bar's line on the day list, shaped like hurdleLine's.
function steepleLine({ setup, mark, categories }, multiClass) {
  const head = multiClass ? [el('span', { class: 'hurdle-lead' }, `${categories.join(', ')}: `)] : [];
  if (!setup) return [...head, el('span', { class: 'hurdle-none' }, 'Tuntematon sarja')];
  return lineItems(head, [hurdleHeight(setup), mark ? el('span', {}, markParts(setup, mark, '')) : null], null);
}

function steepleRowLines(info, named) {
  return info.rows.map((r) => el('div', { class: 'row-sub hurdle-line' }, steepleLine(r, named)));
}

// Builds a hurdle start's setting lines for its schedule row (docs/hurdles.md,
// "The day's lines"). The lines of a perHeat start leave the lanes out.
function hurdleRowLines(info, venueName, named) {
  return info.rows.map((r) =>
    el('div', { class: 'row-sub hurdle-line' }, hurdleLine(info.perHeat ? { ...r, lanes: [] } : r, venueName, named)),
  );
}

// Builds a relay setting's line, shaped like hurdleLine's. Before the draw the
// legs stand where the lanes would. They are left out when the setting covers
// all four.
function shuttleLine(r, venueName, multiClass) {
  const cats = r.class || (multiClass ? r.categories.join(', ') : null);
  const head = cats ? [el('span', { class: 'hurdle-lead' }, `${cats}: `)] : [];
  const bits = [
    r.lanes.length ? laneRange(r.lanes) : r.legs.length === 4 ? null : `os ${legsText(r.legs)}`,
    hurdleHeight(r),
    r.mark ? el('span', {}, shuttleMarkParts(r, venueName)) : null,
    `${r.count} aitaa`,
  ];
  return lineItems(head, bits, hurdleDims(r), !!r.mark);
}

function shuttleRowLines(info, venueName, named) {
  return [
    ...info.rows.map((r) => el('div', { class: 'row-sub hurdle-line' }, shuttleLine(r, venueName, named))),
    ...info.missing.map((label) =>
      el('div', { class: 'row-sub hurdle-line' }, hurdleLine({ setup: null, categories: [label] }, venueName, named)),
    ),
  ];
}

// Gathers the day's setups for its schedule lines and its sheet. Hurdle and
// relay starts fetch their event details for the drawn lanes. Steeple starts
// fetch nothing. The result is null for a day with no such start or no tables.
async function hurdleDayInfos(compId, groups, store) {
  const hurdled = groups.filter((g) => hurdleDistance(g.event) != null);
  const relays = groups.filter((g) => hurdleRelayLeg(g.event) != null);
  const steeples = groups.filter((g) => steepleDistance(g.event) != null);
  if (!hurdled.length && !relays.length && !steeples.length) return null;
  const [table, venue] = await Promise.all([loadHurdleTable(), loadChosenVenue(compId)]);
  const vtable = table && venueTable(table, venue);
  if (!vtable) return null;
  const detailed = await Promise.all([...hurdled, ...relays].map((g) => roundDetails(g.entries, store)));
  const infos = new Map();
  hurdled.forEach((g, i) => {
    const info = hurdleStartSetups(detailed[i], vtable);
    if (info) infos.set(g.key, { kind: 'hurdles', info });
  });
  relays.forEach((g, i) => {
    const info = shuttleStartRows(
      detailed[hurdled.length + i].map((e) => ({ label: e.label, round: e.schedRound, drawn: e.round })),
      vtable,
    );
    if (info) infos.set(g.key, { kind: 'relay', info });
  });
  for (const g of steeples) {
    const info = steepleStartRows(g.entries, vtable);
    if (info) infos.set(g.key, { kind: 'steeple', info });
  }
  return { venue, infos };
}

// Builds the setting lines for the day's schedule rows, keyed by start.
// `named` means the lines carry the classes, so the row drops its own category
// line (plainGroupRow). A start already run gets no lines and pays no fetch.
async function hurdleDayLines(compId, groups, store) {
  const day = await hurdleDayInfos(
    compId,
    groups.filter((g) => !startFinished(g.entries)),
    store,
  );
  const lines = new Map();
  const venueName = venueFullName(day?.venue);
  for (const [key, { kind, info }] of day?.infos || []) {
    const named = info.rows.length + (info.missing?.length || 0) > 1;
    lines.set(key, {
      lines:
        kind === 'relay'
          ? shuttleRowLines(info, venueName, named)
          : kind === 'steeple'
            ? steepleRowLines(info, named)
            : hurdleRowLines(info, venueName, named),
      named,
    });
  }
  return lines;
}

// --- The day's hurdle sheet ---

// Renders one day's setups as a page to print and tape from, at
// /c/<id>/aidat/<YYYY-MM-DD> (docs/hurdles.md, "The day sheet").
async function renderHurdleSheet(compId, date) {
  const seq = renderSeq;
  setBack(dayPath(compId, date));
  const [props, schedule] = await Promise.all([fetchCompProps(compId), fetchSchedule(compId)]);
  if (seq !== renderSeq) return;
  setTitleMenu(`${props?.Competition?.Name || `Kilpailu ${compId}`} · ${date}`, [tablePageRow(compId)]);
  setScrollKey(`aidat:${compId}:${date}`);
  const groups = groupRounds(schedule[date] || []);
  const day = await hurdleDayInfos(compId, groups, eventStoreFor(compId, schedule));
  if (seq !== renderSeq) return;
  const starts = groups.map((g) => ({ g, ...day?.infos.get(g.key) })).filter((s) => s.info);
  if (!starts.length) {
    // A null day with hurdle starts means the tables failed to load. It must
    // not read as a day with no hurdle starts.
    appEl.replaceChildren(
      !day && groups.some((g) => isHurdleStart(g.event))
        ? el('div', { class: 'notice error' }, 'Aitataulukot eivät latautuneet.')
        : el('div', { class: 'notice' }, 'Ei aitalähtöjä tänä päivänä.'),
    );
    return;
  }
  const venueName = venueFullName(day.venue);
  const figures = sheetFigures(
    () => storedFlip(compId),
    () => saveFlip(compId, !storedFlip(compId)),
  );
  const figureRow = figures.row;
  // The whole day is one table with a tbody per block, so every start's
  // Korkeus stands in one column.
  const bodies = hurdleSheetBlocks(starts).map(({ starts: run, kind, info }) => {
    const cats = info.rows.length > 1;
    const title = run.map(({ g }) =>
      el(
        'div',
        {},
        `${timeFmt.format(parseTs(g.ts))} · ${g.event}`,
        el('span', { class: 'aidat-cats' }, ` · ${g.entries.map((e) => e.label).join(', ')}`),
      ),
    );
    const kids = [el('tr', { class: 'aidat-title' }, el('th', { colspan: '5', scope: 'rowgroup' }, title))];
    if (kind === 'steeple') {
      kids.push(setupHeadRow('Sarja', true), ...info.rows.map(steepleSettingRow));
    } else if (kind === 'relay') {
      const { lead, trs } = shuttleSettingRows(
        info.rows,
        info.missing,
        venueName,
        cats || !info.rows.some((r) => r.lanes.length),
      );
      kids.push(setupHeadRow(lead), ...trs);
      if (info.rows.length) kids.push(figureRow((flip, flipFn) => shuttleFigure(info, flip, flipFn)));
    } else {
      for (const b of hurdleSetupBlocks(info)) {
        kids.push(setupHeadRow(b.drawn ? 'Radat' : 'Sarja'), ...hurdleBlockRows(b, venueName, cats).flat());
      }
    }
    if (kind === 'hurdles') {
      kids.push(
        ...info.rows
          .filter((r) => r.tapes)
          .map((r) => figureRow((flip, flipFn) => hurdleFigure(info, r, flip, flipFn))),
      );
    }
    return el('tbody', {}, kids);
  });
  appEl.replaceChildren(
    ...[
      // The printed sheet names the chosen kenttä, as paper has no select.
      day.venue ? el('div', { class: 'aidat-venue' }, venueName) : null,
      el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl setup-tbl aidat-tbl' }, bodies)),
    ].filter(Boolean),
  );
}

export {
  activateVenueLink,
  dayMenuRows,
  hurdleBox,
  hurdleDayLines,
  hurdleSettingRow,
  hurdleTapeFigure,
  loadChosenVenue,
  loadHurdleTable,
  loadVenue,
  loadVenues,
  renderHurdleSheet,
  saveTrack,
  saveVenue,
  setupBox,
  setupHeadRow,
  sheetFigures,
  shuttleBox,
  shuttleFigure,
  shuttleSettingRows,
  steepleBox,
  steepleSettingRow,
  storedTrack,
  storedVenue,
  tablePageRow,
  tablePageSection,
  trackSelect,
};
