// Checks the whole hurdle table, /mitat#/aidat (renderHurdleTable,
// app/tables.js; docs/hurdles.md, "The table page"), and the links to it in
// both modes. test/hurdles.test.mjs tests hurdleTableSections. It loads
// /mitat and /aidat as pages, and only the Worker answers a path, so this
// needs the Worker.
//   dev/probe.html?probe=probe-aitataulukko&url=mitat%3Fmode%3Djuoksut
// A probe cannot read the page count. A print has a page per table with a
// class chosen, two for the whole outdoor sheet and three for both sheets
// (2026-10). On make dev:
//
//   pnpm exec playwright-core pdf --wait-for-timeout=3000 \
//     'http://localhost:<DEV_PORT>/mitat?mode=juoksut#/aidat' aidat.pdf
//   python3 -c "import re;print(len(re.findall(rb'/Type\s*/Page[^s]',open('aidat.pdf','rb').read())))"
export default async function probe({ frame, W, log, ok, wait, appJs, libJs, settle, reload }) {
  const doc = () => frame.contentDocument;
  const app = () => doc().getElementById('app');
  const go = async (hash) => {
    appJs.navigate(hash);
    await settle();
  };
  const pages = () => [...app().querySelectorAll('.aidat-page')];
  const rowsOf = (page) =>
    [...page.querySelectorAll('tbody tr:not(.aidat-title)')].filter((tr) => !tr.querySelector('.aidat-figure'));
  const cats = (page) => rowsOf(page).map((tr) => tr.firstElementChild.textContent.trim());
  const titles = (page) => [...page.querySelectorAll('.aidat-title th')].map((t) => t.textContent);
  const chips = () => [...app().querySelectorAll('.aidat-chips .chip-toggle')];
  const chip = (label) => chips().find((c) => c.getAttribute('aria-label') === label);
  const sel = () => app().querySelector('.track-pick select');
  const figs = () => app().querySelectorAll('.aidat-page .shuttle-tapes').length;

  // A link with no kenttä shows both sheets under Kaikki. Each sex's 47
  // setups merge to 21 and 34 rows.
  log(`default: select "${sel()?.value}", rows ${rowsOf(pages()[0]).length} / ${rowsOf(pages()[1]).length}`);
  ok(
    'the page is two tables, women first, both sheets by default',
    pages().length === 2 &&
      doc().getElementById('title').textContent.startsWith('Aita- ja välinemitat') &&
      pages()[0].querySelector('h2').firstChild.textContent === 'Tytöt ja naiset' &&
      pages()[1].querySelector('h2').firstChild.textContent === 'Pojat ja miehet' &&
      sel().value === '' &&
      rowsOf(pages()[0]).length === 21 &&
      rowsOf(pages()[1]).length === 34 &&
      pages()[0].querySelector('.aidat-print').textContent === '',
  );
  // A phone holds the whole table, as index.html's 520 px block caps the class
  // cell and wraps Korkeus, and the chips take three rows. (Break on purpose:
  // drop that block's .hurdle-cats-cell width, and the mitat scroll off.)
  const wrap = pages()[0].querySelector('.tbl-wrap');
  log(
    `table ${wrap.scrollWidth} in ${wrap.clientWidth}; chips ${Math.round(app().querySelector('.aidat-chips').getBoundingClientRect().height)} px high`,
  );
  ok(
    'the whole table fits a phone',
    wrap.scrollWidth <= wrap.clientWidth &&
      app().querySelectorAll('.aidat-chip-row').length === 3 &&
      app().querySelector('.aidat-chips').getBoundingClientRect().height < 130,
  );
  await go('#/aidat/k/ulkoradat');
  log(`ulkoradat: rows ${rowsOf(pages()[0]).length} / ${rowsOf(pages()[1]).length}; ${titles(pages()[0]).join(', ')}`);
  // The outdoor sheet's 46 rows and WMA's short and long races merge to 14
  // and 23, with 60 m first and only the young classes on it. (Break on
  // purpose: merge nothing, and the counts grow. Drop `where` from onTrack,
  // and the men's 60 m grows the adults' rows.)
  ok(
    "the field: the outdoor sheet's merged rows, 60 m first",
    rowsOf(pages()[0]).length === 14 &&
      rowsOf(pages()[1]).length === 23 &&
      titles(pages()[0])[0] === '60 m aidat' &&
      !cats(pages()[1])
        .slice(0, 3)
        .some((c) => c.includes('M17')),
  );
  // A masters band is written out as its classes, and no range shows.
  // (Break on purpose: name a WMA band by its row.)
  ok(
    'a masters band is its classes',
    cats(pages()[1]).includes('M35, M40, M45') && !app().textContent.includes('35-49'),
  );
  // An unpainted setting reads "–" with its mitat unmuted. The chip draws a
  // figure per set of positions, two under the women's 80 m, and none shows
  // unasked. (Break on purpose: draw the figures unconditionally.)
  const women80 = pages()[0].querySelectorAll('tbody')[1];
  const none = [...women80.querySelectorAll('td.hurdle-none')];
  const colour = (n) => W.getComputedStyle(n).color;
  ok(
    'an unpainted setting says so and unmutes its mitat',
    none.length === 3 &&
      none.every(
        (td) =>
          td.textContent === '–' &&
          colour(td.parentElement.lastElementChild) === colour(td.parentElement.firstElementChild),
      ),
  );
  ok('...and draws no figure unasked', figs() === 0);
  app().querySelector('.aidat-figures').click();
  await settle();
  ok(
    '...the chip draws one per set of positions',
    figs() === 5 && pages()[0].querySelectorAll('tbody')[1].querySelectorAll('.shuttle-tapes').length === 2,
  );
  app().querySelector('.aidat-figures').click();
  await settle();
  ok('...and takes them away again', figs() === 0);
  // The sections fold closed, and print hides a closed one (index.html).
  const extras = () => [...app().querySelectorAll('details.aidat-extra')];
  ok(
    'the relays and the steeples fold under, closed',
    extras()
      .map((d) => d.querySelector('summary').textContent)
      .join() === 'Aitaviestit,Esteet' && extras().every((d) => !d.open),
  );
  extras()[0].open = true;
  const relayRows = [...extras()[0].querySelectorAll('tbody tr')].map((tr) => tr.firstElementChild.textContent.trim());
  ok(
    'the relays merge across the sexes, the sekaviesti its own block',
    relayRows[1] === 'T10, T11, P10, P11' &&
      relayRows.includes('M/N sekaviesti') &&
      extras()[0].querySelectorAll('.shuttle-tapes').length === 5,
  );

  // The indoor sheet has 60 m for everyone, 300 m for the seniors and no
  // steeples. (Break on purpose: make tablePageSheet call only a 200 m track
  // indoor, and the 300 m hall below fails.)
  await go('#/aidat/k/sisaradat');
  log(`sisaradat: rows ${rowsOf(pages()[0]).length} / ${rowsOf(pages()[1]).length}; ${titles(pages()[1]).join(', ')}`);
  ok(
    'the indoor sheet, and no steeples',
    titles(pages()[1]).join() === '60 m aidat,300 m aidat' &&
      rowsOf(pages()[0]).length === 11 &&
      rowsOf(pages()[1]).length === 15 &&
      cats(pages()[1]).includes('M19, M22, M') &&
      extras()
        .map((d) => d.querySelector('summary').textContent)
        .join() === 'Aitaviestit',
  );
  sel().value = 'v:tampere-pirkkahalli';
  sel().dispatchEvent(new W.Event('change'));
  await settle();
  log(`Pirkkahalli: ${W.location.hash}, select ${sel().value}, ${titles(pages()[1]).join(', ')}`);
  // A named hall keeps the sheet and drops a distance its track cannot hold,
  // so a 300 m hall keeps the 300 m. (Break on purpose: make the length
  // filter in hurdleTableSections strict, and the 300 m goes.)
  ok(
    '...a named hall the same, its 300 m kept at 300 m',
    W.location.hash === '#/aidat/k/tampere-pirkkahalli' && titles(pages()[1]).join() === '60 m aidat,300 m aidat',
  );

  // A chip filters both tables to the class, names it alone and rewrites the
  // fragment. (Break on purpose: name the whole band, and "M35, M40, M45"
  // survives the filter.)
  await go('#/aidat/k/ulkoradat');
  chip('N/M 40').click();
  await settle();
  ok(
    "a chip keeps the class's rows in both tables, named alone",
    W.location.hash === '#/aidat/40/k/ulkoradat' &&
      chip('N/M 40').classList.contains('on') &&
      cats(pages()[0]).join() === 'N40,N40' &&
      cats(pages()[1]).join() === 'M40,M40',
  );
  chip('T/P 12').click();
  await settle();
  ok(
    '...a second chip adds its rows',
    W.location.hash === '#/aidat/12,40/k/ulkoradat' && cats(pages()[0]).join() === 'T12,N40,T12,N40',
  );
  chip('N/M 40').click();
  await settle();
  ok(
    '...and a tap on a lit chip drops it',
    W.location.hash === '#/aidat/12/k/ulkoradat' && !chip('N/M 40').classList.contains('on'),
  );
  // The heading names the choice for paper, which shows no chips.
  ok(
    'the heading names the chosen classes and the track for print',
    pages()[0].querySelector('.aidat-print').textContent === ' · T12 · Ulkoradat',
  );

  // A kenttä's board replaces the sheet's marks, the fragment carries the
  // kenttä and the heading names it. (Break on purpose: hand
  // hurdleTableSections the sheet's table and not venueTable's.)
  sel().value = 'v:helsinki-heteniitty';
  sel().dispatchEvent(new W.Event('change'));
  await settle();
  ok(
    'a kenttä rides in the fragment, and the heading names it',
    W.location.hash === '#/aidat/12/k/helsinki-heteniitty' &&
      sel().value === 'v:helsinki-heteniitty' &&
      pages()[0].querySelector('.aidat-print').textContent === ' · T12 · Helsinki, Heteniitty',
  );
  await go('#/aidat/k/helsinki-liikuntamylly');
  const women60 = () => pages()[0].querySelector('tbody');
  log(`Liikuntamylly women's 60 m: ${women60().querySelectorAll('td.hurdle-none').length} unmarked`);
  ok(
    "...and its board replaces the sheet's marks",
    women60().querySelectorAll('td.hurdle-none').length === 1 &&
      [...pages()[0].querySelectorAll('td.hurdle-none')].length === 1,
  );
  ok('...and a 200 m hall drops the 300 m', titles(pages()[1]).join() === '60 m aidat');
  // The mitat are never muted here, whatever the mark. (Break on purpose:
  // drop the .aidat-all td.num.hurdle-dim rule from index.html.)
  const marked = [...pages()[0].querySelectorAll('tbody tr')].find((tr) => tr.querySelector('.hurdle-mark'));
  ok(
    '...and the mitat are unmuted behind a mark too',
    colour(marked.lastElementChild) === colour(marked.firstElementChild),
  );

  // Every Juoksut view with a kenttä offers the table on that kenttä from the
  // title menu (tablePageRow, app/hurdles.js). A relay's or a steeple's start
  // opens its own folded section (tablePageSection).
  await reload('/?mode=juoksut#/c/demo');
  const rowOf = (name) =>
    [...app().querySelectorAll('.row')].find((r) => r.querySelector('.row-title')?.textContent.startsWith(name));
  const tableHref = async () => {
    doc().querySelector('#title .title-menu').click();
    await settle();
    const href = [...doc().querySelectorAll('.sheet-menu .row')]
      .find((r) => r.querySelector('.row-title').textContent === 'Aita- ja välinemitat')
      ?.getAttribute('href');
    doc().querySelector('.sheet-close').click();
    await settle();
    return href;
  };
  const daySel = app().querySelector('.track-pick select');
  daySel.value = 'v:helsinki-heteniitty';
  daySel.dispatchEvent(new W.Event('change'));
  await settle();
  const sheetHref = libJs.hurdleSheetPath('demo', new Date().toLocaleDateString('fi-FI'));
  await go(rowOf('60m aidat').getAttribute('href'), 2500);
  const boxLink = await tableHref();
  log('start menu ' + boxLink);
  ok(
    "a start's menu opens the whole table on the meet's kenttä",
    boxLink === '/mitat?mode=juoksut#/aidat/k/helsinki-heteniitty',
  );
  // (Break on purpose: give the box a link to the table, and the start has
  // two doors to one page.)
  ok('...the box itself carrying no link of its own', !app().querySelector('details.hurdles a'));
  await go('/c/demo');
  await go(rowOf('4x60m aitaviesti').getAttribute('href'), 2500);
  const relayLink = await tableHref();
  log('relay menu ' + relayLink);
  ok("a relay's menu opens the relays", relayLink === '/mitat?mode=juoksut#/aidat/k/helsinki-heteniitty/viestit');
  await go(sheetHref);
  const sheetLink = await tableHref();
  log('sheet menu ' + sheetLink);
  ok('the day sheet offers the whole table too', sheetLink === '/mitat?mode=juoksut#/aidat/k/helsinki-heteniitty');
  await reload(relayLink);
  ok(
    "...and the relays' link lands with Aitaviestit open, staying open past a chip",
    extras()[0].open &&
      !extras()[1].open &&
      rowsOf(pages()[0]).length === 14 &&
      (chip('T/P 12').click(),
      await wait(1500),
      extras()[0].open && W.location.hash === '#/aidat/12/k/helsinki-heteniitty/viestit'),
  );
  await reload('/?mode=juoksut#/c/demo');
  app().querySelector('.track-pick select').value = '400';
  app().querySelector('.track-pick select').dispatchEvent(new W.Event('change'));
  await settle();
  await go('/');
  // Home's title is a menu, and it offers the tables.
  doc().querySelector('#title .title-menu').click();
  await settle();
  const homeLink = doc().querySelector('.sheet-menu a.row');
  ok(
    "home's title menu links to the tables",
    homeLink?.getAttribute('href') === '/mitat?mode=juoksut#/aidat' && homeLink.textContent === 'Aita- ja välinemitat',
  );
  doc().querySelector('.sheet-close').click();
  await settle();

  // --- Kisat mode serves the page too (docs/juoksut.md), and a shared
  // /aidat link lands on it with its fragment (docs/shims.md) ---
  await reload('/aidat#/12');
  ok(
    'Kisat mode renders the table, off the old link',
    doc().getElementById('title').textContent.startsWith('Aita- ja välinemitat') &&
      W.location.pathname === '/mitat' &&
      W.location.hash === '#/12' &&
      cats(pages()[0]).join() === 'T12,T12',
  );
  doc().querySelector('#title .title-menu').click();
  await settle();
  ok('...its title menu leads home', doc().querySelector('.sheet-menu a.row')?.getAttribute('href') === '/#/');
}
