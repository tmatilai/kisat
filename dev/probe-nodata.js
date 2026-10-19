// Checks the two shapes of a class with nothing to show, on two live meets
// that published them (docs/tuloslista-api.md). Neither is in demo.js.
//   1. A start of several classes where one class's /results answers 404. The
//      start still shows the other classes' results (roundDetail,
//      lib/schedule.js).
//   2. A start of one class whose undrawn final carries an empty heat shell.
//      The page says "Ei ilmoittautuneita." (roundAllocated, lib/results.js).
//   dev/probe.html?probe=probe-nodata
// The code holds each meet's id and group key, measured 2026-08. Once the API
// drops a meet, its half needs another meet of the same shape.
// No Worker is needed, as the event view survives a failed /api/meet
// (fetchMeetBody) and this drives no Watch. A round drawn or a resource
// published since makes its half moot, so check a FAIL on the live page.
export default async function probe({ D, log, ok, wait, appJs }) {
  const open = async (compId, key, ms = 2500) => {
    appJs.navigate(`/c/${compId}/g/${encodeURIComponent(key)}`);
    await wait(ms);
  };
  const text = () => D.querySelector('#app').textContent;
  const notices = () => [...D.querySelectorAll('#app .notice')].map((n) => n.textContent.trim());
  const headings = () => [...D.querySelectorAll('#app h3')].map((h) => h.textContent.trim());
  // Counts the tables and not their rows, as an empty results table has no
  // rows either.
  const tables = () => D.querySelectorAll('#app table, #app .ladder-views').length;

  // --- 1. A class that 404s shares its start with two that have results ---
  // The start holds two classes at Official and a second row of one of them,
  // Unallocated, whose results are missing.
  await open('20366', '2026-08-10T09:00:00.0000000+00:00|3000m');
  log(`3000m headings: ${JSON.stringify(headings())}`);
  log(`3000m notices: ${JSON.stringify(notices())}`);
  ok('the start is not an error page', !/Tietojen haku epäonnistui/.test(text()));
  ok(
    'the categories that do have results still render them',
    D.querySelectorAll('#app table, #app .ladder-views').length > 0,
  );
  ok('the missing category says so', notices().includes('Sarjan tuloksia ei ole julkaistu.'));
  ok(
    'and says it exactly once (one 404 in this start)',
    notices().filter((n) => n === 'Sarjan tuloksia ei ole julkaistu.').length === 1,
  );
  // A class with nothing in it sorts last, missing data included, so the
  // results come first (hasEntrants in renderGroup).
  ok('and sorts last, after the ones with results', /Sarjan tuloksia ei ole julkaistu\.\s*$/.test(text().trim()));
  // The missing class keeps its heading and status chip, where a reader
  // learns it was not held.
  ok(
    'the missing category keeps its heading',
    headings().some((h) => /3000m/.test(h)),
  );

  // --- 2. A heat shell, one empty heat and no enrollments ---
  // The start is a final of one class, not yet drawn.
  await open('20345', '2026-08-10T14:50:00.0000000+00:00|100m');
  log(`100m notices: ${JSON.stringify(notices())}`);
  log(`100m tables: ${tables()}`);
  ok('an undrawn round says there is nobody in it', notices().includes('Ei ilmoittautuneita.'));
  ok('and renders no empty results table', tables() === 0);
}
