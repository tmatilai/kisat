// Verifies the layer model and the browser's own back gesture
// (docs/architecture.md, "Layers"). A sheet and the quick-filter are layers
// over a view at its own URL, and back closes the top one and leaves the
// view standing.
//
// A tapped name opens two layers in turn, the athlete sheet and the
// quick-filter behind its "Näytä kaikki lajit". The sheet closes itself to
// open the filter, so the history entry passes from one to the other
// (openLayer).
//
//   dev/probe.html?probe=probe-layers&url=c/demo&wait=1500
//
// No Worker is needed, as fetchJson answers the quick-filter's roster from
// the fixture, and the quick-filter filters the day list with no Watch. A
// Watch would need `make dev`.
//
// The probe measures the browser fact the model rests on. A traversal fires
// popstate and nothing else, whether or not the URL changes, so the popstate
// handler tells a layer from a route change by the sentinel.
export default async function probe({ W, D, log, ok, wait, appJs }) {
  const reset = async (mark) => {
    for (const k of Object.keys(W.localStorage)) {
      if (k.startsWith('kisatWatchEdit:') || k === 'kisatWatches' || k === 'kisatCompView' || k === 'kisatFollow')
        W.localStorage.removeItem(k);
    }
    appJs.navigate(mark);
    await wait(300);
  };
  const sheets = () => D.querySelectorAll('.sheet').length;
  const filtered = () => !!D.querySelector('.filter-bar .watch-chip');
  const athleteSheet = () => D.querySelector('.sheet .athlete-sheet');
  const showAll = () =>
    [...D.querySelectorAll('.sheet .btn')].find((b) => b.textContent.includes('Näytä kaikki lajit'));
  const chipBtn = () => [...D.querySelectorAll('.filter-bar button')].find((b) => b.textContent.includes('▾'));

  // --- The fact ---
  await reset('/');
  {
    const seen = [];
    const onPop = () => seen.push('popstate');
    const onHash = () => seen.push('hashchange');
    W.addEventListener('popstate', onPop);
    W.addEventListener('hashchange', onHash);
    W.history.pushState({ probe: 1 }, '', W.location.href);
    await wait(100);
    W.history.back();
    await wait(400);
    log(`same-URL pushState + back fires: ${seen.join(',') || 'nothing'}`);
    ok('a same-URL back fires popstate and nothing else', seen.join(',') === 'popstate');
    seen.length = 0;
    appJs.navigate('/c/demo');
    await wait(900);
    log(`navigate fires: ${seen.join(',') || 'nothing'}`);
    ok('a navigation fires nothing, so navigate renders for itself', seen.length === 0);
    W.history.back();
    await wait(600);
    log(`a route-changing back fires: ${seen.join(',') || 'nothing'}`);
    ok('and a route-changing back fires popstate and nothing else', seen.join(',') === 'popstate');
    // (Break on purpose: drop leaveView from the popstate handler's route
    // branch and the meet stays on screen.)
    ok('...which renders the entry landed on', D.getElementById('title').textContent.startsWith('Kisat'));
    W.removeEventListener('popstate', onPop);
    W.removeEventListener('hashchange', onHash);
  }

  // --- A sheet: back closes it and leaves the view standing ---
  await reset('/');
  appJs.navigate('/c/demo');
  await wait(1200);
  const atComp = W.history.length;
  // A closed layer gives its entry back, or the next back press is spent on
  // nothing. history.length never shrinks, as a traversal only moves the
  // pointer. So the sentinel is gone when history.state carries no layer id.
  const onSentinel = () => W.history.state?.layer != null;
  chipBtn().click();
  await wait(300);
  ok('the selector sheet opened', sheets() === 1);
  log(`history.length ${atComp} -> ${W.history.length} with the sheet open, state ${JSON.stringify(W.history.state)}`);
  ok('...on a history entry of its own', W.history.length === atComp + 1 && onSentinel());
  W.history.back();
  await wait(600);
  // (Break on purpose: drop the popstate listener and the sheet stays open
  // over the meet.)
  ok('back closes the sheet and stays put', sheets() === 0 && W.location.pathname === '/c/demo');
  ok('and the sentinel entry went with it', !onSentinel());

  // With two sheets, one entry stands for the stack and each press takes one
  // layer off. The second opens through the app's own textSheet, as in
  // dev/probe.js, since the stack and not the DOM says which is on top.
  chipBtn().click();
  await wait(300);
  appJs.textSheet('Päällimmäinen', ['Toinen kerros ensimmäisen päälle.']);
  await wait(200);
  ok('two sheets stacked', sheets() === 2);
  log(`history.length with two open: ${W.history.length} (one view entry + one sentinel)`);
  ok('...still on one entry between them', W.history.length === atComp + 1);
  W.history.back();
  await wait(600);
  ok('back takes the top one and leaves the one under it', sheets() === 1 && !!D.querySelector('.sheet .menu'));
  W.history.back();
  await wait(600);
  ok('and the next press takes the last', sheets() === 0 && W.location.pathname === '/c/demo');
  ok('leaving no sentinel behind', !onSentinel());

  // --- The × and Escape leave nothing behind either ---
  // A close that skips closeTopLayer leaves the stack believing a sheet is
  // open, and that stops the refresh for good (refreshTick, anySheetOpen).
  chipBtn().click();
  await wait(300);
  D.querySelector('.sheet-close').click();
  await wait(400);
  log(`after the ×: sheets ${sheets()}, anySheetOpen() ${appJs.anySheetOpen()}, history.length ${W.history.length}`);
  // (Break on purpose: point the ×'s onclick in openSheet at a bare
  // sheet.remove() and the stack keeps the sheet for ever.)
  ok('the × closes the sheet and the stack agrees', sheets() === 0 && appJs.anySheetOpen() === false);
  ok('and it gives the entry back too', !onSentinel());
  chipBtn().click();
  await wait(300);
  D.querySelector('.sheet-close').dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(400);
  ok('Escape does the same', sheets() === 0 && !onSentinel());
  // The entry is spent, so the very next press leaves the view and no
  // unseen entry swallows it.
  W.history.back();
  await wait(800);
  log(`one press after closing a sheet: hash ${W.location.pathname}`);
  ok('one press after that leaves the competition', W.location.pathname === '/');

  // --- A tapped name: the athlete sheet, and the quick-filter behind it ---
  // Both are layers over the day list at its own URL, and the pair costs one
  // history entry.
  await reset('/');
  appJs.navigate('/c/demo#/a/g1-a');
  await wait(1500);
  ok('the activation link still lands on the schedule view, filtered', W.location.pathname === '/c/demo' && filtered());
  const line = D.querySelector('.watch-row-athlete .athlete-link');
  ok('the filtered day list offers a name to tap', !!line);
  const atFiltered = W.history.length;
  line.click();
  await wait(600);
  log(
    `tapping a name: sheets ${sheets()}, history.length ${atFiltered} -> ${W.history.length}, hash ${W.location.pathname}`,
  );
  ok(
    'tapping a name opens the athlete sheet and stays on the schedule view',
    !!athleteSheet() && W.location.pathname === '/c/demo',
  );
  // The entry the sheet stands on is the layer's own. A trip through the
  // activation link also pushes one, a plain copy of the view's URL, so the
  // count alone proves nothing. (Break on purpose: make athleteNameLink's
  // handler navigate to the quick-filter's link and this fails on the state
  // and not on the count.)
  ok(
    "...on one entry of its own, and it is the layer's",
    W.history.length === atFiltered + 1 && W.history.state?.layer != null,
  );
  // The sheet closes itself to open the filter, so the standing sentinel
  // passes from one layer to the other. (Break on purpose: drop
  // openAthleteSheet's closeTopLayer and the sheet stays under the filter,
  // so one gesture takes two presses to undo. Drop openLayer's
  // `rewindQueued = false` and the queued rewind spends the sentinel under
  // the filter, which the state shows.)
  ok('the sheet offers the filter', !!showAll());
  showAll().click();
  await wait(1200);
  log(
    `after "Näytä kaikki lajit": sheets ${sheets()}, history.length ${W.history.length}, hash ${W.location.pathname}`,
  );
  ok(
    'it closes the sheet and filters the day list in its place',
    sheets() === 0 && filtered() && W.location.pathname === '/c/demo',
  );
  ok(
    '...still on the one entry the sheet was standing on',
    W.history.length === atFiltered + 1 && W.history.state?.layer != null,
  );
  W.history.back();
  await wait(1200);
  ok(
    'back clears the filter and stays on the schedule view',
    W.location.pathname === '/c/demo' && !filtered() && D.getElementById('app').textContent.includes('Kuula'),
  );
  ok('and the entry went with it', W.history.state?.layer == null);

  // The header's `‹` is the same way out and gives the entry back too
  // (closeFocusFilter). A `‹` that only cleared the state would leave an
  // entry for a later back press to spend on nothing. The activation link
  // leaves no layer, so a name tapped after it still pushes one.
  appJs.navigate('/c/demo#/a/g1-a');
  await wait(1500);
  ok('filtered through the link again, with nothing stacked', filtered() && W.history.state?.layer == null);
  D.querySelector('.watch-row-athlete .athlete-link').click();
  await wait(600);
  showAll().click();
  await wait(1200);
  ok('and tapping a name from there stacks one', filtered() && W.history.state?.layer != null);
  D.getElementById('back').click();
  await wait(1200);
  ok(
    '`‹` clears the filter and gives the entry back',
    !filtered() && W.location.pathname === '/c/demo' && W.history.state?.layer == null,
  );

  // A sheet opened over the day list and dismissed leaves the view as it
  // was and takes its entry with it, so a tap thought better of costs the
  // reader nothing.
  await reset('/');
  appJs.navigate('/c/demo#/a/g1-a');
  await wait(1500);
  const atUntapped = W.history.length;
  D.querySelector('.watch-row-athlete .athlete-link').click();
  await wait(600);
  D.querySelector('.sheet-close').click();
  await wait(600);
  log(`sheet opened and dismissed: sheets ${sheets()}, history.length ${atUntapped} -> ${W.history.length}`);
  ok(
    'dismissing the sheet leaves the view as it was',
    sheets() === 0 && filtered() && W.location.pathname === '/c/demo',
  );
  ok('and takes its entry with it', W.history.state?.layer == null);

  // --- From an event view, the filter behind the sheet is a navigation ---
  // The quick-filter shows on the schedule view alone, so "Näytä kaikki
  // lajit" in a results table goes there (openFocusFilter). Back then returns
  // to the start.
  await reset('/');
  appJs.navigate('/c/demo');
  await wait(1200);
  const atDay = W.location.pathname;
  [...D.querySelectorAll('.list a.row')].find((r) => r.textContent.includes('Keihäs')).click();
  await wait(1200);
  const atEvent = W.location.pathname;
  ok('opened a start', atEvent.includes('/g/'));
  const cell = D.querySelector('.cell-name a.athlete-link');
  ok('the results table names are links', !!cell);
  ok('...whose href is still the activation link', cell.getAttribute('href').startsWith('/c/demo#/a/'));
  cell.click();
  await wait(600);
  ok('and tapping one opens the sheet over the start', !!athleteSheet() && W.location.pathname === atEvent);
  showAll().click();
  await wait(1500);
  // (Break on purpose: open the filter layer in place in openFocusFilter,
  // with no navigation, and the reader stays on the start under a filter
  // the start cannot show.)
  ok(
    'the filter lands on the schedule view instead, with nothing stacked',
    W.location.pathname === '/c/demo' && filtered() && W.history.state?.layer == null,
  );
  W.history.back();
  await wait(1200);
  ok('back returns to the start it was tapped in', W.location.pathname === atEvent);
  // The navigation spends the entry the sheet stood on. Two entries at the
  // start's own URL would make the second press render the same start.
  // (Break on purpose: drop `replace: true` from openFocusFilter's navigate
  // and this press leaves the reader where they are.)
  W.history.back();
  await wait(1200);
  log(`two presses back from the filtered view: ${W.location.pathname}`);
  ok('and the next press leaves the start, with no dead entry under it', W.location.pathname === atDay);

  // --- A sheet over the filter: the refresh runs under the filter, which is
  // no sheet, and back still unstacks in order ---
  await reset('/');
  appJs.navigate('/c/demo#/a/g1-a');
  await wait(1500);
  ok('filtered, and the refresh is not held off by it', filtered() && appJs.anySheetOpen() === false);
  D.querySelector('.watch-row-athlete .athlete-link').click();
  await wait(600);
  showAll().click();
  await wait(1200);
  const atLayer = W.history.length;
  // The sheet opens through textSheet, as above. With the athlete chip on,
  // the filter bar's one button copies a link and opens no sheet.
  appJs.textSheet('Päällimmäinen', ['Arkki suodattimen päälle.']);
  await wait(400);
  log(`sheet over the filter: sheets ${sheets()}, history.length ${atLayer} -> ${W.history.length}`);
  ok('a sheet opens over the filter on the standing entry', sheets() === 1 && W.history.length === atLayer);
  ok('...which is still the one sentinel', W.history.state?.layer != null);
  W.history.back();
  await wait(800);
  ok('back takes the sheet and leaves the filter', sheets() === 0 && filtered());
  W.history.back();
  await wait(1200);
  ok('and the next press takes the filter', !filtered() && W.location.pathname === '/c/demo');
}
