// Checks the mode split (docs/juoksut.md) in Juoksut mode, then reloads into
// Kisat mode, where each thing Juoksut mode lacks must be present. No Worker
// is needed, as the checks read the demo and what home leaves out.
//   dev/probe.html?probe=probe-mode&url=%3Fmode%3Djuoksut
export default async function probe({ frame, W, log, ok, groupKey, appJs, libJs, settle, reload }) {
  const doc = () => frame.contentDocument;
  const app = () => doc().getElementById('app');
  const appText = () => app().textContent;
  const go = async (hash) => {
    appJs.navigate(hash);
    await settle();
  };
  const rows = () => [...app().querySelectorAll('.list > .row')];
  const seg = () => app().querySelector('.filter-bar .seg');
  const segLabels = () => [...(seg()?.querySelectorAll('.seg-btn') || [])].map((b) => b.textContent);
  const pressed = () =>
    [...(seg()?.querySelectorAll('.seg-btn') || [])].find((b) => b.getAttribute('aria-pressed') === 'true')
      ?.textContent;

  const K800 = groupKey(9, 0, '800m');

  // A view state stored by another run would set the toggle, so it is cleared.
  W.localStorage.removeItem('kisatCompView');
  // A dev host serves both modes from one origin, so Juoksut mode can read a
  // follow-list stored in Kisat mode (kisatFollow). viewStateFor's mode gate
  // must stop Juoksut mode sending it to /api. The Kisat half removes it.
  W.localStorage.setItem('kisatFollow', '"abcdef123456"');
  W.localStorage.setItem('kisatWatches', '[{"watchId":"abcdef123456","label":"Testiseuranta"}]');
  W.localStorage.setItem('kisatRecentComps', '[{"id":"probe","name":"Probe recent","range":"1.–2.8."}]');
  await reload(W.location.href);

  // --- Juoksut mode's home is a plain listing and nothing else ---
  ok('the app names itself Juoksut', doc().getElementById('title').textContent.startsWith('Juoksut'));
  ok('home offers no follow-list bar', !app().querySelector('.filter-bar'));
  ok('...no Seuratut', !appText().includes('Seuratut'));
  // (Break on purpose: fold Viimeksi katsotut in both modes.)
  ok(
    '..."Viimeksi katsotut" open under its own heading',
    [...app().querySelectorAll('h2')].some((h) => h.textContent === 'Viimeksi katsotut') &&
      !app().querySelector('details'),
  );
  ok('...and no competition rows carrying athlete lines', !app().querySelector('.scan-athlete'));
  ok(
    '...and the follow-list stored under this origin was not scanned for',
    !appText().includes('Seurannan kilpailujen haku epäonnistui'),
  );

  // The help sheet is Juoksut mode's and links to Kisat. Each sheet is matched
  // on what the other mode lacks, the lap counter here and follow-lists below
  // (docs/juoksut.md). A phrase on both sheets would pass on the wrong one.
  doc().getElementById('help').click();
  await settle();
  const sheet = () => doc().querySelector('.sheet');
  ok("the help sheet is Juoksut's own", sheet()?.textContent.includes('kierroslaskuri'));
  ok('...and links to Kisat', !!sheet()?.querySelector('a[href*="kisat.matilainen.fi"]'));
  sheet().querySelector('.sheet-close')?.click();
  await settle();

  // --- The schedule view's one control asks the other question ---
  await go('/c/demo');
  ok('the schedule view has a segmented control', !!seg());
  ok('...asking about categories', segLabels().join('/') === 'Ratalajit/Kaikki');
  ok('...defaulting to the track', pressed() === 'Ratalajit');
  ok(
    'no follow-list chip beside it',
    !app().querySelector('.filter-bar .watch-chip') &&
      ![...app().querySelectorAll('.filter-bar .btn')].some((b) => /Seuranta/.test(b.textContent)),
  );
  ok(
    '...and the stored list was not resolved against this meet either',
    !appText().includes('Seurannan haku epäonnistui'),
  );

  // The meet's track sits at the right-hand end of the toggle's row, so it
  // costs a phone no row of screen (docs/venues.md, "The locality heads an
  // option group").
  // (Break on purpose: put the picker in a row of its own. It lands about
  // 47 px lower with the day list under it, and the row check fails.)
  const pick = () => app().querySelector('.track-pick');
  const box = (n) => n.getBoundingClientRect();
  log(`seg ${JSON.stringify(box(seg()).toJSON())}`);
  log(`track ${pick() ? JSON.stringify(box(pick()).toJSON()) : 'none'}`);
  ok("the meet's track sits on the same bar", pick()?.parentElement === seg().parentElement);
  ok("...on the toggle's own row", box(pick()).top < box(seg()).bottom);
  ok('...at its right-hand end', box(pick()).left > box(seg()).right);

  const runRows = rows().length;
  ok('the day lists the races', runRows > 5);
  ok('...and none of the field events', !appText().includes('Kuula') && !appText().includes('Pituus'));
  ok('...but the relays, which are ratalajit too', appText().includes('viesti'));
  // A view narrowed to disciplines drops the Ottelut section, whose heading
  // is the fold's summary (renderComp). A multi-event's
  // running legs stay ordinary rows.
  // (Break on purpose: drop runOnly from meetDay's multiEvents.)
  const headings = () => [...app().querySelectorAll('h2, :scope > details > summary')].map((h) => h.textContent.trim());
  ok('...and no Ottelut section', !headings().includes('Ottelut'));
  ok("...though a multi-event's own races are listed", /3-ottelu\s+40m/.test(appText()));

  [...seg().querySelectorAll('.seg-btn')].find((b) => b.textContent === 'Kaikki').click();
  await settle();
  ok('Kaikki brings the whole programme back', rows().length > runRows);
  ok('...field events and all', appText().includes('Kuula'));
  ok('...and the Ottelut section with them', headings().includes('Ottelut'));
  ok(
    '...and the choice is remembered for this meet',
    (W.localStorage.getItem('kisatCompView') || '').includes('"cats":"all"'),
  );
  // The toggle is view state, as Kisat mode's mode toggle is, and not in the
  // URL.
  [...seg().querySelectorAll('.seg-btn')].find((b) => b.textContent === 'Ratalajit').click();
  await settle();
  await go(`/c/demo/g/${encodeURIComponent(K800)}`);
  await go('/c/demo');
  ok('the toggle survives leaving the view', pressed() === 'Ratalajit');
  ok('...and the field events are gone again', !appText().includes('Kuula'));

  // --- The rest of the follow-list, absent ---
  await go(`/c/demo/g/${encodeURIComponent(K800)}`);
  ok(
    "a start's names are plain text, not quick-filter links",
    !!app().querySelector('.tbl') && !app().querySelector('.athlete-link'),
  );
  // Both activation links are Kisat mode's. A dev host has no other origin to
  // send them to, so they fall through to home. In production they leave for
  // the Kisat host (renderRoute, app.js).
  await go('/#/w/abcdef123456');
  ok(
    'a share link does not activate a follow-list here',
    W.location.pathname === '/' && !appText().includes('Seuranta'),
  );
  await go('/c/demo#/a/9001');
  ok('...nor does an athlete link', W.location.pathname === '/');
  // A meet that stands alone is Kisat's too (routeMode, lib/routes.js).
  await go('/c/maraton-2026');
  ok('...nor does a meet that stands alone open', W.location.pathname === '/');

  // --- Kisat mode, where all of it is supposed to be ---
  // The mode is read once at boot from the query string, so this reloads.
  W.localStorage.removeItem('kisatFollow');
  W.localStorage.removeItem('kisatWatches');
  await reload('/');
  appJs.navigate('/c/demo');
  await settle();
  ok('Kisat mode names itself Kisat', doc().title === 'Kisat');
  ok(
    '...and lists the whole programme, with no category toggle to ask',
    appText().includes('Kuula') && !segLabels().includes('Ratalajit'),
  );
  ok('...nor a track to pick, which only the counter has a use for', !pick());
  ok(
    '...offers the follow-list chip instead',
    [...app().querySelectorAll('.filter-bar .btn')].some((b) => b.textContent.includes('Ei seurantaa')),
  );
  // The hurdle work is Juoksut mode's (docs/hurdles.md). A gate written as a
  // global passes every check in Juoksut mode, so each part is read here.
  ok('...nor the hurdle lines on its day', !app().querySelector('.hurdle-line'));
  doc().querySelector('#title .title-menu').click();
  await settle();
  const menu = [...doc().querySelectorAll('.sheet-menu .row-title')].map((t) => t.textContent);
  ok("...nor a day's paper in its menu", menu.length > 0 && !menu.includes('Päivän aidat'));
  doc().querySelector('.sheet-close').click();
  await settle();
  await go(`/c/demo/g/${encodeURIComponent(groupKey(10, 10, '60m aidat'))}`);
  ok(
    '...nor a hurdle box on a hurdle start',
    doc().getElementById('title').textContent.includes('60m aidat') && !app().querySelector('details.hurdles'),
  );
  await go(libJs.hurdleSheetPath('demo', new Date().toLocaleDateString('fi-FI')));
  ok("...and the day's paper falls to home", doc().getElementById('title').textContent.startsWith('Kisat'));
  await go('/c/demo/k/helsinki-elaintarha');
  ok('...as does a kenttä link', doc().getElementById('title').textContent.startsWith('Kisat'));
  appJs.navigate(`/c/demo/g/${encodeURIComponent(K800)}`);
  await settle();
  ok('...and a name is a quick-filter link again', !!app().querySelector('.athlete-link'));
  appJs.navigate('/');
  await settle();
  ok('home carries the bar in Kisat mode', !!app().querySelector('.filter-bar'));
  ok(
    '...and folds "Viimeksi katsotut"',
    app().querySelector('details.fold > summary')?.textContent === 'Viimeksi katsotut',
  );
  W.localStorage.removeItem('kisatRecentComps');
  doc().getElementById('help').click();
  await settle();
  ok("...and the help sheet is Kisat's own", sheet()?.textContent.includes('seurata haluamiasi seuroja'));
  sheet().querySelector('.sheet-close')?.click();
}
