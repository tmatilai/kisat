// Checks the front page with a follow-list active (docs/home.md). It needs the
// Worker, and reads the meets that dev/probe.mjs seeds (workerKv) and the
// listing it answers for Tuloslista (LISTING).
//
//   dev/probe.html?probe=probe-home
//
// It creates a Watch of the demo club and activates it before home renders.
export default async function probe({ W, D, log, ok, wait, appJs, libJs, settle }) {
  const created = await W.fetch('/api/watch', {
    method: 'POST',
    headers: { 'x-kisat-client': '1' },
    body: JSON.stringify({
      label: 'DemU',
      entries: [{ type: 'club', id: '1', name: 'Demon Urheilijat' }],
    }),
  }).then((r) => r.json());
  const watchId = created.id;
  log(`watch: ${watchId}`);
  if (!watchId) return log('ERROR no Watch was created');

  // Seeds the keys the app writes. The registry row labels the chip, and the
  // remembered meet is outside the listing, so the sort check never reads it.
  const recent = JSON.stringify([{ id: 'probe', name: 'Probe recent', range: '1.–2.8.' }]);
  W.localStorage.setItem('kisatWatches', JSON.stringify([{ watchId, label: 'Probe' }]));
  W.localStorage.setItem('kisatFollow', JSON.stringify(watchId));
  W.localStorage.removeItem('kisatCompView');
  W.localStorage.setItem('kisatRecentComps', recent);
  appJs.navigate('/');
  await settle();
  appJs.navigate('/');
  await settle(); // the scan is a KV read, but the listing fetch is not

  const idsIn = (sel) =>
    [...D.querySelectorAll(`${sel} a`)].map((a) => a.getAttribute('href').match(/\/c\/(\w+)/)?.[1]);
  const headings = () => [...D.querySelectorAll('#app h2')].map((h) => h.textContent);
  const recentFold = () =>
    [...D.querySelectorAll('#app details.fold')].find((d) => d.firstChild.textContent === 'Viimeksi katsotut');
  ok('filter bar present on home', !!D.querySelector('.filter-bar'));
  // Home has no toggle between followed and all meets (docs/home.md).
  ok('no mode toggle rendered', D.querySelectorAll('.seg-btn').length === 0);
  log(`headings: ${JSON.stringify(headings())}`);
  ok('Seuratut comes first, then Kilpailut', /^Seuratut/.test(headings()[0]) && headings()[1] === 'Kilpailut');
  // (Break on purpose: open the fold by default, or draw it as an h2.)
  ok('"Viimeksi katsotut" shows while watching, folded', recentFold()?.open === false);

  const lines = [...D.querySelectorAll('.scan-athlete')];
  ok(`matched athlete lines rendered (${lines.length})`, lines.length > 0);

  // The heading names the window's first day, off the scan's own answer
  // (scanSince, lib/home.js). The scan is asked for the device's local day.
  const [listing, scan, feed] = await Promise.all([
    W.fetch('https://cached-public-api.tuloslista.com/live/v1/competition').then((r) => r.json()),
    W.fetch(`/api/scan/${watchId}?day=${new Date().toLocaleDateString('sv-SE')}`, {
      headers: { 'x-kisat-client': '1' },
    }).then((r) => r.json()),
    W.fetch('/calendar.json').then((r) => r.json()),
  ]);
  const since = D.querySelector('#app h2 .scan-since')?.textContent;
  log(`window from ${scan.from}, heading says "${since}"`);
  ok(
    "the heading names the window's first day",
    since === ` ${libJs.scanSince(scan)} alkaen` && /\d\.\d+\./.test(since),
  );

  // Kilpailut keeps the meets Seuratut shows, which are all recent.
  // (Break on purpose: leave the hits out of paint's pool.)
  const hitIds = idsIn('#app > div > .list');
  const watchedIds = idsIn('#app > .list');
  log(`Seuratut rows: ${hitIds.join(', ')}`);
  ok(
    `every Seuratut meet is in Kilpailut too (${hitIds.length})`,
    hitIds.length > 0 && hitIds.every((id) => watchedIds.includes(id)),
  );

  // A row is tinted where its meet runs today, and a match alone lights none.
  // (Break on purpose: tint every row with a match.)
  const todayFi = new Date().toLocaleDateString('fi-FI');
  const scanDays = new Map(scan.comps.map((c) => [String(c.id), c.days || []]));
  const hitRows = [...D.querySelectorAll('#app > div > .list a')];
  ok(
    'a Seuratut row is tinted exactly where its meet runs today',
    hitRows.every((a) => {
      const id = a.getAttribute('href').match(/\/c\/(\w+)/)?.[1];
      return a.classList.contains('watched') === scanDays.get(id).includes(todayFi);
    }),
  );

  // Kilpailut sorts newest first by meetSortValue (docs/home.md). This
  // re-sorts the ids by the real days from the feed and the scan, or by the
  // listing's Date without them. Both count whole days and keep a tie's order.
  const byId = new Map(listing.map((c) => [String(c.Id), c.Date]));
  const realDays = new Map(
    [...feed.comps, ...scan.comps].filter((c) => c.days?.length).map((c) => [String(c.id), c.days]),
  );
  const toIso = (fi) => {
    const [d, m, y] = fi.split('.');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  };
  const dayMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
  const now = dayMs(new Date().toLocaleDateString('sv-SE'));
  function sortValue(id) {
    const days = realDays.get(id);
    if (!days) return dayMs(String(byId.get(id)).slice(0, 10));
    return Math.min(Math.max(now, dayMs(toIso(days[0]))), dayMs(toIso(days[days.length - 1])));
  }
  // Seuratut sorts the same way. (Break on purpose: drop the sort from scanHits.)
  const hitSorted = [...hitIds].sort((a, b) => sortValue(b) - sortValue(a));
  ok(
    `Seuratut sorted descending by date value too (${hitIds.length} rows)`,
    JSON.stringify(hitIds) === JSON.stringify(hitSorted),
  );
  const listedIds = watchedIds.filter((id) => byId.has(id));
  const sortedDesc = [...listedIds].sort((a, b) => sortValue(b) - sortValue(a));
  ok(
    `Kilpailut sorted descending by date value (${listedIds.length} rows checked)`,
    JSON.stringify(listedIds) === JSON.stringify(sortedDesc),
  );

  // The fold's state is kept across renders (recentOpen, app/home.js).
  // (Break on purpose: drop the ontoggle.)
  recentFold().open = true;
  await wait(100);
  appJs.navigate('/');
  await settle();
  appJs.navigate('/');
  await settle();
  ok('"Viimeksi katsotut" opened stays open through a render', recentFold()?.open === true);
  recentFold().open = false;
  await wait(100);

  // The render above replaced the lines read before it.
  const drawn = [...D.querySelectorAll('.scan-athlete')];
  if (drawn.length) {
    // Measures the line's three columns at phone width (.scan-athlete,
    // public/index.html).
    const row = drawn[0];
    const cells = [...row.children];
    const cs = W.getComputedStyle(row);
    log(`grid columns: ${cs.gridTemplateColumns}`);
    for (const c of cells) {
      const r = c.getBoundingClientRect();
      log(`  ${c.className}: ${Math.round(r.width)}px "${c.textContent.slice(0, 28)}"`);
    }
    ok(
      'no column collapsed to zero width',
      cells.every((c) => c.getBoundingClientRect().width > 8),
    );
    ok('row does not overflow the viewport', row.getBoundingClientRect().right <= W.innerWidth + 1);
    ok('page does not scroll sideways', D.documentElement.scrollWidth <= W.innerWidth + 1);
    const names = drawn.map((l) => Math.round(l.querySelector('.scan-athlete-name').getBoundingClientRect().width));
    ok(`name column identical on every line (${[...new Set(names)].join('/')})`, new Set(names).size === 1);
  }

  // Three stub scans run under Watches of their own. probestub has three
  // meets pending, and each build round fills one a second later. The real
  // scan had nothing pending by the first read, warm KV or cold (2026-09).
  const line = { name: 'Ville Mallinen', club: 'DemU', events: ['M 100m'] };
  const matchesOf = {
    probestub: (n) => (n <= built ? [line] : null),
    probeempty: () => [],
    probestuck: (n) => (n === 1 ? null : []),
  };
  let built = 0;
  const stubScan = (id, build) =>
    new Promise((resolve) => {
      const slow = build && id === 'probestub';
      W.setTimeout(
        () => {
          if (slow) built += 1;
          const comps = [1, 2, 3].map((n) => ({
            id: 90000 + n,
            name: `Probe meet ${n}`,
            days: [todayFi],
            matches: matchesOf[id](n),
            stale: false,
          }));
          const from = new Date().toLocaleDateString('sv-SE');
          resolve({ from, comps, pending: comps.filter((c) => !c.matches).map((c) => c.id) });
        },
        slow ? 1000 : 0,
      );
    });
  const realFetchJson = appJs.fetchJson;
  appJs.setFetchJson((url, opts) => {
    const id = url.match(/^\/api\/scan\/(probe\w+)\?/)?.[1];
    return matchesOf[id] ? stubScan(id, url.includes('build=1')) : realFetchJson(url, opts);
  });
  // One render only, since a second one finds the loop running and shows
  // none of its rounds (docs/home.md).
  const useStub = async (id) => {
    W.localStorage.setItem('kisatWatches', JSON.stringify([{ watchId: id, label: 'Stub' }]));
    W.localStorage.setItem('kisatFollow', JSON.stringify(id));
    appJs.navigate('/');
    await settle();
  };
  const notices = () => [...D.querySelectorAll('#app .notice')].map((n) => n.textContent);
  await useStub('probestub');

  // A pending or stale meet starts the fill-in loop with no tap
  // (renderFillStatus, app/shell.js). The status clears at the end, and no
  // more than one status line is ever live. (Break on purpose: drop the
  // auto-start, call onUpdate only after the loop, or keep the key.)
  const initialStatus = D.querySelector('.scan-pending')?.textContent;
  log(`status right after load: ${initialStatus || '(nothing pending/stale)'}`);
  ok('the pending meets start the loop with no tap', !!initialStatus);
  // A meet not scanned yet has no row, so the notice waits for it.
  // (Break on purpose: drop scan.pending from scanSection's notice.)
  ok('no "Ei osallistumisia." while meets are pending', !notices().includes('Ei osallistumisia.'));
  const matchCounts = [D.querySelectorAll('.scan-athlete').length];
  let last = '(still running after the poll budget)';
  for (let i = 0; i < 40; i++) {
    await wait(400);
    const live = [...D.querySelectorAll('.scan-pending')];
    ok(`at most one status line live (poll ${i}: ${live.length})`, live.length <= 1);
    matchCounts.push(D.querySelectorAll('.scan-athlete').length);
    if (!live.length) {
      last = '(cleared)';
      break;
    }
    last = live[0].textContent;
    if (!last.startsWith('Päivitetään')) break;
  }
  log(`auto-refresh settled on: ${last}`);
  log(`matched athlete line count per poll: ${matchCounts.join(' -> ')}`);
  ok('the status clears once every meet is filled', last === '(cleared)');
  ok('rows filled in progressively, not only at the very end (bit by bit)', new Set(matchCounts).size > 2);

  // Nobody followed in any meet is one notice and no rows.
  await useStub('probeempty');
  log(`probeempty notices: ${JSON.stringify(notices())}`);
  ok(
    'nobody in any meet says "Ei osallistumisia."',
    notices().includes('Ei osallistumisia.') && !D.querySelector('#app > div > .list'),
  );

  // A loop that stops with a meet left offers a retry, and the notice still
  // waits (renderFillStatus). This stub answers at once, so the rounds run
  // out in no time. (Break on purpose: drop `unfinished = count() > 0`.)
  await useStub('probestuck');
  await wait(2000);
  const retry = [...D.querySelectorAll('.scan-pending')].map((el) => el.textContent);
  log(`probestuck status: ${JSON.stringify(retry)}`);
  ok('a loop out of rounds offers a retry', retry.length === 1 && retry[0] === 'Haku jäi kesken. Yritä uudelleen.');
  ok('...and no notice says nobody is in', !notices().includes('Ei osallistumisia.'));
  appJs.setFetchJson(realFetchJson);
  W.localStorage.setItem('kisatWatches', JSON.stringify([{ watchId, label: 'Probe' }]));
  W.localStorage.setItem('kisatFollow', JSON.stringify(watchId));

  // A meet's range from recentComps wins over the listing's Date in the plain
  // list (docs/home.md). The meet has no days from the feed or the scan,
  // since those override recentComps. The feed has the days of the meets near
  // today, so such a meet is behind "Näytä vanhemmat kilpailut".
  // (Break on purpose: drop knownRanges from renderHome's compRow.)
  const showOlder = () =>
    [...D.querySelectorAll('#app button')].find((b) => b.textContent.startsWith('Näytä vanhemmat'))?.click();
  const listRows = () => [...D.querySelectorAll('#app > .list a')];
  showOlder();
  const someId = listRows()
    .map((a) => a.getAttribute('href').match(/\/c\/(\w+)/)?.[1])
    .find((id) => byId.has(id) && !realDays.has(id));
  ok(`a listed meet has no days from the feed or the scan (${someId})`, !!someId);
  W.localStorage.setItem(
    'kisatRecentComps',
    JSON.stringify([{ id: someId, name: 'Probe range test', range: 'PROBE-RANGE-9.8.' }]),
  );
  appJs.navigate('/');
  await settle();
  appJs.navigate('/');
  await settle();
  showOlder();
  const row = listRows().find((a) => a.getAttribute('href') === `/c/${someId}`);
  ok(
    `known range from recentComps used in the full list (${row?.querySelector('.row-sub')?.textContent})`,
    row?.querySelector('.row-sub')?.textContent.startsWith('PROBE-RANGE-9.8.'),
  );

  // With no follow-list, the chip offers one and "Viimeksi katsotut" shows.
  // Kilpailut is the list it was under the follow-list (docs/home.md).
  // (Break on purpose: draw the bar only with state.watchId, or leave the
  // Seuratut meets out of paint's pool.)
  W.localStorage.removeItem('kisatFollow');
  W.localStorage.removeItem('kisatWatches');
  W.localStorage.removeItem('kisatCompView');
  W.localStorage.setItem('kisatRecentComps', recent);
  appJs.navigate('/');
  await settle();
  appJs.navigate('/');
  await settle();
  const chips = [...D.querySelectorAll('.filter-bar button')].map((b) => b.textContent);
  log(`bar buttons with nothing watched: ${JSON.stringify(chips)}`);
  ok('the chip reads "Ei seurantaa" once nothing is watched', chips.includes('Ei seurantaa ▾'));
  ok('no mode toggle while not watching either', D.querySelectorAll('.seg-btn').length === 0);
  log(`headings: ${JSON.stringify(headings())}`);
  ok('no Seuratut while not watching', headings()[0] === 'Kilpailut');
  ok('"Viimeksi katsotut" shown while not watching, folded', recentFold()?.open === false);
  const plainIds = idsIn('#app > .list');
  ok(
    `Kilpailut is the same list with and without a follow-list (${plainIds.length} rows)`,
    JSON.stringify(plainIds) === JSON.stringify(watchedIds),
  );
}
