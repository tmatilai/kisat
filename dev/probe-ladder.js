// Checks a ladder's width on a laptop and at the grid's narrowest
// (docs/views.md, "Tables and ladders"). The names take the slack up to
// LADDER_NAME_MAX_PX, the attempt columns stay 62 px and the heats line up.
// The Q/q badge sits on the mark's line. It sizes its own iframe.
//   dev/probe.html?probe=probe-ladder
// Every demo name fits 150 px, so the wrap counts pass without the bounds and
// the column widths are the guard. Live, the rows of one throw's ladder and
// one jump's took two or three lines at 150 px and one at 320 (2026-08).
export default async function probe({ frame, D, log, ok, wait, groupKey, appJs, settle }) {
  const KEYS = {
    kuula: groupKey(12, 30, 'Kuula'),
    karsinta: groupKey(11, 0, 'Pituus'),
    korkeus: groupKey(13, 30, 'Korkeus'),
  };
  const open = async (name) => {
    appJs.navigate(`/c/demo/g/${encodeURIComponent(KEYS[name])}`);
    await settle();
  };
  const size = async (w) => {
    frame.width = w;
    frame.height = 900;
    await wait(200);
  };
  // A finished round opens on the merged table (defaultResultView,
  // lib/schedule.js), so the heats that must line up are behind the Erät tap.
  const tap = async (label) => {
    [...D.querySelectorAll('#app .seg-btn')].find((b) => b.textContent === label)?.click();
    await settle();
  };
  const wide = (el) => Math.round(el.getBoundingClientRect().width);
  const tables = () => [...D.querySelectorAll('.tbl.ladder')];
  // Measures one table's columns and counts what in it wraps or overflows.
  const shape = (t) => {
    const rows = [...t.querySelectorAll('tbody tr')];
    const nameCells = rows.map((r) => r.querySelector('td.cell-name'));
    const resCells = rows.map((r) => r.querySelector('td.result'));
    return {
      table: wide(t),
      cols: [...t.querySelectorAll('thead th')].map(wide),
      name: wide(t.querySelector('th.name')),
      att: [...t.querySelectorAll('thead th.att')].map(wide),
      result: wide(t.querySelector('thead th.result')),
      scrolls: t.scrollWidth > t.closest('.tbl-wrap').clientWidth + 1,
      // The club and its asides take a second line by design, so this reads
      // the name's own line and not the cell.
      wrappedNames: nameCells.filter((c) => {
        const line = c.querySelector('a, span') || c.firstElementChild;
        return line && line.getBoundingClientRect().height > 22;
      }).length,
      // Counts the badges pushed below the cell's first line.
      strayBadges: resCells.filter((c) => {
        const b = c.querySelector('.q-badge');
        return b && b.getBoundingClientRect().top > c.getBoundingClientRect().top + 14;
      }).length,
      // .result is white-space: nowrap, so a mark too wide for the column
      // runs into the next one.
      overflow: resCells.filter((c) => c.scrollWidth > c.clientWidth + 1).length,
    };
  };

  // --- A laptop spends its spare width on the names ---
  await size(1440);
  await open('kuula');
  let s = shape(tables()[0]);
  log(`Kuula 1440: table ${s.table} name ${s.name} att ${s.att.join(',')} result ${s.result}`);
  ok('Kuula table grows past its 150px-name minimum', s.table > 80 + 150 + 64 + s.att.length * 62);
  ok('Kuula name column takes the slack', s.name >= 300);
  ok(
    'Kuula attempt columns stay 62px',
    s.att.every((w) => w === 62),
  );
  ok('Kuula names fit one line', s.wrappedNames === 0);
  ok('Kuula table does not scroll', !s.scrolls);

  // --- ...but not without bound, and the heats still line up ---
  await open('karsinta');
  await tap('Erät');
  const both = tables().map(shape);
  log(`Pituus 1440: ${both.map((t) => `[${t.table} name ${t.name}]`).join(' ')}`);
  ok('Karsinta renders both heats', both.length === 2);
  ok('both heats land their columns identically', both[0].cols.join() === both[1].cols.join());
  ok(
    'name column stops at its cap',
    both.every((t) => t.name === 320),
  );
  ok(
    'names fit one line',
    both.every((t) => t.wrappedNames === 0),
  );

  // --- The bar-height grid is the same table ---
  await open('korkeus');
  s = shape(tables()[0]);
  log(`Korkeus 1440: table ${s.table} name ${s.name} att ${s.att.join(',')}`);
  ok(
    'Korkeus height columns stay 62px',
    s.att.every((w) => w === 62),
  );
  ok('Korkeus name column takes the slack', s.name >= 300);

  // --- The floor holds where there is nothing to spare ---
  // 700 px is the narrowest grid, as cards show below it (index.html). No
  // demo round is wide enough to scroll here, so the check is on the 150 px
  // floor that the table's min-width keeps for the name.
  await size(700);
  await open('karsinta');
  await tap('Erät');
  const narrow = tables().map(shape);
  log(`Pituus 700: ${narrow.map((t) => `[${t.table} name ${t.name}]`).join(' ')}`);
  ok(
    'name column keeps its 150px floor',
    narrow.every((t) => t.name >= 150),
  );
  ok('heats still line up when narrow', narrow[0].cols.join() === narrow[1].cols.join());

  // --- The Q/q badge rides on the mark, not under the wind ---
  await size(1440);
  await open('karsinta');
  await tap('Erät');
  const badges = tables().flatMap((t) => [...t.querySelectorAll('tbody .q-badge')]);
  const withWind = tables().flatMap((t) => [...t.querySelectorAll('tbody td.result .att-wind')]);
  log(`Pituus badges ${badges.length}, wind readings ${withWind.length}`);
  ok('the fixture has badges beside a wind reading', badges.length >= 3 && withWind.length >= 3);
  ok(
    'no badge on a line of its own',
    tables().every((t) => shape(t).strayBadges === 0),
  );
  ok(
    'no result cell overflows its column',
    tables().every((t) => shape(t).overflow === 0),
  );

  // --- The phone card is untouched ---
  await size(402);
  await open('karsinta');
  const cards = [...D.querySelectorAll('.ladder-card')];
  const cardStray = cards.filter((c) => {
    const res = c.querySelector('.ladder-card-head .result');
    const b = res?.querySelector('.q-badge');
    return b && b.getBoundingClientRect().top > res.getBoundingClientRect().top + 14;
  }).length;
  log(`Pituus 402: ${cards.length} cards`);
  ok('cards render instead of the grid', cards.length > 0 && !D.querySelector('.tbl.ladder')?.offsetParent);
  ok('no card badge on a line of its own', cardStray === 0);
}
