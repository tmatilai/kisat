// Checks the render cost log behind /#/measure (docs/architecture.md, "What
// a render cost"). A request counts only where one is made, a refresh is a
// row of its own, and the page stays out of its own reading.
//   dev/probe.html?probe=probe-measure&url=c/demo
// The demo answers from demo.js with no network, so no row counts a request.
export default async function probe({ D, W, log, ok, wait, groupKey, appJs, settle }) {
  const open = async (path) => {
    appJs.navigate(path);
    await settle();
  };
  const rows = () => [...D.querySelectorAll('#app table')].slice(-1)[0]?.querySelectorAll('tbody tr') || [];
  const cells = (tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim());

  // The runner's own way in has already rendered home, so the log is cleared.
  await open('/#/measure');
  const wipe = () => {
    const b = [...D.querySelectorAll('#app button')].find((x) => x.textContent.trim() === 'Clear');
    if (b) b.click();
  };
  wipe();
  await wait(400);

  await open('/c/demo');
  await open(`/c/demo/g/${encodeURIComponent(groupKey(11, 0, 'Pituus'))}`);
  // Refreshes the start in view with the timer's own call.
  await appJs.render(true);
  await settle();
  await open('/#/measure');

  const recent = [...rows()].map(cells);
  log(recent.map((c) => c.join(' ')).join(' | '));
  ok(
    'a row per render, newest first',
    recent.length === 3 && recent[0][1] === 'group (refresh)' && recent[1][1] === 'group' && recent[2][1] === 'comp',
  );
  // (Break on purpose: count in fetchJson above the demo branch and not around
  // the real fetch, and none of these reads 0.)
  ok(
    'the demo makes no requests, so none are counted',
    recent.every((c) => c[3] === '0'),
  );
  // (Break on purpose: drop the `view === 'measure'` guard in keepRenderCost,
  // and the page lists itself once it is opened a second time.)
  await open('/c/demo');
  await open('/#/measure');
  const views = [...rows()].map((tr) => cells(tr)[1]);
  log(views.join(' | '));
  ok('the measure page is not in its own reading', !views.some((v) => v.startsWith('measure')));
  // The log outlives the tab in kisatRenderLog. (Break on purpose: hold the
  // log in a module variable, and this is null.)
  const stored = JSON.parse(W.localStorage.getItem('kisatRenderLog') || 'null');
  ok('it is on the device, not in the tab', Array.isArray(stored) && stored.length === views.length);

  wipe();
  await wait(400);
  ok('Clear empties it', D.querySelector('#app .notice')?.textContent.startsWith('Nothing measured yet'));
}
