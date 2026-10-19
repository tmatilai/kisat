// Checks the implement table (/mitat#/valineet, docs/implements.md) in both
// views, its chips and its switch to the hurdle table, and that both modes
// serve and link it. lib/tables.js builds the rows, and the offline suite
// tests them.
//
//   dev/probe.html?probe=probe-valineet&url=mitat%23%2Fvalineet
//
// It loads /mitat as a page, and only the Worker answers a path, so this needs
// `make dev`.
export default async function probe({ frame, W, log, ok, wait }) {
  const doc = () => frame.contentDocument;
  const app = () => doc().getElementById('app');
  const pages = () => [...app().querySelectorAll('.aidat-page')];
  const tables = (page) => [...page.querySelectorAll('table')];
  const titles = (page) => tables(page).map((t) => t.querySelector('.aidat-title th').textContent);
  const cats = (page) => [...page.querySelectorAll('tbody tr')].map((tr) => tr.firstElementChild.textContent.trim());
  const chip = (label) =>
    [...app().querySelectorAll('.aidat-chips .chip-toggle')].find((c) => c.getAttribute('aria-label') === label);

  log(`default: rows ${cats(pages()[0]).length} / ${cats(pages()[1]).length}`);
  const cols = () => pages()[0].querySelector('.setup-cols').children.length;
  const heads = () => [...pages()[0].querySelectorAll('.setup-cols th')].map((t) => t.textContent).join();
  // The weights show alone until asked, with an implement per column and a
  // row per set of weights. (Break on purpose: merge nothing in
  // implementWeightRows, and each table has a row per band of its sheet.)
  const menRow = (i) => [...pages()[1].querySelectorAll('tbody tr')[i].children].map((c) => c.textContent.trim());
  ok(
    'two tables, women first, an implement per column, the weights alone',
    pages().length === 2 &&
      doc().getElementById('title').textContent.startsWith('Aita- ja välinemitat') &&
      heads() === 'Sarja,Keihäs,Kiekko,Kuula,Moukari,Painonheitto' &&
      !pages()[0].querySelector('.aidat-title') &&
      cats(pages()[0]).length === 9 &&
      cats(pages()[1]).length === 12 &&
      cats(pages()[0])[4] === 'N19, N22, N' &&
      menRow(6).join() === 'M22, M,800 g,2 kg,7,26 kg,7,26 kg,–' &&
      menRow(0)[1] === '400 g',
  );
  ok(
    'the weights fit a phone',
    pages()[0].querySelector('.tbl-wrap').scrollWidth <= pages()[0].querySelector('.tbl-wrap').clientWidth,
  );
  app().querySelector('.valineet-dims').click();
  await wait(1500);
  // With every dimension, each implement has a section, and the rows merge
  // on the dimensions too.
  log(`every dimension: first table ${cols()} columns, rows ${cats(pages()[0]).length} / ${cats(pages()[1]).length}`);
  ok(
    'the chip shows every dimension, a section per implement',
    app().querySelector('.valineet-dims').classList.contains('on') &&
      titles(pages()[0]).join() === 'Keihäs,Kiekko,Kuula,Moukari,Painonheitto' &&
      cols() === 7 &&
      cats(pages()[0]).length === 25 &&
      cats(pages()[1]).length === 42,
  );
  ok(
    'a masters band is its classes, the sources merging on one weight',
    cats(pages()[1]).includes('M22, M, M35, M40, M45') && !app().textContent.includes('35-49'),
  );
  const keihas = tables(pages()[1])[0];
  log(`keihäs ${keihas.parentElement.scrollWidth} in ${keihas.parentElement.clientWidth}`);
  ok('the widest table scrolls in its wrap, not the page', doc().documentElement.scrollWidth <= W.innerWidth);
  ok(
    'a weight reads as a meet writes it',
    keihas.querySelector('tbody td.num').textContent === '400 g' &&
      tables(pages()[1])[2].querySelectorAll('tbody tr')[6].children[1].textContent === '7,26 kg',
  );
  ok('a maximum alone says so', keihas.textContent.includes('enint. 270'));
  app().querySelector('.valineet-dims').click();
  await wait(1500);
  ok('...and takes them away again', cols() === 6 && cats(pages()[0]).length === 9);

  // A chip keeps its classes alone and drops a section with none of them.
  // One row of chips covers both files' classes.
  ok("the chips are the hurdle page's", !!chip('T/P 8'));
  chip('T/P 8').click();
  await wait(1500);
  ok(
    "...the 8s on the 9s' weights",
    W.location.hash === '#/valineet/8' &&
      cats(pages()[0]).join() === 'T8' &&
      menRow(0).join() === 'P8,400 g,600 g,2 kg,2,5 kg',
  );
  chip('T/P 8').click();
  await wait(1500);
  chip('T/P 13').click();
  await wait(1500);
  ok(
    "a chip keeps the class's rows, named alone",
    W.location.hash === '#/valineet/13' && cats(pages()[0]).join() === 'T13' && cols() === 5,
  );
  chip('N/M 40').click();
  await wait(1500);
  ok(
    '...a second chip adds its rows',
    W.location.hash === '#/valineet/13,40' && cats(pages()[0]).join() === 'T13,N40' && cols() === 6,
  );
  ok(
    'the heading names the chosen classes for print',
    pages()[0].querySelector('.aidat-print').textContent === ' · T13, N40',
  );
  const sw = [...app().querySelectorAll('.table-switch a')];
  ok(
    'the switch under the chips carries the classes to the hurdle table',
    sw.map((a) => a.textContent).join() === 'Aidat,Heittovälineet' &&
      app().querySelector('.aidat-chips').nextElementSibling.contains(sw[0]) &&
      sw[0].getAttribute('href') === '#/aidat/13,40' &&
      sw[1].getAttribute('aria-current') === 'page' &&
      !sw[0].hasAttribute('aria-current'),
  );

  // Both hosts serve it, and the title menu leads each way (docs/juoksut.md).
  const menuLinks = async () => {
    doc().querySelector('#title .title-menu').click();
    await wait(1000);
    return [...doc().querySelectorAll('.sheet-menu a.row')]
      .map((a) => `${a.textContent} ${a.getAttribute('href')}`)
      .join();
  };
  for (const [mode, site] of [
    ['juoksut', 'Juoksut'],
    ['kisat', 'Kisat'],
  ]) {
    W.location.replace(`/mitat?mode=${mode}#/valineet/40`);
    await wait(2500);
    ok(
      `${mode}: renders the table`,
      doc().getElementById('title').textContent.startsWith('Aita- ja välinemitat') && cats(pages()[1]).join() === 'M40',
    );
    ok('...its title menu leads home', (await menuLinks()) === `${site} /?mode=${mode}#/`);
    doc().querySelector('.sheet-close').click();
    await wait(500);
    doc().getElementById('help').click();
    await wait(1000);
    ok(
      "...and the help is the tabs' shared one",
      doc().querySelector('.sheet-title')?.textContent === 'Aita- ja välinemitat' &&
        [...doc().querySelectorAll('.help-term, .help-sub')].map((t) => t.textContent).join() ===
          'Sarjat,Aidat-välilehdellä,Kenttä,Aitakuvat,Heittovälineet-välilehdellä,Kaikki mitat',
    );
    W.location.replace(`/?mode=${mode}#/`);
    await wait(2500);
    // Only Juoksut's home links to the other mode. Kisat's home also offers the
    // two year pages, which are Kisat's alone.
    const rest =
      mode === 'juoksut'
        ? ',Kisat https://kisat.matilainen.fi'
        : `,Mestaruuskilpailut /mestaruudet?mode=${mode},Seuracup /seuracup?mode=${mode}`;
    const homeMenu = await menuLinks();
    log(`${mode} home menu: ${homeMenu}`);
    ok("...and home's leads here", homeMenu === `Aita- ja välinemitat /mitat?mode=${mode}#/aidat${rest}`);
  }
  // The switch is a fragment change, and the kenttä survives the round trip.
  W.location.replace('/mitat#/aidat/13/k/ulkoradat');
  await wait(2500);
  doc().querySelector('.table-switch a[href^="#/valineet"]').click();
  await wait(1500);
  ok(
    'the switch rewrites the fragment and keeps the kenttä',
    W.location.hash === '#/valineet/13/k/ulkoradat' &&
      cats(pages()[0]).join() === 'T13' &&
      doc().querySelector('.table-switch a[href^="#/aidat"]').getAttribute('href') === '#/aidat/13/k/ulkoradat',
  );
}
