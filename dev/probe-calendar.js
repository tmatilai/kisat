// Checks the front page with nothing followed (docs/home.md), which
// probe-home.js does not cover. It covers a meet's real days from
// /calendar.json, the sort, the today highlight, the older tail and search.
//   dev/probe.html?probe=probe-calendar&wait=2500
// It needs `make dev`, as only the Worker answers /calendar.json. It reads
// live data, since the check is whether the feed's days reach the page.
export default async function probe({ W, D, log, ok, wait, appJs }) {
  // With no watch of any kind, this is a first visitor's page.
  W.localStorage.removeItem('kisatWatches');
  W.localStorage.removeItem('kisatFollow');
  W.localStorage.removeItem('kisatCompView');
  W.localStorage.removeItem('kisatRecentComps');
  appJs.navigate('/');
  await wait(300);
  appJs.navigate('/');
  await wait(4000); // the listing and the feed load in parallel

  const app = D.getElementById('app');
  ok('no Seuratut without a follow-list', !app.textContent.includes('Seuratut'));

  const listEl = D.querySelector('#app > .list');
  const rowIds = () => [...listEl.querySelectorAll('a')].map((a) => a.getAttribute('href').match(/\/c\/(\w+)/)?.[1]);
  const rowById = (id) => [...listEl.querySelectorAll('a')].find((a) => a.getAttribute('href') === `/c/${id}`);

  // Fetches the feed apart from the page, to compare the two.
  const feed = await W.fetch(`/calendar.json?day=${new Date().toLocaleDateString('sv-SE')}`).then((r) => r.json());
  const withDays = feed.comps.filter((c) => c.days?.length);
  const spans = withDays.filter((c) => c.days.length > 1);
  log(`feed: ${feed.comps.length} comps, ${withDays.length} with real days, ${spans.length} multi-day`);
  ok('the feed answers at all (make dev, not make serve)', withDays.length > 0);

  const recent = rowIds();
  log(`rows shown by default: ${recent.length}`);
  ok('not cut at a fixed 60-row cap', recent.length !== 60);

  // With no follow-list the whole listing is one list, so its sort is checked
  // here too (meetSortValue, docs/home.md). The value is recomputed from the
  // feed's days or the listing's Date, with today clamped into the range. It
  // is in whole days, and a stable sort keeps a date's meets in listing order.
  const rawDate = new Map(feed.comps.map((c) => [String(c.id), c.date]));
  const feedDays = new Map(withDays.map((c) => [String(c.id), c.days]));
  const dayMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
  const toIso = (fi) => {
    const [d, m, y] = fi.split('.');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  };
  const nowMs = dayMs(new Date().toLocaleDateString('sv-SE'));
  function sortValue(id) {
    const days = feedDays.get(id);
    if (!days) return dayMs(String(rawDate.get(id)).slice(0, 10));
    return Math.min(Math.max(nowMs, dayMs(toIso(days[0]))), dayMs(toIso(days[days.length - 1])));
  }
  const sortedDesc = [...recent].sort((a, b) => sortValue(b) - sortValue(a));
  ok('sorted descending by date value, newest first', recent.join() === sortedDesc.join());

  // A multi-day meet in the default list prints its real span, which only
  // the feed knows on a first visit (docs/home.md, "Dates and sorting").
  const spanRow = spans.map((c) => [c, rowById(String(c.id))]).find(([, r]) => r);
  if (!spanRow) {
    log('no multi-day meet in the default list today — span check skipped');
  } else {
    const [comp, row] = spanRow;
    const sub = row.querySelector('.row-sub').textContent;
    log(`multi-day row ${comp.id}: "${sub}" (days ${comp.days.join(', ')})`);
    ok('a multi-day row shows a real span from the feed', sub.includes('–'));
  }

  // The today highlight works with no follow-list to supply the days.
  const todayFi = new Date().toLocaleDateString('fi-FI');
  const todayComps = withDays.filter((c) => c.days.includes(todayFi));
  const todayRows = todayComps.map((c) => rowById(String(c.id))).filter(Boolean);
  log(`meets running today per the feed: ${todayComps.length} (${todayRows.length} on the page)`);
  if (todayRows.length) {
    ok(
      'every meet running today is highlighted',
      todayRows.every((r) => r.classList.contains('watched')),
    );
  }
  // A meet not on today stays unlit, or a page that lit every row would pass
  // the check above.
  const notToday = [...listEl.querySelectorAll('a.watched')]
    .map((a) => a.getAttribute('href').match(/\/c\/(\w+)/)?.[1])
    .filter((id) => !todayComps.some((c) => String(c.id) === id));
  ok(
    `only today's meets are highlighted (${notToday.length} others lit)`,
    notToday.length === 0 || todayComps.length === 0,
  );

  // The older tail is counted, hidden and a tap away.
  const btn = D.querySelector('#app > div:last-child button');
  const label = btn?.textContent || '';
  log(`older button: "${label}"`);
  const count = +(label.match(/\((\d+)\)/)?.[1] || 0);
  ok('older meets are offered, not dropped', count > 0);

  // The search reaches a hidden older meet, so hiding the tail loses
  // nothing. The meet comes off the listing the page reads, since the feed's
  // cached copy can still hold a meet the listing has dropped.
  const listing = await W.fetch('https://cached-public-api.tuloslista.com/live/v1/competition').then((r) => r.json());
  const hiddenComp = listing.find((c) => c.Name?.trim() && !recent.includes(String(c.Id)));
  const search = D.querySelector('#app input.search');
  search.value = hiddenComp.Name.trim().slice(0, 24);
  search.dispatchEvent(new W.Event('input'));
  await wait(200);
  ok(`a hidden older meet is findable by search ("${search.value}")`, rowIds().includes(String(hiddenComp.Id)));
  ok('no older button while searching', !D.querySelector('#app > div:last-child button'));
  // The placeholder venue "Kilpailupaikka" matches nothing, as a search reads
  // only what a row prints (meetPlace, lib/home.js; docs/tuloslista-api.md,
  // "`Location` defaults to the placeholder `Kilpailupaikka`").
  // (Break on purpose: match the raw c.Location in renderHome's search
  // filter, and tens of meets match.)
  search.value = 'kilpailupaikka';
  search.dispatchEvent(new W.Event('input'));
  await wait(200);
  const placeholderHits = rowIds().length;
  ok(`the placeholder venue matches nothing (${placeholderHits} rows)`, placeholderHits === 0);

  search.value = '';
  search.dispatchEvent(new W.Event('input'));
  await wait(200);
  ok('clearing the search restores the recent list', rowIds().length === recent.length);

  btn.click();
  await wait(200);
  const all = rowIds();
  log(`rows after the tap: ${all.length}`);
  ok(`every older meet appears (${recent.length} + ${count} = ${all.length})`, all.length === recent.length + count);
  ok('the button is gone once they are shown', !D.querySelector('#app > div:last-child button'));
  ok('still one monotonic list, newest first', all.slice(0, recent.length).join() === recent.join());
}
