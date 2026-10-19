// Checks the plain listing's today highlight (compRow, app/home.js;
// docs/home.md, "Dates and sorting") against the live listing. With no Worker
// nothing answers /calendar.json, and with no Watch and no stored meets a row
// is lit where the listing's Date is today (meetWhen, lib/home.js).
//   dev/probe.html?probe=probe-today&wait=3000
export default async function probe({ D, W, log, ok, wait, params, appJs }) {
  W.localStorage.removeItem('kisatFollow');
  W.localStorage.removeItem('kisatWatches');
  W.localStorage.removeItem('kisatCompView');
  W.localStorage.removeItem('kisatRecentComps');
  appJs.navigate('/');
  await wait(300);
  appJs.navigate('/');
  await wait(+(params.get('wait') || 3000));

  const listing = await W.fetch('https://cached-public-api.tuloslista.com/live/v1/competition').then((r) => r.json());
  // Today is the device's local date, as the app reads it (scanTodayIso).
  // (Break on purpose: take the UTC date, and TZ=Pacific/Kiritimati fails.)
  const now = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const todayIso = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
  const isoDayOf = (ts) => (/^(\d{4}-\d{2}-\d{2})/.exec(String(ts ?? '')) || [])[1] || '';
  const expectedToday = new Set(listing.filter((c) => isoDayOf(c.Date) === todayIso).map((c) => String(c.Id)));
  log(`todayIso=${todayIso} expected-today-count=${expectedToday.size}`);

  const rows = [...D.querySelectorAll('a.row[href^="/c/"]')];
  ok('rows rendered', rows.length > 0);

  let mismatches = 0;
  for (const row of rows) {
    const id = row.getAttribute('href').replace('/c/', '');
    const isWatched = row.classList.contains('watched');
    const shouldBe = expectedToday.has(id);
    // Every row counts, as each reads the listing's Date here. Under `make
    // dev` the feed's real days can differ from that Date, which is not
    // reliably a meet's first day (docs/tuloslista-api.md).
    if (isWatched !== shouldBe) mismatches++;
  }
  log(`checked ${rows.length} rows, ${mismatches} disagreed with raw-Date expectation`);
  ok('no unexplained mismatches', mismatches === 0);
}
