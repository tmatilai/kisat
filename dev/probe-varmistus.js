// Verifies where the varmistus line renders and where it must not
// (docs/views.md, "Varmistus"). confirmNote's gate and count are
// tested offline, but only a rendered page shows which branch calls it.
//
// It reads an entry list (1), a drawn start (2), later rounds and a start
// nobody has confirmed in (3a to 3c), the day's own list (4), the Ottelut
// row (5), an ottelu's page (6) and a leg with a withdrawn athlete (7). A
// stubbed clock checks both sides of a deadline.
//
//   dev/probe.html?probe=probe-varmistus
//
// The page answers the demo's /api/meet itself (demoApiBody,
// lib/demo-api.js), so no Worker is needed.
export default async function probe({ D, W, log, ok, wait, appJs, demoJs, libJs }) {
  // The demo's days are today's (demo.js), so the group keys are read off
  // the fixture's schedule as the day list builds them.
  const rows = Object.values(demoJs.demoSchedule()).flat();
  const open = async (eventId, roundName, ms = 1200) => {
    const row = rows.find((r) => r.EventId === eventId && (!roundName || r.Name === roundName));
    const hash = `/c/demo/g/${encodeURIComponent(libJs.roundGroupKey(row))}`;
    // Opening the start already on screen bounces off the meet page first.
    // navigate renders a repeated path too, so the bounce only costs a
    // render.
    if (W.location.pathname === hash) {
      appJs.navigate('/c/demo');
      await wait(300);
    }
    appJs.navigate(hash);
    await wait(ms);
    return row;
  };
  const notices = () => [...D.querySelectorAll('#app .notice')].map((n) => n.textContent.trim());
  const varmistus = () => notices().filter((t) => t.startsWith('Varmistaneita'));
  // Reads every cell of the tick column, blanks included, since a count of
  // the ticks alone passes a column that has lost its blanks.
  const confCells = () => [...D.querySelectorAll('#app .tbl tbody td.conf')].map((c) => c.textContent);

  // 1. The entry list of e6, a start with entrants and no round. confirmNote
  // reads Date.now (lib/confirmation.js), so a stubbed clock gives both
  // phases.
  const realNow = W.Date.now;
  const at = async (ms, label) => {
    W.Date.now = () => ms;
    const row = await open('e6');
    log(`${label} (${row.Status}): ${JSON.stringify(notices())}`);
    return varmistus()[0] || '';
  };
  const startsAt = new W.Date(rows.find((r) => r.EventId === 'e6').BeginDateTimeWithTZ.replace(/\.\d+/, '')).getTime();

  // Two hours before the start, the demo's 60-minute deadline is ahead.
  const openLine = await at(startsAt - 2 * 60 * 60 * 1000, 'N Keihäs, deadline ahead');
  ok('the entry list carries the varmistus line', varmistus().length === 1);
  // One of the start's two entries is unconfirmed (demo.js).
  ok("and counts this category's own entries", openLine.startsWith('Varmistaneita 1/2'));
  // (Break on purpose: drop `confirm` from the /api/meet body (cupBody) and
  // the count stands on confirmNote's data gate, with no deadline after it.)
  ok('with the deadline as a clock time', /^Varmistaneita 1\/2 · sulkeutuu \d{1,2}\.\d{2}$/.test(openLine));

  const link = D.querySelector('#app .notice a');
  log(`portal link: "${link?.textContent}" -> ${link?.getAttribute('href')} ${link?.target} ${link?.rel}`);
  ok(
    'and the deadline is the link, not a word added after it',
    /^sulkeutuu \d{1,2}\.\d{2}$/.test(link?.textContent || '') &&
      link?.target === '_blank' &&
      link?.rel === 'noopener' &&
      link?.getAttribute('href') === 'https://www.tuloslista.com/varmistus/#!/demo',
  );

  // Past the deadline the clock time becomes plain words. (Break on
  // purpose: link the closed half too in confirmDeadline and the portal is
  // still offered once it has shut.)
  const shutLine = await at(startsAt, 'N Keihäs, deadline past');
  ok('past it the count stays and only the rest changes', shutLine === 'Varmistaneita 1/2 · Varmistus sulkeutunut');
  ok('and the portal link is gone with the deadline', !D.querySelector('#app .notice a'));
  W.Date.now = realNow;

  log(`conf column: ${JSON.stringify(confCells())}`);
  ok('every row has the column, marked or not', confCells().length === 2);
  ok(
    'the confirmed entry is ticked and the other is blank',
    confCells().filter((t) => t === '✓').length === 1 && confCells().includes(''),
  );
  // The tick marks the confirmed and never the unconfirmed.
  // (Break on purpose: tick on `!a.Confirmed` and the check above still
  // counts one. This one fails on the row.)
  const ticked = [...D.querySelectorAll('#app .tbl tbody tr')].filter(
    (r) => r.querySelector('td.conf')?.textContent === '✓',
  );
  ok(
    'and it is on the entry that confirmed, not the one that did not',
    ticked.length === 1 && ticked[0].textContent.includes('Emma Mittainen'),
  );
  ok('with no words in the column heading either', D.querySelector('#app .tbl thead th.conf')?.textContent === '');

  // 2. A drawn start has no count line, as its list is the drawn field. The
  // entries the draw left out get a table of their own (docs/views.md).
  const race = await open('e16');
  log(`N 1500m (${race.Status}): ${JSON.stringify(notices())}`);
  ok('a drawn start carries no varmistus line', varmistus().length === 0);

  const missingHead = [...D.querySelectorAll('#app h3')].find((h) => h.textContent.trim() === 'Ei erissä');
  const missingTable = missingHead?.nextElementSibling?.querySelector('table');
  const missingRows = [...(missingTable?.querySelectorAll('tbody tr') || [])].map(
    (r) => `${r.querySelector('td.conf')?.textContent}|${r.querySelector('.name-main')?.textContent}`,
  );
  log(`Ei erissä: ${JSON.stringify(missingRows)}`);
  ok('but it lists who was entered and left out of the draw', missingRows.length === 1);
  // The one left out entered and never confirmed (demo.js).
  ok("with the entry-list's own tick column, blank for an unconfirmed one", missingRows[0] === '|Iida Vauhtinen');
  ok(
    'and the drawn eight are still the table above it',
    D.querySelectorAll('#app .tbl tbody tr').length - missingRows.length === 8,
  );

  // 3a. Enrollments is event-wide, so a drawn round after an earlier one must
  // not list the runners the earlier round knocked out. (Break on purpose:
  // drop the hasEarlierRound guard from the "Ei erissä" list in
  // categorySections and e9's Välierät names its 2.)
  const semi = await open('e9', 'Välierät');
  log(
    `N 200m Välierät (${semi.Status}): h3s ${JSON.stringify([...D.querySelectorAll('#app h3')].map((h) => h.textContent.trim()))}`,
  );
  ok(
    'a later round never lists its own eliminated as missing',
    ![...D.querySelectorAll('#app h3')].some((h) => h.textContent.trim() === 'Ei erissä'),
  );

  // 3b. An undrawn final after an earlier round has no count line either.
  const final = await open('e9', 'Loppukilpailu');
  log(`N 200m Loppukilpailu (${final.Status}): ${JSON.stringify(notices())}`);
  // (Break on purpose: drop the `field || hasEarlierRound` guard in
  // categorySections and a second notice reads `Varmistaneita 0/6`. It
  // counts the Välierät's qualifiers, whose allocations carry no
  // confirmation. A drawn start never reaches that branch.)
  ok('an undrawn final with earlier rounds carries none either', varmistus().length === 0);
  // This is case 1's table, so the check tests the column's own gate.
  ok('and no tick column on it, though it is the same table', D.querySelector('#app .tbl') && confCells().length === 0);
  ok(
    'and still says what it always said about the previous phase',
    notices().some((t) => t.startsWith('Edellinen vaihe')),
  );

  // 3c. In an undrawn start where nobody has confirmed yet (e46), only the
  // meet's setting puts the line up. The demo's reads "off", as a meet that
  // confirms can (docs/tuloslista-api.md). (Break on purpose: gate
  // confirmSetting on the setting's `"on"` and the line goes.)
  const zeroRow = rows.find((r) => r.EventId === 'e46');
  const zeroStarts = new W.Date(zeroRow.BeginDateTimeWithTZ.replace(/\.\d+/, '')).getTime();
  W.Date.now = () => zeroStarts - 2 * 60 * 60 * 1000;
  const zero = await open('e46');
  log(`T13 Kuula (${zero.Status}): ${JSON.stringify(notices())}`);
  const zeroLine = varmistus()[0] || '';
  ok('a start nobody has confirmed in yet still carries the line', varmistus().length === 1);
  ok('counted at nought over its own three entries', zeroLine.startsWith('Varmistaneita 0/3'));
  ok(
    'with the deadline that is the reason to read it',
    /^Varmistaneita 0\/3 · sulkeutuu \d{1,2}\.\d{2}$/.test(zeroLine),
  );
  ok(
    'and a tick column of three blanks, reserved all the same',
    confCells().length === 3 && confCells().every((c) => c === ''),
  );
  W.Date.now = realNow;

  // 4. The day's own list counts a follow-list's entries over every undrawn
  // start of the day. DemU has four entries over e6, e45 and the T11
  // 3-ottelu, and one of the four is unconfirmed.
  const openList = async (hash, ms = 2200) => {
    appJs.navigate('/');
    await wait(300);
    appJs.navigate(hash);
    await wait(ms);
    return D.querySelector('#app details.varmistus');
  };
  const listRows = () =>
    [...D.querySelectorAll('#app details.varmistus tbody tr')].map((tr) =>
      [...tr.children].map((td) => td.textContent.trim()),
    );

  let det = await openList('/c/demo#/s/1');
  log(`DemU: "${det?.querySelector('summary')?.textContent}" ${JSON.stringify(listRows())}`);
  ok('a filtered day carries the confirmation list', !!det);
  ok("summarised in the entry list's own words", det?.querySelector('summary')?.textContent === 'Varmistaneita 3/4');
  // (Break on purpose: add the `open` attribute in confirmSection and the
  // day list is pushed down a table on every render.)
  ok('and collapsed, so the day list keeps its shape', det?.open === false);

  // Each undrawn start is read once, and the unconfirmed row leads whatever
  // its time. (Break on purpose: sort by closesTs alone in
  // watchConfirmations and the ottelu's earlier row takes the lead.)
  ok(
    'over every undrawn start of the day at once',
    listRows().length === 4 && new Set(listRows().map((r) => r[2])).size === 3,
  );
  ok(
    'unconfirmed first, then soonest deadline',
    listRows()
      .map((r) => r[1])
      .join('|') === 'Veera Mallinen|Sofia Demoinen|Sanni Demoinen|Emma Mittainen',
  );
  ok(
    'with the same tick column the entry list reserves',
    listRows()
      .map((r) => r[0])
      .join('|') === '|✓|✓|✓',
  );
  // The ottelu is one entry, though its three legs are three starts in the
  // day list. (Break on purpose: drop watchConfirmations' fold and Sofia is
  // three rows of six, under a summary reading 5/6.)
  ok(
    'and a multi-event is one row, named for itself',
    listRows().filter((r) => r[1] === 'Sofia Demoinen').length === 1 && listRows()[1][2] === 'T11 3-ottelu',
  );

  // Each row counts back from its own event's start, and only a row with
  // something left to do prints its deadline. The clock stands two hours
  // before e45's start, so e45's and e6's deadlines are ahead.
  const e45Starts = new W.Date(
    rows.find((r) => r.EventId === 'e45').BeginDateTimeWithTZ.replace(/\.\d+/, ''),
  ).getTime();
  W.Date.now = () => e45Starts - 2 * 60 * 60 * 1000;
  det = await openList('/c/demo#/s/1');
  log(`DemU, deadlines ahead: ${JSON.stringify(listRows().map((r) => r[3]))}`);
  ok('an open deadline prints as a clock time', /^sulkeutuu \d{1,2}\.\d{2}$/.test(listRows()[0][3]));
  // (Break on purpose: print the deadline on every row in confirmSection and
  // the ticked rows grow a deadline nobody has to act on.)
  ok(
    'and only on the row that has not confirmed',
    listRows()
      .slice(1)
      .every((r) => r[3] === ''),
  );
  const dLink = D.querySelector('#app details.varmistus a');
  log(`row link: "${dLink?.textContent}" -> ${dLink?.getAttribute('href')} ${dLink?.target} ${dLink?.rel}`);
  ok(
    'the deadline is the portal link here too, next to the person to chase',
    dLink?.getAttribute('href') === 'https://www.tuloslista.com/varmistus/#!/demo' &&
      dLink?.target === '_blank' &&
      dLink?.rel === 'noopener' &&
      dLink.textContent === listRows()[0][3],
  );

  // Past both deadlines the list stays and there is nothing left to tap.
  W.Date.now = () => e45Starts + 60 * 60 * 1000;
  det = await openList('/c/demo#/s/1');
  log(`DemU, deadlines past: ${JSON.stringify(listRows().map((r) => r[3]))}`);
  ok('past the deadline the row says so in words', listRows()[0][3] === 'sulkeutunut');
  ok('and the portal link is gone with it', !D.querySelector('#app details.varmistus a'));
  ok('while the count itself stands', det?.querySelector('summary')?.textContent === 'Varmistaneita 3/4');
  W.Date.now = realNow;

  // Another follow-list counts its own entries alone.
  det = await openList('/c/demo#/s/2');
  log(`MalV: "${det?.querySelector('summary')?.textContent}" ${JSON.stringify(listRows())}`);
  ok(
    "another club counts its own and nobody else's",
    det?.querySelector('summary')?.textContent === 'Varmistaneita 0/3' &&
      listRows()
        .map((r) => r[0])
        .join('|') === '||',
  );

  // The ottelu's row is ticked off the root, as a leg's list can disagree
  // with it (docs/tuloslista-api.md). This athlete has confirmed the ottelu and
  // not its 40m (demo.js). (Break on purpose: tick the row off the leg's own
  // enrolment in confirmRows and she reads unconfirmed here, while the
  // Ottelut box counts her in.)
  det = await openList('/c/demo#/s/3');
  log(`TeKi: "${det?.querySelector('summary')?.textContent}" ${JSON.stringify(listRows())}`);
  const venla = listRows().find((r) => r[1] === 'Venla Testinen');
  ok(
    'a multi-event row is ticked off the root, not off a leg',
    venla && venla[0] === '✓' && venla[2] === 'T11 3-ottelu',
  );

  // This is 3c for the day's list. NäVa's only undrawn entry of the day is in
  // e46, where nobody has confirmed, so the setting's presence alone puts the
  // list up. (Break on purpose: read the setting's value and this club is
  // told nothing on the day it has something to do.) The clock stands ahead
  // of e46's deadline, or the row reads "sulkeutunut" in the afternoon.
  const e46Starts = new W.Date(
    rows.find((r) => r.EventId === 'e46').BeginDateTimeWithTZ.replace(/\.\d+/, ''),
  ).getTime();
  W.Date.now = () => e46Starts - 2 * 60 * 60 * 1000;
  det = await openList('/c/demo#/s/4');
  log(`NäVa: "${det?.querySelector('summary')?.textContent}" ${JSON.stringify(listRows())}`);
  ok(
    'a club with no confirmation anywhere near it still gets the list',
    det?.querySelector('summary')?.textContent === 'Varmistaneita 0/1' && listRows().length === 1,
  );
  ok('and the row is the one to act on, deadline and all', /^sulkeutuu \d{1,2}\.\d{2}$/.test(listRows()[0]?.[3] || ''));
  W.Date.now = realNow;

  // With no follow-list there is no list. An unfiltered render collects no
  // rows, and watchConfirmations returns null for none. renderComp's
  // listFiltered guard is a second lock, so breaking it alone passes. (Break
  // on purpose: drop `if (!rows.length) return null` from watchConfirmations
  // and an unfiltered day grows a "Varmistaneita 0/0".)
  // The quick-filter is stored per competition (compViewState), so `/c/demo`
  // alone still opens filtered. Clearing the key drops the filter.
  W.localStorage.removeItem('kisatCompView');
  await openList('/c/demo');
  log(
    `unfiltered day: rows ${D.querySelectorAll('#app .row').length}, varmistus ${!!D.querySelector('#app details.varmistus')}`,
  );
  ok(
    'an unfiltered day carries no confirmation list at all',
    !D.querySelector('#app details.varmistus') && D.querySelectorAll('#app .row').length > 3,
  );

  // 5. The Ottelut box counts the root's field in the day list's own words,
  // with no deadline (combinedCounts). Of its three multi-events, two are
  // not started. Two of the undrawn T11's three have confirmed, and one of
  // them has not in its 40m (demo.js).
  const otteluSubs = (label) => {
    const row = [...D.querySelectorAll('#app a.row[href*="/o/"]')].find(
      (r) => r.querySelector('.row-title')?.textContent.trim() === label,
    );
    return [...(row?.querySelectorAll('.row-sub') || [])].map((n) => n.textContent.trim());
  };
  const withCounts = async () => {
    await openList('/c/demo');
    const box = D.querySelector('#app details.day-filter');
    if (!box.open) {
      box.querySelector('summary').click();
      await wait(150);
    }
    const chip = [...box.querySelectorAll('button.chip-toggle')].find(
      (b) => b.textContent.trim() === 'Erät ja osallistujat',
    );
    if (chip.getAttribute('aria-pressed') === 'false') {
      chip.click();
      await wait(900);
    }
  };
  await withCounts();
  log(
    `ottelu boxes: ${['T11', 'P9', 'T9'].map((c) => `${c} ${JSON.stringify(otteluSubs(`${c} 3-ottelu`))}`).join(' ')}`,
  );
  // (Break on purpose: count a leg in combinedCountLine and this reads 1/3,
  // as the 40m has one confirmation fewer than the root.)
  ok('the Ottelut box counts the ottelu, not a leg of it', otteluSubs('T11 3-ottelu')[0] === '2/3 varmistanutta');
  // (Break on purpose: print confirmNote's own line here and the day list
  // grows a second wording of the same fact, with a deadline.)
  ok(
    'in the words every other row of the day list uses',
    otteluSubs('T11 3-ottelu').length === 1 && !/sulkeutu/.test(otteluSubs('T11 3-ottelu')[0]),
  );
  // (Break on purpose: gate the count on Unallocated in place of
  // combinedStarted and the drawn ottelu loses it hours before it runs.)
  ok('a drawn one carries it too', otteluSubs('P9 3-ottelu')[0] === '3/4 varmistanutta');
  ok('and a started one carries none', otteluSubs('T9 3-ottelu').length === 0);

  // 6. The ottelu's own page carries the entry list's notice with its
  // deadline. The clock stands two hours before P9's first
  // leg, so its deadline is ahead.
  const e38Starts = new W.Date(
    rows.find((r) => r.EventId === 'e38').BeginDateTimeWithTZ.replace(/\.\d+/, ''),
  ).getTime();
  const otteluNotices = async (key) => {
    appJs.navigate(`/c/demo/o/${encodeURIComponent(key)}`);
    await wait(1400);
    return [...D.querySelectorAll('#app .notice')].map((n) => n.textContent.trim());
  };
  W.Date.now = () => e38Starts - 2 * 60 * 60 * 1000;
  const otteluPage = await otteluNotices('P9 3-ottelu');
  log(`P9 page: ${JSON.stringify(otteluPage)}`);
  ok(
    "the ottelu's own page carries the count too",
    /^Varmistaneita 3\/4 · sulkeutuu \d{1,2}\.\d{2}$/.test(otteluPage[0] || ''),
  );
  ok('and says it once', otteluPage.length === 1);
  // (Break on purpose: push it below the standings.)
  const oCount = D.querySelector('#app .notice');
  ok(
    'above the table it is about',
    oCount.compareDocumentPosition(D.querySelector('#app table.standings')) === Node.DOCUMENT_POSITION_FOLLOWING,
  );
  const oLink = oCount.querySelector('a');
  ok(
    'with the portal link on the deadline, as everywhere else',
    oLink?.getAttribute('href') === 'https://www.tuloslista.com/varmistus/#!/demo' &&
      oLink?.target === '_blank' &&
      oLink?.rel === 'noopener',
  );
  const running = await otteluNotices('T9 3-ottelu');
  log(`T9 page: ${JSON.stringify(running)}`);
  ok('and a started ottelu says nothing about confirmation', !running.some((t) => t.startsWith('Varmistaneita')));
  W.Date.now = realNow;

  // 7. A multi-event's leg lists whoever is out of the ottelu under "Ei
  // erissä", as the meet stops drawing them. Only the root's total says why
  // (combinedWithdrawn, lib/combined.js). The demo's T9 Kuula leaves one of
  // seven out, and her root total is a DNF (demo.js).
  await open('e36');
  const outRows = [...D.querySelectorAll('#app .tbl tbody tr')].map((tr) => tr.textContent.replace(/\s+/g, ' ').trim());
  log(`T9 Kuula "Ei erissä": ${JSON.stringify(outRows)}`);
  const badges = [...D.querySelectorAll('#app .name-badge')].map((b) => b.textContent);
  log(`badges: ${JSON.stringify(badges)}`);
  // (Break on purpose: test the total as `Number(a.Result) < 0` in
  // combinedWithdrawn and the badge goes, as NaN compares false.)
  ok(
    'the one out of the ottelu is named on the leg she is entered in',
    outRows.some((t) => t.includes('Pihla Harjoitinen') && t.includes('ei jatka')),
  );
  ok('and nobody else carries the word', badges.filter((t) => t === 'ei jatka').length === 1);
  // The guest is ranked nowhere either and is racing all the same. (Break
  // on purpose: mark every unranked root row and she reads withdrawn.)
  ok(
    'a guest is ranked nowhere and is not out of it',
    !outRows.some((t) => t.includes('Ilona Vierainen') && t.includes('ei jatka')),
  );

  W.localStorage.removeItem('kisatCompView');
}
