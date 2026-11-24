// Checks Uusimmat on the day list (docs/views.md, "Uusimmat"). The demo never
// changes, so the probe makes a change by editing the stored snapshot. The
// stubbed Watch follows the demo's club, because its athletes have marks.
//   dev/probe.html?probe=probe-latest
export default async function probe({ D, W, log, ok, appJs, demoJs, settle }) {
  for (const k of ['kisatCompView', 'kisatLatest']) W.localStorage.removeItem(k);
  // The clock stands at 23:00, after every demo start, so every document with
  // a mark has a Last-Modified (demoModifiedAt, demo.js).
  const late = new W.Date();
  late.setHours(23, 0, 0, 0);
  const realNow = W.Date.now;
  W.Date.now = () => late.getTime();
  const realFetchJson = appJs.fetchJson;
  appJs.setFetchJson(async (url, opts) =>
    url === '/api/watch/wlatest'
      ? { label: 'Uusimmat', entries: [{ type: 'club', id: '1', name: 'Demon Urheilijat', enabled: true }] }
      : realFetchJson(url, opts),
  );
  const segBtn = (label) =>
    [...D.querySelectorAll('.filter-bar .seg-btn')].find((b) => b.firstChild?.textContent === label);
  const press = async (label) => {
    segBtn(label).click();
    await settle();
  };
  const stored = () => JSON.parse(W.localStorage.getItem('kisatLatest') || '{}');

  appJs.setActiveFollow('wlatest');
  appJs.navigate('/c/demo');
  await settle();

  // --- The first render guesses every time ---
  // The demo is dated today (demo.js), so its day list offers Uusimmat.
  ok('the day list offers Uusimmat today', !!segBtn('Uusimmat'));
  const [dayKey] = Object.keys(stored());
  const keys = Object.keys(stored()[dayKey]?.lines || {});
  ok('the first render stored a snapshot', dayKey?.startsWith('demo:') && keys.length > 2);
  ok(
    'every line of it a guess',
    keys.every((k) => stored()[dayKey].lines[k].approx),
  );
  ok('a guess lights no dot', !D.querySelector('.seg-dot'));

  // --- A change found in Seuratut ---
  // The changed line shares its round with another followed line, so the
  // row has a line to dim.
  const round = (k) => k.split(':')[0];
  const changed = keys.find((k) => keys.some((o) => o !== k && round(o) === round(k)));
  ok('the demo has a round of two followed lines', !!changed);
  const snapshot = stored();
  snapshot[dayKey].lines[changed].fp = 'changed';
  W.localStorage.setItem('kisatLatest', JSON.stringify(snapshot));
  // A real change comes with a new Last-Modified.
  demoJs.DEMO_WRITES.set(round(changed), W.Date.now());
  await appJs.render(true);
  await settle();
  ok('lights the dot on Uusimmat', !!segBtn('Uusimmat')?.querySelector('.seg-dot'));

  // --- Uusimmat ---
  await press('Uusimmat');
  const rows = [...D.querySelectorAll('#app > .list > a.row')];
  ok('lists the changed start first', !!rows[0] && rows.length > 1);
  ok(
    'and tints that row alone',
    rows[0].classList.contains('watched') && rows.slice(1).every((r) => !r.classList.contains('watched')),
  );
  // The left column is the start's time, as in the other modes, and the class
  // line gives the change's age. The key in the row's link holds the start's
  // time. (Break on purpose: pass rowHeadParts the change's time as the row's
  // time.)
  const startTime = (r) => {
    const t = new W.Date(decodeURIComponent(r.getAttribute('href')).split('/g/')[1].split('|')[0]);
    return `${String(t.getHours()).padStart(2, '0')}.${String(t.getMinutes()).padStart(2, '0')}`;
  };
  const sub = (r) => r.querySelector('.row-sub')?.textContent || '';
  log(`rows: ${rows.map((r) => `${r.querySelector('.row-time')?.textContent} ${sub(r)}`).join(' | ')}`);
  ok(
    "every row shows its start's time",
    rows.every((r) => r.querySelector('.row-time')?.textContent === startTime(r)),
  );
  ok('and the age of the change', sub(rows[0]).endsWith(' · juuri nyt'));
  // A row whose change came before the first render shows the age of the
  // document's Last-Modified (demoModifiedAt, demo.js). (Break on purpose: stop
  // setting lastModified for a demo document in fetchJson.)
  ok(
    'and every other row the age of its last write',
    rows.slice(1).every((r) => / t sitten$/.test(sub(r))),
  );
  const lines = [...rows[0].querySelectorAll('.watch-row-athlete')];
  // (Break on purpose: dim no line in latestRows.)
  ok(
    'and dims every line of it but the changed one',
    lines.length > 1 && lines.filter((l) => !l.classList.contains('latest-old')).length === 1,
  );
  ok('no line of an untinted row is dimmed', !D.querySelector('a.row:not(.watched) .latest-old'));
  ok('has neither day tabs nor Ottelut', !D.querySelector('.days') && !D.querySelector('details.fold'));

  // --- Back in Seuratut ---
  await press('Seuratut');
  // (Break on purpose: drop the seenAt write from trackLatest.)
  ok('the dot is gone once Uusimmat was on screen', !D.querySelector('.seg-dot'));

  demoJs.DEMO_WRITES.clear();
  W.Date.now = realNow;
  appJs.setFetchJson(realFetchJson);
  appJs.setActiveFollow(null);
}
