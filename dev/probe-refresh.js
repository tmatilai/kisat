// Checks that a refresh, render(true), moves nothing the reader did
// (docs/views.md, "The refresh"). It covers the
// scroll down the page and across a ladder, an open sheet, a hidden tab and
// the cup page's picks.
//   dev/probe.html?probe=probe-refresh&w=700&h=300
// Below 700 px no ladder grid shows (index.html), and at 700 the 6-attempt
// Kuula overflows its box. At 300 px tall the demo's short pages can scroll.
export default async function probe({ D, W, ok, wait, groupKey, appJs, demoJs }) {
  const KEYS = {
    karsinta: groupKey(11, 0, 'Pituus'), // two heats, the tallest demo field page
    kuula: groupKey(12, 30, 'Kuula'), // 6 attempts overflow at 700 px
  };
  const open = async (name, ms = 1200) => {
    appJs.navigate(`/c/demo/g/${encodeURIComponent(KEYS[name])}`);
    await wait(ms);
  };
  const refresh = async (ms = 800) => {
    await appJs.render(true);
    await wait(ms);
  };

  // --- Down the page: a refresh keeps the reader's place ---
  await open('karsinta');
  const room = D.documentElement.scrollHeight - W.innerHeight;
  // Without this the checks below pass on a page that never scrolled.
  ok('the page has room to scroll', room > 100);
  W.scrollTo(0, 120);
  await wait(200);
  ok('scrolled to 120', W.scrollY === 120);
  await refresh();
  // Chrome keeps the position over a same-height render even without the
  // restore, so this check shows only that the restore adds no jump. The
  // collapse below is the check that can fail.
  ok('an ordinary refresh keeps the position', W.scrollY === 120);

  // A refresh onto a page too short for the position keeps it in the map
  // (wantedScroll). With e3 deleted, demoResponse answers an empty event, and
  // the start collapses to "Ei ilmoittautuneita.".
  const e3 = demoJs.DEMO_EVENTS.e3;
  delete demoJs.DEMO_EVENTS.e3;
  await refresh();
  ok('the outage really did collapse the page', D.documentElement.scrollHeight <= W.innerHeight && W.scrollY === 0);
  demoJs.DEMO_EVENTS.e3 = e3;
  await refresh();
  ok('the position comes back with the data', W.scrollY === 120);

  // --- Across the table: a wide ladder keeps its column too ---
  await open('kuula');
  const wrap = () => D.querySelector('#app .ladder-views > .tbl-wrap');
  const max = () => wrap().scrollWidth - wrap().clientWidth;
  ok('the ladder is wider than its box', max() > 0);
  ok('it opens on the Result column', wrap().scrollLeft === max());
  wrap().scrollLeft = 0;
  await wait(200);
  await refresh();
  ok('a refresh keeps the column the reader chose', wrap().scrollLeft === 0);
  // A fresh open starts on the Result column again, as its loading
  // placeholder leaves renderGroup no scroll offsets to keep.
  await open('karsinta');
  await open('kuula');
  ok('re-opening starts on the Result column again', wrap().scrollLeft === max());

  // --- Over the page: a sheet outlives the refresh ---
  // An open sheet and its unsaved edits outlive a render, and only a route
  // change closes it (docs/architecture.md, "Layers"). The schedule view holds
  // the filter bar's sheets, and its SCHEDULE_REFRESH_MS runs the same tick.
  appJs.navigate('/c/demo');
  await wait(1200);
  const sheet = () => D.querySelector('.sheet');
  // Finds the Watch chip by its ▾ whichever label it carries, and never the
  // athlete filter's 'Jaa linkki' in the same slot.
  const chip = [...D.querySelectorAll('.filter-bar button')].find((b) => b.textContent.includes('▾'));
  ok('the filter bar offers the Watch chip', !!chip);
  chip.click();
  await wait(200);
  ok('the Watch menu opened', !!sheet());
  // 'Uusi seuranta' is a row on the menu's own list (openMenu, app/shell.js).
  // Its dialog reads /api/roster/demo, which fetchJson answers from the
  // fixture, so this probe needs no Worker.
  [...sheet().querySelectorAll('.menu .row')].find((r) => r.textContent.includes('Uusi seuranta')).click();
  await wait(800);
  const label = () => sheet()?.querySelector('input.search');
  ok('the create sheet opened in its place', !!label());
  label().value = 'Kesken jäänyt';
  const seq = () => appJs.renderSeq;
  const before = seq();
  await refresh();
  ok('the refresh really did render', seq() > before);
  // (Break on purpose: add `document.querySelector('.sheet')?.remove()` to
  // render()'s non-laps branch, and these two fail.)
  ok('a refresh leaves the sheet standing', !!sheet());
  ok('and leaves what was typed into it', label()?.value === 'Kesken jäänyt');

  // A timer tick renders nothing while a sheet covers the page, as the sheet
  // may hold unsaved edits. (Break on purpose: drop refreshTick's
  // anySheetOpen() guard.)
  const held = seq();
  appJs.refreshTick();
  await wait(400);
  ok('a timer tick is skipped while a sheet is open', seq() === held);

  // A route change closes the sheet (clearLayers, in leaveView), and the
  // timer renders again.
  appJs.navigate(`/c/demo/g/${encodeURIComponent(KEYS.karsinta)}`);
  await wait(1200);
  ok('a route change closes the sheet', !sheet());
  const after = seq();
  appJs.refreshTick();
  await wait(600);
  ok('and the tick renders again once it is gone', seq() > after);

  // --- A tab nobody is looking at refreshes nothing ---
  // `hidden` is stubbed, as headless cannot send a page to the back, and the
  // event is dispatched by hand. The checks run on the day view, which costs
  // the most.
  appJs.navigate('/c/demo');
  await wait(1200);
  const hide = (on) => {
    Object.defineProperty(D, 'hidden', { configurable: true, get: () => on });
    D.dispatchEvent(new W.Event('visibilitychange'));
  };
  const armed = () => appJs.refreshTimer !== null;
  ok('the day view runs on a timer', armed());
  hide(true);
  await wait(200);
  // (Break on purpose: drop the clearInterval from the visibilitychange
  // listener, and the whole interval below renders.)
  ok('hiding the tab stops it', !armed());
  const idle = seq();
  await wait(appJs.SCHEDULE_REFRESH_MS + 2000);
  ok('and a whole interval passes with nothing rendered', seq() === idle);
  hide(false);
  await wait(800);
  ok('coming back renders at once', seq() > idle);
  ok('and puts it back on the timer', armed());

  // --- The cup page: its standings move, and the reader's pick stays ---
  // Seuratut opens only a person with two lines, and no demo athlete has two.
  // The stub gives a clubmate's line to the one followed licence.
  const followed = demoJs.demoLicense('sc18-a');
  const realFetchJson = appJs.fetchJson;
  appJs.setFetchJson(async (url, opts) => {
    if (url === '/api/watch/wcup') {
      return { label: 'Cup', entries: [{ type: 'athlete', id: followed, name: 'Niilo Seurainen', enabled: true }] };
    }
    const body = await realFetchJson(url, opts);
    return url === '/api/cup/democup'
      ? JSON.parse(JSON.stringify(body).replaceAll(demoJs.demoLicense('sc22-a'), followed))
      : body;
  });
  appJs.setActiveFollow('wcup');
  appJs.navigate('/c/democup/cup/s/1');
  await wait(1400);
  // (Break on purpose: drop 'cup' from scheduleRefresh.)
  ok('the cup page runs on a timer', armed());
  const head = () => D.querySelector('#app .medalist-head');
  ok('Seuratut has a row that opens, open', head()?.getAttribute('aria-expanded') === 'true');
  head().click();
  W.scrollTo(0, 150);
  await wait(200);
  ok('the cup page has room to scroll', W.scrollY === 150);
  const scrolls = [];
  const realScrollTo = W.scrollTo;
  W.scrollTo = (...a) => {
    scrolls.push(a);
    return realScrollTo.apply(W, a);
  };
  const beforeCup = seq();
  await refresh();
  W.scrollTo = realScrollTo;
  ok('the refresh really did render', seq() > beforeCup);
  ok('a refresh keeps the picked club', D.querySelector('#app .pick-head span')?.textContent === 'Demon Urheilijat');
  // (Break on purpose: give cupFollowedEls a fresh set of open rows per call.)
  ok('and the row the reader closed', head()?.getAttribute('aria-expanded') === 'false');
  // (Break on purpose: let renderCup scroll to the pick on a refresh.)
  ok('and scrolls nowhere', !scrolls.length && W.scrollY === 150);
  appJs.setFetchJson(realFetchJson);
  appJs.setActiveFollow(null);
}
