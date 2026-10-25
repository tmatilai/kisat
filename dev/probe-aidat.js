// Verifies the day's hurdle lines on the schedule (hurdleDayLines,
// app/hurdles.js) and the printable day sheet (renderHurdleSheet;
// docs/hurdles.md, "The day's lines"). probe-mode.js checks that Kisat mode
// shows neither. lib/hurdles.js does
// the maths, and the offline suite tests it (hurdleStartSetups,
// shuttleStartRows).
//
//   dev/probe.html?probe=probe-aidat&url=%3Fmode%3Djuoksut
//
// The `url` picks Juoksut mode (dev/AGENTS.md, "Running a probe"). The lines
// fetch static files under /data/, so no Worker is needed.
export default async function probe({ frame, W, log, ok, wait, appJs, demoJs, libJs, settle }) {
  const doc = () => frame.contentDocument;
  const app = () => doc().getElementById('app');
  const go = async (hash) => {
    appJs.navigate(hash);
    await settle();
  };
  const rowOf = (name) =>
    [...app().querySelectorAll('.row')].find((r) => r.querySelector('.row-title')?.textContent.startsWith(name));
  const lineEls = (name) => [...(rowOf(name)?.querySelectorAll('.hurdle-line') || [])];
  // The stylesheet draws the dots between a line's parts, so textContent
  // misses them. This joins the parts with a dot to read a line as it shows.
  const lineText = (l) => {
    const lead = l.querySelector('.hurdle-lead');
    const rest = [...l.children]
      .filter((c) => c !== lead)
      .map((c) => c.textContent.trim())
      .join(' · ');
    return lead ? `${lead.textContent.trim()} ${rest}` : rest;
  };
  const lines = (name) => lineEls(name).map(lineText);
  const subs = (name) => [...(rowOf(name)?.querySelectorAll('.row-sub') || [])].map((sub) => sub.textContent);
  const colour = (n) => W.getComputedStyle(n).color;

  await go('/c/demo');
  // A start of three classes on three settings has a line each, led by its
  // class and then its lanes, lowest first. (Break on purpose: pass `named`
  // as false in hurdleDayLines and the prefixes go.)
  ok(
    'a hurdle start carries a line per setting, the class leading each',
    lines('60m aidat').length === 3 &&
      lines('60m aidat')[2] === 'M17: 5–6 · 91,4 cm · sininen suorakulmio · 5 aitaa · 13,72 / 9,14 / 9,72',
  );
  ok(
    '...a setting on part of a longer mark saying so on the line',
    lines('60m aidat')[0].startsWith('M65: 1 · ') && lines('60m aidat')[0].includes('5/6 ensimmäistä'),
  );
  // A start already run carries no lines, the counts' own rule
  // (startFinished, lib/schedule.js). The 400 m start and the sekaviesti are
  // the fixture's run ones. (Break on purpose: drop the startFinished filter
  // from hurdleDayLines and both come back.)
  ok('a start already run carries no lines', !lineEls('400m aidat').length && !lineEls('4x100m aitaviesti').length);
  // The checks below mark those two as not run, since the fixture has no
  // other undrawn class and no second sekaviesti. The sheet restores them.
  const runState = (status) => {
    for (const s of demoJs.DEMO_STARTS) if (s.eventId === 'e7' || s.eventId === 'e50') s.status = status;
  };
  runState('Allocated');
  await appJs.render();
  await settle();
  // In the 400 m start one class is drawn, one has no published row and one
  // is undrawn. The undrawn line leads with the height, having no lanes.
  ok(
    'an undrawn class is a line without lanes',
    lines('400m aidat')[0].startsWith('M: 1–2 · ') &&
      lines('400m aidat')[2].startsWith('N: ') &&
      lines('400m aidat')[2].split(' · ')[0].endsWith('cm'),
  );
  ok(
    '...and a class with no published row says so rather than guessing',
    lines('400m aidat')[1] === 'P13: Tuntematon sarja',
  );
  // A line's class and a line with no setup are labels, so both stay muted
  // while the line itself takes the text colour over .row-sub's (index.html).
  // (Break on purpose: drop .hurdle-lead from index.html and the class reads
  // as loud as the setting it names.)
  const p13 = lineEls('400m aidat')[1];
  ok(
    '...the class leading a line muted, and the line saying nothing with it',
    colour(p13.querySelector('.hurdle-lead')) !== colour(p13) &&
      colour(p13.querySelector('.hurdle-none')) === colour(p13.querySelector('.hurdle-lead')),
  );
  // The lines name every class, so the row drops its own class line. A
  // mixed-status row keeps its labels, which file its chips under a status.
  // (Break on purpose: drop subs.named from plainGroupRow's rowHeadParts
  // call and the class line comes back.)
  ok(
    'a multi-class start drops its own category line, the lines having it',
    subs('60m aidat').length === 3 &&
      [...rowOf('60m aidat').querySelectorAll('.row-sub')].every((s) => s.classList.contains('hurdle-line')),
  );
  ok(
    '...but a mixed-status row keeps the labels its chips are filed under',
    subs('400m aidat').some((t) => /Eräjaot puuttuvat/.test(t)),
  );
  // The mitat close every line and are muted behind a mark, as in the box's
  // own column. The chosen kenttä below checks the unmarked half. (Break on
  // purpose: pass lineItems' `muted` as false and the mitat read as loud as
  // the mark.)
  const mitat = (name) => lineEls(name).map((l) => l.lastElementChild);
  ok(
    "...the mitat muted behind a mark, as in the box's own column",
    mitat('60m aidat').every((m) => /^\d/.test(m.textContent) && colour(m) !== colour(m.parentElement)),
  );
  // The mitat stand at the line's right edge, as the sheet's column does, so
  // a phone's second row reads the same. (Break on purpose: drop
  // .hurdle-dims' margin-left and they follow the count.)
  ok(
    "...and the mitat at the line's right edge",
    lineEls('60m aidat').every(
      (l) =>
        Math.abs(l.querySelector('.hurdle-dims').getBoundingClientRect().right - l.getBoundingClientRect().right) < 1,
    ),
  );
  // The lines take the row's full width under the head, since beside the
  // status chip they wrap a phone's row (plainGroupRow). (Break on purpose:
  // append them into .row-main.)
  ok(
    "...and the lines run under the chip at the row's full width",
    lineEls('60m aidat')[0].getBoundingClientRect().right >
      rowOf('60m aidat').querySelector('.chip').getBoundingClientRect().left,
  );
  // An aitaviesti start's lines are the relay sheet's rows (shuttleStartRows,
  // lib/hurdles.js). A drawn start leads with its lane pairs, and a mark that
  // both directions find carries no leg note. (Break on purpose: drop the
  // relays loop from hurdleDayInfos and the row goes bare. Pass the relays no
  // `drawn` and the pairs go. Look the mark up in the even legs' direction
  // only and the circles read as legs 2 and 4's.)
  ok(
    "a hurdle relay carries the sheet's line, its pairs leading",
    lines('4x60m aitaviesti').length === 1 &&
      lines('4x60m aitaviesti')[0] === '1–6 · 60,0 cm · vihreä ympyrä · 7 aitaa · 10,5 / 6,5 / 10,5',
  );
  // The sekaviesti has a line per direction in lane order, as the box's rows,
  // each led by the sheet's own class. A drawn lane says the legs by its
  // parity, so the line leaves them out (shuttleLine). (Break on purpose:
  // keep the legs part beside the lane.)
  ok(
    '...and the sekaviesti a line per direction, its classes leading',
    lines('4x100m aitaviesti').length === 2 &&
      lines('4x100m aitaviesti')[0] === 'M: 3 · 99,1 cm · keltainen viiva · 10 aitaa · 13 / 8,5 / 10,5' &&
      lines('4x100m aitaviesti')[1] === 'N: 4 · 83,8 cm · sininen suorakulmio · 10 aitaa · 11,75 / 8,5 / 11,75',
  );
  ok(
    "...and the sheet's own row is gone from the day",
    ![...app().querySelectorAll('.row-title')].some((t) => t.textContent === 'Aitojen asettelu'),
  );
  // A steeple start's line is its bar and its mark, with no lanes
  // (steepleStartRows, lib/hurdles.js). Two classes on one bar make one line
  // with no class prefix, and the row keeps its class line. (Break on purpose:
  // drop the steeples loop from hurdleDayInfos. Key `named` on multiClass and
  // the prefix is back with the class line gone.)
  ok(
    'a steeple start carries one line for its two classes on one bar',
    lines('1500m esteet').length === 1 &&
      lines('1500m esteet')[0] === '76,2 cm · sininen neliö' &&
      subs('1500m esteet')[0] === 'M15, N',
  );

  // A start of one class on one setting has one line, with no class prefix.
  // (Break on purpose: pass hurdleLine's withCats as true and the line grows
  // one.)
  const starts = demoJs.DEMO_STARTS;
  const cut = [];
  for (let i = starts.length - 1; i >= 0; i--) {
    if (starts[i].eventId === 'e48' || starts[i].eventId === 'e49') cut.unshift(...starts.splice(i, 1));
  }
  await appJs.render();
  await settle();
  ok(
    'a one-class start is one line with no class prefix',
    lines('60m aidat').length === 1 &&
      lines('60m aidat')[0] === '5–6 · 91,4 cm · sininen suorakulmio · 5 aitaa · 13,72 / 9,14 / 9,72',
  );
  // With no line naming the class, the row names it itself.
  ok('...and the row names the class itself again', subs('60m aidat')[0] === 'M17');
  starts.push(...cut);
  await appJs.render();
  await settle();
  ok('...and the fixture is whole again', lines('60m aidat').length === 3);

  // Where a lane changes setting between heats, a union of lanes would lie,
  // so the lines drop the lanes and the box keeps the heats (perHeat,
  // lib/hurdles.js). The probe builds that shape, which the fixture lacks.
  // (Break on purpose: hand hurdleLine the row's own lanes in hurdleRowLines'
  // perHeat branch.)
  const heat48 = demoJs.DEMO_EVENTS.e48.Rounds[0].Heats[0];
  heat48.Index = 2;
  heat48.Allocations[0].Position = 1;
  await appJs.render();
  await settle();
  ok(
    'a lane changing setting between heats drops the lanes from the lines',
    lines('60m aidat').length === 3 && lines('60m aidat').every((l) => l.split(' · ')[0].endsWith('cm')),
  );
  heat48.Index = 1;
  heat48.Allocations[0].Position = 3;
  await appJs.render();
  await settle();
  ok('...and back: the lanes lead again', lines('60m aidat')[0].startsWith('M65: 1 · '));

  // Picking a kenttä re-renders the day at once, since its board is what the
  // lines read. The one picked here paints none of these settings' marks.
  // (Break on purpose: drop render(true) from the select's handler and the
  // lines keep the sheet's marks until the next timer tick.)
  const sel = () => app().querySelector('.track-pick select');
  sel().value = 'v:helsinki-heteniitty';
  sel().dispatchEvent(new W.Event('change'));
  await settle();
  ok(
    'a chosen kenttä puts its own board on the lines at once',
    lines('60m aidat').length === 3 &&
      // An unmarked setting drops its mark part, as a line has no column to
      // hold its place. This counts parts and not dashes, since a lane range
      // has a dash too. (Break on purpose: let lineItems' filter keep the null
      // and the line has five parts.)
      lines('60m aidat').every((l) => l.split(' · ').length === 4),
  );
  // With no mark to walk to, the mitat are what gets taped out, so they take
  // the line's colour. (Break on purpose: pass lineItems' `muted` as true
  // and they stay muted.)
  ok(
    '...and the mitat unmute, being what gets taped out',
    mitat('60m aidat').every((m) => /^\d/.test(m.textContent) && colour(m) === colour(m.parentElement)),
  );
  sel().value = '400';
  sel().dispatchEvent(new W.Event('change'));
  await settle();
  ok("...and a bare length hands the sheet's marks back", lines('60m aidat')[2].includes('sininen suorakulmio'));

  // Ratalajit is the view the track is worked from. Kaikki reads as the whole
  // programme, so it carries no lines and pays no fetch for them. The field
  // event shows that the toggle moved. (Break on purpose: gate hurdleDayLines
  // on SITE_MODE alone and the lines survive into Kaikki.)
  const seg = (label) => [...app().querySelectorAll('.seg-btn')].find((b) => b.textContent === label);
  seg('Kaikki').click();
  await settle();
  ok(
    'Kaikki carries no setting lines at all',
    !app().querySelector('.hurdle-line') && app().textContent.includes('Kuula'),
  );
  seg('Ratalajit').click();
  await settle();
  ok('...and Ratalajit has them back', lines('60m aidat').length === 3);

  // --- The printable day sheet (renderHurdleSheet, docs/hurdles.md) ---
  // The paper holds every start of the day, run or not, so this restores the
  // two run starts.
  runState('Official');
  await appJs.render();
  await settle();
  // The paper is a row of the schedule's title menu on a day with a hurdle
  // start.
  const menuRows = async () => {
    doc().querySelector('#title .title-menu').click();
    await settle();
    const rows = [...doc().querySelectorAll('.sheet-menu .row')].map((r) => [
      r.querySelector('.row-title').textContent,
      r.getAttribute('href'),
    ]);
    doc().querySelector('.sheet-close').click();
    await settle();
    return rows;
  };
  const rows = await menuRows();
  log('menu: ' + rows.map(([l]) => l).join(' | '));
  // A meet name that fills the header takes the ellipsis, and the caret stays
  // as the one sign the title is a menu. (Break on purpose: drop .title-text
  // from index.html and the button overflows the h1 whole, caret first.)
  const titleEl2 = doc().getElementById('title');
  const caret = doc().querySelector('#title .title-caret');
  doc().querySelector('.title-text').textContent = 'Kalevan kisat ja piirikunnalliset mestaruuskilpailut · 18.9.2026';
  await wait(300);
  log(
    `caret ${Math.round(caret.getBoundingClientRect().right)} in ${Math.round(titleEl2.getBoundingClientRect().right)}`,
  );
  ok(
    'a long title shortens and keeps its caret',
    caret.getBoundingClientRect().width > 0 &&
      caret.getBoundingClientRect().right <= titleEl2.getBoundingClientRect().right + 0.5,
  );
  await appJs.render();
  await settle();
  const sheetHref = rows.find(([l]) => l === 'Päivän aidat')?.[1];
  ok(
    "the title menu opens the day's paper",
    !!sheetHref && !lineEls('400m aidat').length && !lineEls('4x100m aitaviesti').length,
  );
  // Every Juoksut menu with a kenttä links the whole table on it
  // (tablePageRow). probe-aitataulukko checks the other menus.
  ok(
    "...and the whole table on the meet's kenttä",
    rows.some(([l, h]) => l === 'Aita- ja välinemitat' && h === '/mitat?mode=juoksut#/aidat'),
  );
  // The paper outlives the racing, so the row is gated on the day's hurdle
  // starts and not on the lines left. (Break on purpose: gate it on
  // hurdleSubs and a day run to the end loses its paper.)
  const was = demoJs.DEMO_STARTS.map((s) => s.status);
  for (const s of demoJs.DEMO_STARTS) if (libJs.isHurdleStart(s.event)) s.status = 'Official';
  await appJs.render();
  await settle();
  ok(
    '...and keeps it once every hurdle start of the day has run',
    (await menuRows()).some(([l]) => l === 'Päivän aidat') && !app().querySelector('.hurdle-line'),
  );
  demoJs.DEMO_STARTS.forEach((s, i) => {
    s.status = was[i];
  });
  await appJs.render();
  await settle();
  // The bar holds the toggle and the kenttä pick on one row at phone width,
  // so the select carries no visible word. One row measures about 37 px.
  // (Break on purpose: add the word 'Kenttä' to trackSelect's label and the
  // pick drops to a second row.)
  const barH = app().querySelector('.filter-bar').getBoundingClientRect().height;
  log(`bar height ${Math.round(barH)}`);
  ok('the toggle and the kenttä pick share the row', barH < 50);
  // The title menu stays the same whichever segment is on. (Break on
  // purpose: gate the row on runOnly.)
  seg('Kaikki').click();
  await settle();
  ok(
    '...and the menu is the same in Kaikki',
    (await menuRows()).some(([l]) => l === 'Päivän aidat'),
  );
  await go(sheetHref);
  // The sheet is every hurdle and steeple start of the day in one shared
  // table, with no day rows and no entrants. Its seven starts make six
  // blocks, as the relay pair shares one, and three taping figures. (Break on
  // purpose: filter the run starts out in hurdleDayInfos and two blocks go.
  // Give every start its own block and this counts seven.)
  const titles = () => [...app().querySelectorAll('.aidat-title th')].map((t) => t.textContent);
  log('sheet: ' + titles().join(' | '));
  ok(
    'the sheet is every hurdle start in one table, and nothing else',
    titles().length === 6 &&
      app().querySelectorAll('.aidat-tbl').length === 1 &&
      !app().querySelector('.row') &&
      app().querySelectorAll('.shuttle-tapes').length === 3,
  );
  // The pair's block has a title line per start naming its class, so the row
  // names none, and one row over the union of the two draws
  // (hurdleSheetBlocks). (Break on purpose: take the second start's lanes and
  // this reads 1–4. Taking the first start's alone still reads 1–6.)
  const pairTh = [...app().querySelectorAll('.aidat-title th')].find((t) => t.textContent.includes('16.40'));
  const pairBody = pairTh?.closest('tbody');
  // Every title names its classes after the event, muted. A row names them
  // only where its block has several rows (renderHurdleSheet). (Break on
  // purpose: drop .aidat-cats from index.html and the classes read as loud
  // as the event.)
  const catsEl = (t) =>
    [...app().querySelectorAll('.aidat-title th')].find((th) => th.textContent === t)?.querySelector('.aidat-cats');
  ok(
    'a title names its classes after the event, muted',
    titles().some((t) => t === '10.10 · 60m aidat · M17, M50, M65') &&
      titles().some((t) => t === '16.45 · 4x100m aitaviesti · M/N') &&
      colour(catsEl('10.10 · 60m aidat · M17, M50, M65')) !==
        colour(catsEl('10.10 · 60m aidat · M17, M50, M65').parentElement),
  );
  ok(
    'consecutive starts on one setting are one block, its lanes the union',
    pairTh?.querySelectorAll('div').length === 2 &&
      pairTh.textContent.includes('16.30 · 4x60m aitaviesti · P11') &&
      pairTh.textContent.includes('16.40 · 4x60m aitaviesti · T11') &&
      pairBody.querySelector('.hurdle-lanes')?.firstChild.textContent === '1–6' &&
      !pairBody.querySelector('.hurdle-cats') &&
      pairBody.querySelectorAll('tr').length === 4,
  );
  // The one table puts every start's Korkeus at one x, whatever its rows
  // hold. (Break on purpose: wrap each tbody in a table of its own.)
  const korkeusX = [...app().querySelectorAll('.aidat-tbl .setup-cols th')]
    .filter((t) => t.textContent === 'Korkeus')
    .map((t) => Math.round(t.getBoundingClientRect().x));
  log('Korkeus x: ' + korkeusX.join(','));
  ok("every start's columns share an x", korkeusX.length === 6 && new Set(korkeusX).size === 1);
  // The five columns fit a phone only at the smaller size index.html sets
  // below 520 px. (Break on purpose: drop the max-width: 520px block from
  // index.html and the mitat scroll off the right edge.)
  const wrap = () => app().querySelector('.tbl-wrap');
  log(`sheet ${Math.round(wrap().scrollWidth)} in ${Math.round(wrap().clientWidth)}`);
  ok('the whole sheet fits a phone, mitat included', wrap().scrollWidth <= wrap().clientWidth);
  // On a wide screen the slack goes to Merkintä. Shared the ordinary way it
  // goes to the classes, which leaves a gulf before Korkeus. (Break on
  // purpose: drop th.setup-mark's width from index.html.)
  const colW = (name) =>
    [...app().querySelectorAll('.aidat-tbl .setup-cols th')]
      .find((t) => t.textContent === name)
      ?.getBoundingClientRect().width;
  const figWs = () => [...app().querySelectorAll('.shuttle-tapes svg')].map((s) => Number(s.getAttribute('width')));
  const phoneFigs = figWs();
  frame.style.width = '900px';
  await wait(800);
  log(`laptop lead ${Math.round(colW('Radat'))} mark ${Math.round(colW('Merkintä'))}`);
  ok('a wide screen gives the slack to Merkintä, not to the classes', colW('Merkintä') > 300 && colW('Radat') < 100);
  // A resize redraws every figure on the sheet. (Break on purpose: drop
  // redrawOnResize from sheetFigures.)
  log(`figures ${phoneFigs.join(',')} at 402, ${figWs().join(',')} at 900`);
  ok(
    '...and every taping figure redrawn to it',
    figWs().length === phoneFigs.length && figWs().every((w, i) => w > phoneFigs[i]),
  );
  frame.style.width = '402px';
  await wait(800);
  ok(
    "...and back to the phone's own when it turns back",
    figWs().every((w, i) => w === phoneFigs[i]),
  );
  // A row of paper is read alone, so a row among several in its block names
  // its classes under the lanes.
  ok(
    "...and a lone start's classes are in its rows",
    [...app().querySelectorAll('.aidat-tbl .hurdle-cats')].some((c) => c.textContent.trim() === 'M'),
  );
  ok('...and a bare length puts no kenttä line on the paper', !app().querySelector('.aidat-venue'));
  // One tap on any figure turns them all, as the tapes are laid from one side
  // of the track. This reads where 'maali' sits in each strip. (Break on
  // purpose: build each figure with figureBlock, which redraws only itself,
  // and the untapped ones stand still.)
  const maaliX = () =>
    [...app().querySelectorAll('.shuttle-tapes svg')].map((s) =>
      [...s.querySelectorAll('text')].find((t) => t.textContent === 'maali')?.getAttribute('x'),
    );
  const before = maaliX();
  app().querySelector('.shuttle-tapes').click();
  await settle();
  ok(
    'one tap turns every figure',
    maaliX().every((x, i) => x !== before[i]),
  );
  // The flip is stored per meet, so a start's own figure turns with the
  // sheet (storedFlip). Turned puts maali at the near end, as probe-hurdles
  // measures it. (Break on purpose: key the store per page and the start's
  // figure stands still.)
  await go('/c/demo');
  await go(rowOf('4x60m aitaviesti').getAttribute('href'), 2500);
  const dims = () => [...app().querySelectorAll('.shuttle-dim-label')].map((t) => Number(t.getAttribute('x')));
  ok("the sheet's flip reaches the start page's figure", dims()[0] > dims()[1]);
  // The start page's menu carries the paper too, gated on the day and not
  // on the start. (Break on purpose: gate the row on group.event and the
  // 100 m below loses its day's paper.)
  ok(
    "the start page's menu opens the same paper",
    (await menuRows()).some(([l, h]) => l === 'Päivän aidat' && h === sheetHref),
  );
  await go('/c/demo');
  await go(rowOf('100m').getAttribute('href'), 2500);
  ok(
    '...from a start of the day that is no hurdle start',
    (await menuRows()).some(([l, h]) => l === 'Päivän aidat' && h === sheetHref),
  );
  // The sheet reads the kenttä chosen on the day and names it. (Break on
  // purpose: drop the .aidat-venue line from renderHurdleSheet.)
  await go('/c/demo');
  sel().value = 'v:helsinki-heteniitty';
  sel().dispatchEvent(new W.Event('change'));
  await settle();
  await go(sheetHref);
  ok(
    'a chosen kenttä is named on the sheet',
    app().querySelector('.aidat-venue')?.textContent === 'Helsinki, Heteniitty',
  );
  await go('/c/demo');
  sel().value = '400';
  sel().dispatchEvent(new W.Event('change'));
  await settle();

  // The sheet is always dated, so the path with no date matches no route
  // and falls to home (parseRoute).
  await go('/c/demo/aidat');
  ok('the dateless /aidat route falls to home', doc().getElementById('title').textContent.startsWith('Juoksut'));
}
