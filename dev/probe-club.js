// Checks the club line as a link and the club sheet (docs/views.md,
// "The athlete and club sheets"), with its quick-filter, its follow-list entry,
// its activation link and the day list's copy. dev/probe.js and
// dev/probe-layers.js check a person's half. The demo has no Organization.Id 0,
// which test/indexes.test.mjs covers.
//   dev/probe.html?probe=probe-club&url=c/demo
// It needs the Worker, as it creates and reads a Watch through /api/watch.
export default async function probe({ W, D, log, ok, wait, appJs, settle }) {
  const appText = () => D.getElementById('app').textContent;
  const sheetButtons = () => [...D.querySelectorAll('.sheet .btn')].map((b) => b.textContent);
  const press = (text) =>
    [...D.querySelectorAll('.sheet .btn, .sheet .menu .row-title')].find((b) => b.textContent === text).click();
  const chip = () => D.querySelector('.filter-bar .watch-chip')?.textContent || '';
  const rowTitles = () => [...D.querySelectorAll('#app .list a.row .row-title')].map((r) => r.textContent);
  const goto = async (hash) => {
    appJs.navigate(hash);
    await settle();
  };

  for (const k of Object.keys(W.localStorage)) {
    if (k.startsWith('kisatWatchEdit:') || k === 'kisatWatches' || k === 'kisatCompView' || k === 'kisatFollow') {
      W.localStorage.removeItem(k);
    }
  }
  await goto('/', 300);
  await goto('/c/demo');

  // --- The link, in a results table ---
  const kuula = [...D.querySelectorAll('#app .list a.row')].find((r) => r.textContent.includes('Kuula'));
  kuula.click();
  await settle();
  const links = () => [...D.querySelectorAll('.club-link')];
  log(
    `club links in the start: ${links().length}, first "${links()[0]?.textContent}" → ${links()[0]?.getAttribute('href')}`,
  );
  // The club line under a name is a link in every table, as athleteNameParts
  // is the one name cell they share. (Break on purpose: have athleteNameParts
  // draw the club as plain text, and there is nothing to tap.)
  ok('the club under a name is a link', links().length > 0);
  // Outside the day list no <a> encloses it, so it is a real anchor. A
  // long-press copies the activation link of the filter the tap opens.
  ok(
    "and a real one, pointing at the club's own activation link",
    links()[0].tagName === 'A' && /^\/c\/demo#\/s\/\d+$/.test(links()[0].getAttribute('href')),
  );

  // --- What it opens ---
  const clubName = links()[0].textContent;
  links()[0].click();
  await settle();
  log(`club sheet: "${D.querySelector('.sheet-title')?.textContent}" / ${sheetButtons().join(' · ')}`);
  ok("it opens that club's sheet", D.querySelector('.sheet-title')?.textContent === clubName);
  // The club sheet makes the athlete sheet's two offers in the same order,
  // with the accent on the one that writes. (Break on purpose: swap the two
  // buttons' classes in clubActions, and the read-only action is the loud one.)
  ok(
    'offering the same two things a tapped name does',
    sheetButtons().length === 2 &&
      sheetButtons()[0] === 'Lisää seurantaan ▾' &&
      sheetButtons()[1] === 'Näytä seuran kaikki lajit' &&
      !D.querySelector('.sheet .btn').classList.contains('btn-secondary'),
  );
  // Under a club, "Näytä kaikki lajit" would read as the mode toggle's whole
  // day, so the label names the club.
  ok('and naming the club in the one label that would otherwise be ambiguous', sheetButtons()[1].includes('seuran'));

  // --- The quick-filter ---
  press('Näytä seuran kaikki lajit');
  await settle();
  log(`after the filter: hash=${W.location.pathname} chip="${chip()}"`);
  // From an event view the filter navigates to the day list, the one view it
  // shows in (openFocusFilter).
  ok('the filter lands on the day list it narrows', W.location.pathname === '/c/demo');
  ok('and the bar says which club is showing', chip().startsWith(`Näytä:${clubName}`));
  const stored = () => JSON.parse(W.localStorage.getItem('kisatCompView') || '[]')[0]?.focus || null;
  log(`stored focus: ${JSON.stringify(stored())}`);
  // Both quick-filters share one stored field, told apart by `kind`
  // (normalizeCompView, lib/routes.js).
  ok('stored as the club kind of the one quick-filter', stored()?.kind === 'club' && stored()?.mode === 'watched');
  const clubDay = rowTitles();
  log(`starts shown: ${clubDay.length}`);
  ok('the day is narrowed, not emptied', clubDay.length > 0);
  ok('and the mode toggle came with it', !!D.querySelector('.filter-bar .seg'));
  // The whole day below proves the filter narrowed something. (Break on
  // purpose: hand focusTargets the athlete shape for a club, and the day above
  // comes back empty, as no athlete id is an Organization.Id.)
  const shareBtn = [...D.querySelectorAll('.filter-bar .btn')].find((b) => b.textContent === 'Jaa linkki');
  ok("the filter is shareable, the same way an athlete's is", !!shareBtn);
  D.querySelector('.watch-chip-remove').click();
  await settle();
  const wholeDay = rowTitles();
  log(`whole day: ${wholeDay.length} starts, chip "${chip()}"`);
  ok('the × puts the whole day back', wholeDay.length > clubDay.length && !stored());

  // --- The activation link somebody was handed ---
  await goto('/c/demo#/s/1', 2200);
  log(`from the link: hash=${W.location.pathname} chip="${chip()}"`);
  // The link carries the id alone and takes the name off the roster
  // (activateFocusLink), so it holds on a device that never saw the row.
  ok(
    'a club link activates the same filter and names the club',
    W.location.pathname === '/c/demo' && chip().startsWith('Näytä:Demon Urheilijat'),
  );
  // A link to a club not in this meet says so and sets no filter. The check
  // reads the title, as activateFocusLink alone sets it and resolveFilter's
  // notice has the same words. (Break on purpose: drop the roster lookup in
  // activateFocusLink, and the link lands on the day list with a chip.)
  await goto('/c/demo#/s/424242', 2200);
  log(`unknown club: "${D.getElementById('title').textContent}" / ${appText().slice(0, 50)}`);
  ok(
    'a club with nobody entered here says so instead of filtering',
    D.getElementById('title').textContent === 'Seuraa ei löytynyt' &&
      appText().includes('Seuralla ei ole osallistujia'),
  );
  // The dead link writes no filter, so the meet keeps the club activated a
  // moment ago.
  await goto('/c/demo', 2200);
  log(`focus after the dead link: ${JSON.stringify(stored())}`);
  ok('and a link that went nowhere is not what the meet ends up filtered by', stored()?.id === '1');

  // --- Adding the club to a follow-list ---
  const watch = await (
    await W.fetch('/api/watch', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-kisat-client': '1' },
      body: JSON.stringify({
        label: 'Seuratesti',
        entries: [{ type: 'athlete', id: '60001234', name: 'Joku', enabled: true }],
      }),
    })
  ).json();
  // The quick-filter is cleared, as a focus wins over the list
  // (resolveFilter).
  W.localStorage.removeItem('kisatCompView');
  W.localStorage.setItem('kisatWatches', JSON.stringify([{ watchId: watch.id, label: watch.label }]));
  W.localStorage.setItem(`kisatWatchEdit:${watch.id}`, watch.editToken);
  W.localStorage.setItem('kisatFollow', JSON.stringify(watch.id));
  await goto('/', 300);
  await goto('/c/demo', 2200);
  const kuula2 = [...D.querySelectorAll('#app .list a.row')].find((r) => r.textContent.includes('Kuula'));
  kuula2.click();
  await settle();
  const link = [...D.querySelectorAll('.club-link')][0];
  const name2 = link.textContent;
  link.click();
  await settle();
  press('Lisää seurantaan ▾');
  await wait(400);
  log(`add menu: ${[...D.querySelectorAll('.sheet .menu .row-title')].map((r) => r.textContent).join(' · ')}`);
  // A club entry stores the Organization.Id the row carries, so the menu
  // opens with no fetch. (Break on purpose: invert addToWatchMenu's editToken
  // filter, and the list is not offered.)
  ok(
    'the lists this device can write are offered',
    [...D.querySelectorAll('.sheet .menu .row-title')].some((t) => t.textContent === 'Seuratesti'),
  );
  press('Seuratesti');
  await settle();
  const saved = await (await W.fetch(`/api/watch/${watch.id}`, { headers: { 'x-kisat-client': '1' } })).json();
  log(`entries now: ${JSON.stringify(saved.entries)}`);
  ok(
    'the club went onto the list as a club entry, by its Organization.Id',
    saved.entries.length === 2 && saved.entries[1].type === 'club' && saved.entries[1].name === name2,
  );
  ok('and the person already on it is untouched', saved.entries[0].type === 'athlete');
  log(`status: ${D.getElementById('updated')?.textContent}`);
  ok(
    'with both layers closed behind it and the list named',
    !D.querySelector('.sheet') &&
      (D.getElementById('updated')?.textContent || '').includes('Lisätty seurantaan "Seuratesti"'),
  );

  // --- The same link in the day list, inside the row's own <a> ---
  await goto('/c/demo', 2500);
  const teams = [...D.querySelectorAll('.watch-row-team .club-link')];
  const team = teams[0];
  log(
    `day-list team cells: ${teams.length}, first <${team?.tagName.toLowerCase()} role=${team?.getAttribute('role')}> "${team?.textContent}"`,
  );
  // A nested <a> is invalid HTML, so the day list draws a role=link span. Both
  // its line renderers do, watchAllocLine and combinedWatchLine in Ottelut.
  // (Break on purpose: hand either of them the anchor the results table gets.)
  ok(
    'the day list draws it as a role=link span, not a nested anchor',
    teams.length > 1 && teams.every((t) => t.tagName === 'SPAN' && t.getAttribute('role') === 'link'),
  );
  // The narrow column draws NameShort, and the tap opens the club under its
  // full name.
  const before = W.location.pathname;
  team.click();
  await settle();
  log(`after the nested tap: hash=${W.location.pathname} sheet="${D.querySelector('.sheet-title')?.textContent}"`);
  // (Break on purpose: skip clubNameLink's preventDefault when nested, and
  // the row's own anchor navigates away.)
  ok(
    'tapping it opens the club, and the row it sits in does not navigate',
    W.location.pathname === before && !!D.querySelector('.sheet-title'),
  );
  ok(
    "and the sheet is the club's, under its full name rather than the column's short one",
    D.querySelector('.sheet-title')?.textContent.length > (team.textContent || '').length,
  );
}
