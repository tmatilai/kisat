// Checks a follow-list created and edited from the front page, where no meet
// is open. The picker searches GET /api/search with no meet named, and
// "Muokkaa" fetches the Watch record on the tap. Home's help sheet explains
// the list.
//   dev/probe.html?probe=probe-clubs&url=%23/
// It needs the Worker, and the search reads the club and athlete indexes that
// dev/probe.mjs seeds (workerKv). The scan is stubbed empty with nothing
// pending. On a cold KV
// renderFillStatus (app/shell.js) would run up to MAX_BUILD_ROUNDS ×
// SCAN_BUILD_LIMIT roster builds.
export default async function probe({ W, D, log, ok, wait, appJs, settle }) {
  const sheetRows = () => [...D.querySelectorAll('.sheet .list .row')];
  const sheetButton = (text) => [...D.querySelectorAll('.sheet button')].find((b) => b.textContent.includes(text));
  // A menu's items are rows, not buttons (openMenu, app/shell.js).
  const menuRow = (text) => [...D.querySelectorAll('.sheet .menu .row')].find((r) => r.textContent.includes(text));

  const realFetch = W.fetch.bind(W);
  W.fetch = (url, opts) =>
    String(url).startsWith('/api/scan/')
      ? Promise.resolve(
          new W.Response(
            JSON.stringify({
              day: '2026-08-10',
              from: '2026-08-08',
              to: '2026-10-09',
              comps: [],
              pending: [],
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
        )
      : realFetch(url, opts);

  for (const k of Object.keys(W.localStorage)) {
    if (k.startsWith('kisatWatchEdit:') || k === 'kisatWatches' || k === 'kisatCompView' || k === 'kisatFollow') {
      W.localStorage.removeItem(k);
    }
  }
  appJs.navigate('/');
  await settle();
  appJs.navigate('/');
  await settle();

  ok('landed on home', W.location.pathname === '/');
  const selectBtn = [...D.querySelectorAll('.filter-bar button')].find((b) => b.textContent.includes('Ei seurantaa'));
  ok('home has the selector chip with no list active', !!selectBtn);

  // --- Home's help sheet explains the follow-list ---
  // The Watch menu carries no prose (dev/probe.js), so what no action's name
  // can say goes here. The help is a dialog and not a menu.
  {
    const help = D.getElementById('help');
    ok('home offers the ? at all', !help.hidden);
    help.click();
    await settle();
    const text = D.querySelector('.sheet .help-text')?.textContent || '';
    log(`help paragraphs: ${D.querySelectorAll('.sheet .help-text p').length}`);
    ok('it is a dialog, not a menu', !D.querySelector('.sheet-menu'));
    // An edit link carries the token to another device, so the help must not
    // call a list editable on one device only.
    ok('and no longer claims a list is editable on one device only', !text.includes('vain sillä laitteella'));
    ok(
      'the whole sheet fits without scrolling at phone height',
      D.querySelector('.sheet-card').scrollHeight <= D.querySelector('.sheet-card').clientHeight,
    );
    D.querySelector('.sheet-close').click();
    await wait(200);
  }

  // --- The front page offers a new list ---
  selectBtn.click();
  await settle();
  const createRow = menuRow('Uusi seuranta');
  ok('the menu offers "+ Uusi seuranta" on home', !!createRow);
  createRow.click();
  await settle();
  ok('create sheet opened with nothing to wait for', !!D.querySelector('.sheet .watch-create input[type="search"]'));

  // --- The two indexes answer the search, with no competition open ---
  const search = D.querySelector('.sheet input[type="search"]');
  const type = async (s) => {
    search.value = s;
    search.dispatchEvent(new W.Event('input', { bubbles: true }));
    await settle(300); // waits out the debounce and GET /api/search
  };
  await type('Demon');
  const clubRows = sheetRows().filter((r) => r.querySelector('.row-title')?.textContent.includes('Demon'));
  log(`"Demon" rows: ${clubRows.map((r) => r.querySelector('.row-title').textContent).join(' | ')}`);
  ok('the club index answers with no meet open', clubRows.length === 1);

  // (Break on purpose: set SEARCH_MIN_CHARS to 1, and a single letter lists
  // the whole register.)
  await type('a');
  log(`one letter answers: "${D.querySelector('.watch-search-results .notice')?.textContent}"`);
  ok('a single letter lists nobody', sheetRows().length === 0);

  // The athlete index lets the front page find a person.
  {
    await type('Mittainen');
    const people = sheetRows().filter((r) => r.querySelector('.row-sub')?.textContent !== 'Seura');
    log(`"Mittainen" gives ${sheetRows().length} rows, ${people.length} of them people`);
    ok('a name searched from home finds people', people.length > 0);
    ok(
      'and each carries the club it was indexed under',
      people.every((r) => r.querySelector('.row-sub')?.textContent),
    );
  }

  await type('Demon');
  sheetRows()[0].click();
  await wait(200);
  ok('picked club shows as a chip', !!D.querySelector('.sheet .watch-picks .watch-chip'));
  const labelInput = D.querySelector('.sheet .watch-create input[type="text"]');
  labelInput.value = 'Kotiseura';
  labelInput.dispatchEvent(new W.Event('input', { bubbles: true }));
  D.querySelector('.sheet button.btn:not(.btn-secondary)').click();
  await settle();

  ok('still on home after create', W.location.pathname === '/');
  const watchId = JSON.parse(W.localStorage.getItem('kisatWatches') || '[]')[0]?.watchId;
  log(`watch id: ${watchId}`);
  ok('watch created and registered from home', /^[0-9a-f]{12}$/.test(watchId || ''));
  ok('and became the device-wide default', JSON.parse(W.localStorage.getItem('kisatFollow') || 'null') === watchId);
  ok(
    'the chip shows its label',
    [...D.querySelectorAll('.filter-bar button')].some((b) => b.textContent.includes('Kotiseura')),
  );

  // --- Editing from home ---
  // "Muokkaa" sits on the selected row of the chip's menu, and its tap fetches
  // the record, as renderHome fetches no Watch. The bar has no ⋯.
  [...D.querySelectorAll('.filter-bar button')].find((b) => b.textContent.includes('Kotiseura')).click();
  await settle();
  ok('no ⋯ left on the bar at all', ![...D.querySelectorAll('.filter-bar button')].some((b) => b.textContent === '⋯'));
  const editBtn = sheetButton('Muokkaa');
  ok('the selected row carries Muokkaa on home', !!editBtn);
  editBtn.click();
  await settle(); // GET /api/watch/:id
  ok('edit sheet opened', !!D.querySelector('.sheet .watch-create input[type="text"]'));
  ok(
    "with the list's label in place",
    D.querySelector('.sheet .watch-create input[type="text"]')?.value === 'Kotiseura',
  );
  const chip = D.querySelector('.sheet .watch-picks .watch-chip');
  ok(
    'and its entry as a toggleable chip',
    !!chip?.textContent.includes('Demon') && !!chip.querySelector('input[type="checkbox"]'),
  );

  // An entry carries its own name, so toggling it off needs no search and
  // works from home.
  chip.querySelector('input[type="checkbox"]').click();
  await wait(200);
  D.querySelector('.sheet button.btn:not(.btn-secondary)').click();
  await settle();
  const saved = await (await realFetch(`/api/watch/${watchId}`, { headers: { 'x-kisat-client': '1' } })).json();
  log(`saved entries: ${JSON.stringify(saved.entries)}`);
  ok('the toggle was saved server-side', saved.entries[0]?.enabled === false);
  ok('and the entry itself kept, not dropped', saved.entries.length === 1);
  ok('editToken never came back on a plain GET', !saved.editToken);
}
