// Checks the club cup against democup (docs/views.md, "The club cup"). It
// covers the row on the meet page, the standings page and its pick, and the
// points beside every mark with the row that counted set apart.
//   dev/probe.html?probe=probe-cup
// fetchJson answers /api/meet/democup from the fixture, so no Worker is
// needed. demo.js says what each of the seven starts carries.
export default async function probe({ D, W, log, ok, wait, groupKey, appJs }) {
  const go = async (hash, ms = 1200) => {
    appJs.navigate(hash);
    await wait(ms);
  };
  const text = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : null);
  const rows = (sel) => [...D.querySelectorAll(sel)];
  // Reads each row with points. `name` is the name cell's, `points` shares the
  // mark's cell, and `scored` says whether the row counted.
  const scoring = () =>
    rows('#app tbody tr, #app .ladder-card')
      .map((r) => ({
        name: text(r.querySelector('.name-main')) || text(r.querySelector('.cell-name')),
        points: text(r.querySelector('.cup-points')),
        scored: !!r.querySelector('.cup-points-scored'),
      }))
      .filter((r) => r.points);
  const scored = () =>
    scoring()
      .filter((r) => r.scored)
      .map((r) => `${r.name} ${r.points}`);
  const idle = () =>
    scoring()
      .filter((r) => !r.scored)
      .map((r) => `${r.name} ${r.points}`);

  // --- The meet page: one row for the whole cup ---
  await go('/c/democup', 1800);
  const sections = rows('#app > *').map((n) => (n.matches('h2') ? text(n) : n.className || n.tagName.toLowerCase()));
  log(`schedule flow: ${sections.join(' / ').slice(0, 160)}`);
  const flow = sections.map((s) => s.split(' ')[0]).join('/');
  // The cup row sits under the filter bar and the class filter, above Ottelut
  // and the day tabs. (Break on purpose: push the cup row
  // above the class filter.)
  ok('the cup row leads the page, under the filter bar', flow.startsWith('filter-bar/day-filter/list/'));
  // A one-day meet has no tabs between the cup row and its starts, so the
  // day's list takes a heading. (Break on purpose: drop renderComp's branch
  // that pushes the Aikataulu heading, and the flow reads
  // `filter-bar/day-filter/list/list`.)
  ok("and the day's own starts are a labelled section under it", flow === 'filter-bar/day-filter/list/Aikataulu/list');
  const cupRow = rows('#app > .list')[0].children[0];
  log(`cup row: ${text(cupRow)}`);
  ok(
    'titled for the points themselves, with no heading over it',
    text(cupRow.querySelector('.row-title')) === 'Seuracup-pisteet',
  );
  // With nothing followed the row holds its title and chip alone. (Break on
  // purpose: put the leader on a .row-sub.)
  ok('and nothing else on it', !cupRow.querySelector('.row-sub') && !cupRow.querySelector('.watch-row-athlete'));
  // The phase is the meet body's (meetPhase, lib/schedule.js, tested on
  // 20343's shape), and the Kuula is still going. The least-advanced start
  // would read "Eräjaot tehty".
  ok("with the meet's own phase on it", text(cupRow.querySelector('.chip')) === 'Käynnissä');
  ok('and no time column, having no instant to start at', !cupRow.querySelector('.row-time'));

  // --- The standings, the meet's own page ---
  cupRow.click();
  await wait(1400);
  log(`path: ${W.location.pathname}`);
  ok('the row opens the standings route', W.location.pathname === '/c/democup/cup');
  ok('titled for the cup', text(D.getElementById('title')) === 'Seuracup');
  // (Break on purpose: draw the meet line only with its link up.)
  log(`meet line: ${text(D.querySelector('#app .medals-meet'))}`);
  ok(
    'and the line under it names the meet',
    /^\S.* · \d+\.\d+\.\d{4}$/.test(text(D.querySelector('#app .medals-meet'))),
  );
  log(
    `headings: ${rows('#app h2')
      .map((h) => text(h))
      .join(' | ')}`,
  );
  ok(
    'one heading, carrying the same phase the row did',
    rows('#app h2')
      .map((h) => text(h))
      .join(' | ') === 'Seurapisteet Käynnissä',
  );
  const headings = rows('#app thead th').map((h) => text(h));
  log(`columns: ${headings.join(' | ')}`);
  ok('three columns and no more', headings.join('|') === 'Sija|Seura|Pisteet');
  const table = rows('#app tbody tr').map((tr) => [...tr.children].map((td) => text(td)).join(' '));
  log(`standings: ${table.join(' | ')}`);
  // This checks the order and each place, and test/cup.test.mjs checks the sums.
  ok(
    'every club that scored, in rank order',
    table.length === 5 &&
      table.map((r) => r.replace(/ \d+$/, '')).join(' | ') ===
        '1. Demon Urheilijat | 2. Testilän Kisa | 3. Mallikylän Vire ' +
          '| 4. Näyteniemen Vauhti | 5. Harjoituspiirin Urheilijat' &&
      table.every((r) => /^\d+\. .+ \d+$/.test(r)),
  );
  // (Break on purpose: draw the name as the club link, and no row picks.)
  ok('a row picks its club', rows('#app tbody .club-pick').length === 5);
  ok("and nothing links out to the series' own site", !D.querySelector('#app a[target="_blank"]'));
  ok('and back leads to the meet', D.querySelector('#back')?.getAttribute('href') === '/c/democup');

  // --- A picked club: its lines under the table ---
  rows('#app tbody .club-pick')[0].click();
  await wait(600);
  log(`picked: ${W.location.pathname} / ${text(D.querySelector('#app .pick-head span'))}`);
  // (Break on purpose: leave the address alone on a pick, and a reload drops it.)
  ok(
    'a row picks its club into the address',
    W.location.pathname === '/c/democup/cup/s/1' &&
      text(D.querySelector('#app .pick-head span')) === 'Demon Urheilijat' &&
      text(D.querySelector('#app tbody tr.picked .club-pick')) === 'Demon Urheilijat',
  );
  const lineEls = () => rows('#app .medalist-entries .medalist-entry');
  const scoreRows = lineEls().map((r) => ({
    event: text(r.querySelector('.medalist-event')),
    place: text(r.querySelector('.medalist-place')),
    result: text(r.querySelector('.medalist-mark')),
    points: text(r.querySelector('.medalist-result')),
    href: r.getAttribute('href'),
  }));
  log(`lines: ${scoreRows.map((r) => `${r.event} ${r.place} ${r.result} ${r.points}`).join(' | ')}`);
  // (Break on purpose: put a switch over the lines, and the page has a bar.)
  ok(
    'a line a row that scored and nothing to switch, adding up to the total',
    !D.querySelector('#app .medalist-bar') &&
      scoreRows.length === 5 &&
      scoreRows.reduce((n, r) => n + Number(r.points.replace(/[^\d]/g, '')), 0) === 3820,
  );
  // (Break on purpose: drop the name's .medalist-sub and the event reads bare.)
  ok(
    'the event, the athlete muted, place, mark and points',
    scoreRows[0].event === 'P11 60m · Niilo Seurainen' &&
      text(lineEls()[0].querySelector('.medalist-sub')) === '· Niilo Seurainen' &&
      scoreRows[0].place === '2/5' &&
      scoreRows[0].result === '9,15' &&
      scoreRows[0].points === '750 p.' &&
      scoreRows.every((r) => /^\d+\/\d+$/.test(r.place)),
  );
  ok(
    "a relay's line names its team",
    scoreRows.some((r) => /viesti · Demon Urheilijat/.test(r.event)),
  );
  // The two 60m classes are one start, so both link to it.
  ok(
    'every line is a link into the start it was run in',
    scoreRows.every((r) => r.href && r.href.startsWith('/c/democup/g/')) && scoreRows[0].href === scoreRows[1].href,
  );
  ok('and no button under them', !D.querySelector('#app .btn'));
  lineEls()[0].click();
  await wait(1400);
  ok(
    'the link lands on the start',
    W.location.pathname === `/c/democup/g/${encodeURIComponent(groupKey(10, 0, '60m'))}`,
  );
  W.history.back();
  await wait(1400);
  ok(
    'and back is the page with the club still picked',
    W.location.pathname === '/c/democup/cup/s/1' &&
      text(D.querySelector('#app .pick-head span')) === 'Demon Urheilijat',
  );
  // Temporary: a link to a club's own page, /c/<compId>/cup/<orgId>, opens
  // the pick (the cup club page shim, docs/shims.md).
  await go('/c/democup/cup/3', 1400);
  ok('the old club page opens the pick', text(D.querySelector('#app .pick-head span')) === 'Testilän Kisa');

  // --- A followed club's line on the cup row, set by the club quick-filter ---
  await go('/c/democup#/s/4', 2200);
  const followedRow = rows('#app > .list')[0].children[0];
  log(`followed cup row: ${text(followedRow)}`);
  ok("the row is still the cup's", text(followedRow.querySelector('.row-title')) === 'Seuracup-pisteet');
  const cupLines = [...followedRow.querySelectorAll('.watch-row-athlete')];
  const cells = cupLines.length ? [...cupLines[0].children].map((c) => text(c)) : [];
  log(`its line: ${JSON.stringify(cells)}`);
  // The line takes a followed athlete's five columns, with the club in the
  // name column (cupWatchLine). (Break on purpose: match on athleteIds and
  // not clubIds, and a club filter draws no line.)
  ok(
    "and carries the followed club's own place and points",
    cupLines.length === 1 &&
      cells[0] === '' &&
      cells[1] === 'Näyteniemen Vauhti' &&
      cells[2] === '' &&
      cells[3] === '4/5' &&
      /^2370\s*p\.$/.test(cells[4]),
  );
  // The meet is unfinished, so the place is muted (allocPosition).
  ok('the place is muted while the meet is unfinished', !!followedRow.querySelector('.watch-row-pos-pending'));
  ok('and the row is tinted like any other matched one', followedRow.classList.contains('watched'));
  // The line is at its 346 px phone budget (.watch-row-athlete, index.html),
  // and a cup total is wider than a mark. The mark's column has 43 px.
  const grid = cupLines[0];
  const mark = grid.querySelector('.watch-row-mark');
  const nameCell = grid.querySelector('.watch-row-name');
  log(
    `line box: ${Math.round(grid.getBoundingClientRect().width)}px, ` +
      `points ${Math.round(mark.scrollWidth)}/${Math.round(mark.clientWidth)}px, ` +
      `name ${Math.round(nameCell.scrollWidth)}/${Math.round(nameCell.clientWidth)}px, ` +
      `line height ${Math.round(grid.getBoundingClientRect().height)}px`,
  );
  ok('the points fit the column a mark was sized for', mark.scrollWidth <= mark.clientWidth);
  // The standings page tints a followed club's row, and Seuratut lists only
  // people followed by name. (Break on purpose: give Seuratut the followed
  // clubs' scorers, and the section heads the page.)
  await go('/c/democup/cup', 1400);
  log(
    `followed club: ${rows('#app h2')
      .map((h) => text(h))
      .join(' | ')}`,
  );
  ok(
    'a followed club is tinted, with no Seuratut of its scorers',
    text(D.querySelector('#app h2')).startsWith('Seurapisteet') &&
      text(D.querySelector('#app tbody tr.watched .club-pick')) === 'Näyteniemen Vauhti',
  );
  // A stub gives the widest total a cup reaches, five digits. Its ink is
  // measured against the cell, as a right-aligned mark overflows leftwards
  // without clipping.
  const realFetchJson = appJs.fetchJson;
  appJs.setFetchJson(async (url, opts) => {
    const body = await realFetchJson(url, opts);
    return url === '/api/meet/democup'
      ? { ...body, clubs: body.clubs.map((c, i) => (i ? c : { ...c, points: 14449 })) }
      : body;
  });
  await go('/c/democup#/s/1', 2200);
  const inkOf = (n) => {
    const r = D.createRange();
    r.selectNodeContents(n);
    return r.getBoundingClientRect().width;
  };
  const widest = D.querySelector('#app .watch-row-mark');
  const cell = widest.closest('.watch-row-result');
  log(
    `ink: ${rows('#app .watch-row-mark')
      .filter((n) => text(n))
      .map((n) => `${text(n)} ${Math.round(inkOf(n))}px`)
      .slice(0, 6)
      .join(' | ')} ` + `in a ${Math.round(cell.getBoundingClientRect().width)}px cell`,
  );
  ok(
    'the widest total a cup can reach still fits the cell',
    text(widest) === '14449' && inkOf(widest) <= cell.getBoundingClientRect().width,
  );
  appJs.setFetchJson(realFetchJson);
  // The athlete quick-filter draws no line on the cup row, which guesses no
  // club from a person.
  await go('/c/democup#/a/sc11-a', 2200);
  const byAthlete = rows('#app > .list')[0].children[0];
  ok(
    'an athlete filter draws no line on it',
    text(byAthlete.querySelector('.row-title')) === 'Seuracup-pisteet' &&
      !byAthlete.querySelector('.watch-row-athlete'),
  );

  // --- A row's cup points, by class and by physical heat ---
  // The 60m is one start of two cup events over two shared heats (demo.js).
  await go(`/c/democup/g/${encodeURIComponent(groupKey(10, 0, '60m'))}`, 1400);
  log(`note: ${text(D.querySelector('#app .qual-note'))}`);
  // The page carries the note once, under the heading.
  ok(
    'the page says what the points are',
    text(D.querySelector('#app .qual-note')) === 'Seuracup: vain seuran paras tulos lasketaan',
  );
  log(
    `60m: ${scoring()
      .map((r) => `${r.name} ${r.points}${r.scored ? '*' : ''}`)
      .join(' | ')}`,
  );
  ok('every result on both tables carries what it scored', scoring().length === 11);
  // The guest has the biggest number on the page and scores nothing
  // (docs/tuloslista-api.md). (Break on purpose: drop the NotInCompetition
  // test from cupStandings, and this row scores for its club.)
  ok(
    "a guest's points are not a club's",
    idle().some((r) => r.startsWith('Guest Sprinter') && r.endsWith('860 p.')),
  );
  // Two girls of one club ran the race, and the one behind scores her club
  // nothing.
  ok(
    'and the clubmate behind the scorer scores nothing too',
    idle().includes('Peppi Loikkanen 680 p.') && scored().includes('Iiris Seurainen 820 p.'),
  );
  ok('everybody else in the start scored', scored().length === 9 && idle().length === 2);
  // The boys' race is a cup event of its own, and its rows key under its own
  // event id. (Break on purpose: take pointsRail off the first category for
  // the whole start, and the other class's rows go muted.)
  ok(
    'and the class beside it scores under its own event',
    scored().includes('Aatu Kisanen 820 p.') && scored().includes('Otso Pisteenmaa 680 p.'),
  );
  // Erät shows the same rows by physical heat, in the merged table that
  // carries cup points too (sharedHeatTable, app/event.js). (Break on purpose:
  // drop the cup points from sharedHeatTable's result cell.)
  [...rows('#app .seg-btn')].find((b) => text(b) === 'Erät')?.click();
  await wait(900);
  ok('the start also reads as physical heats', !!D.querySelector('#app th.cat'));
  log(
    `60m heats: ${scoring()
      .map((r) => `${r.name} ${r.points}${r.scored ? '*' : ''}`)
      .join(' | ')}`,
  );
  ok(
    'and the merged heat table says exactly the same',
    scored().length === 9 &&
      idle().length === 2 &&
      idle().some((r) => r.startsWith('Peppi Loikkanen')) &&
      idle().some((r) => r.startsWith('Guest Sprinter')),
  );
  // The row that counted takes .name-aside-beaten's weight, so the two states
  // differ (index.html). (Break on purpose: drop the .cup-points-scored rule,
  // and the two are equal.)
  const styleOf = (sel) => {
    const st = W.getComputedStyle(D.querySelector(sel));
    return `${st.color} ${st.fontWeight}`;
  };
  const scoredStyle = styleOf('#app .cup-points-scored');
  const idleStyle = styleOf('#app .cup-points:not(.cup-points-scored)');
  log(`scored: ${scoredStyle} / muted: ${idleStyle}`);
  ok('and the one that counted is drawn unlike the ones that did not', scoredStyle !== idleStyle);

  // --- The same rail on a field ladder and on a relay's team row ---
  // Three fouls score 0 for a club that scored the event anyway.
  await go(`/c/democup/g/${encodeURIComponent(groupKey(12, 45, 'Kuula'))}`, 1400);
  log(
    `Kuula: ${scoring()
      .map((r) => `${r.name} ${r.points}${r.scored ? '*' : ''}`)
      .join(' | ')}`,
  );
  // A ladder is a hidden <table> and .ladder-cards at phone width, so each
  // row is read twice (dev/AGENTS.md, "Writing a probe"). The check counts
  // the distinct rows.
  const uniq = (xs) => [...new Set(xs)];
  ok(
    'a field ladder carries the points too',
    uniq(scored()).length === 3 && uniq(idle()).join('') === 'Sisu Loikkanen 0 p.',
  );
  // The row still to throw carries none.
  ok(
    'a row with no mark carries no points',
    !scoring().some((r) => r.name?.startsWith('Aatos Kaarteinen')) &&
      rows('#app tbody tr, #app .ladder-card').length > scoring().length,
  );
  // A relay scores as the team's own row under its club.
  await go(`/c/democup/g/${encodeURIComponent(groupKey(11, 30, '4x100m viesti'))}`, 1400);
  log(
    `viesti: ${scoring()
      .map((r) => `${r.name} ${r.points}${r.scored ? '*' : ''}`)
      .join(' | ')}`,
  );
  ok(
    "and a team's own row scores its club",
    scored().length === 4 && !idle().length && scored()[0].startsWith('Demon Urheilijat'),
  );

  // --- One cup event over two starts: the walks ---
  await go(`/c/democup/g/${encodeURIComponent(groupKey(14, 15, '1000m kävely'))}`, 1400);
  log(
    `T11 walk: ${scoring()
      .map((r) => `${r.name} ${r.points}${r.scored ? '*' : ''}`)
      .join(' | ')}`,
  );
  // Two of the three rows score nothing, as both clubs walked faster in the
  // boys' race. (Break on purpose: drop the Walk branch from cupEventKey, and
  // all three score.)
  ok(
    "a walker beaten in the other gender's race scores nothing",
    scored().join('') === 'Aino Kävelinen 640 p.' &&
      idle().join(' / ') === 'Elsa Demoinen 500 p. / Sohvi Mallinen 380 p.',
  );
  await go(`/c/democup/g/${encodeURIComponent(groupKey(14, 45, '1000m kävely'))}`, 1400);
  log(
    `P11 walk: ${scoring()
      .map((r) => `${r.name} ${r.points}${r.scored ? '*' : ''}`)
      .join(' | ')}`,
  );
  // The race that settled it scores every row with a result. The fourth did
  // not start, and its 0 is its club's best row but scores nothing. (Break on
  // purpose: push every best row into cupStandings' scoring, and this row
  // lights up.)
  ok(
    'and the race that did settle it scores every row that scored anything',
    scored().length === 3 && idle().join('') === 'Topi Harjoitteleva 0 p.',
  );

  // --- An event with no final scores nobody ---
  await go(`/c/democup/g/${encodeURIComponent(groupKey(9, 15, '200m'))}`, 1400);
  log(
    `T13 200m: ${scoring()
      .map((r) => `${r.name} ${r.points}${r.scored ? '*' : ''}`)
      .join(' | ')}`,
  );
  // The round is Official with results and scores nothing, as 20353's T13
  // 200m does. (Break on purpose: drop the RoundTypeCategory test from
  // cupStandings, and these three score 800, 720 and 640.)
  ok('a qualifying round alone scores nobody', scoring().length === 3 && !scored().length);

  // --- The meet body's flag is the gate ---
  // Every allocation carries SeuraCUPPoints (docs/tuloslista-api.md), and
  // `{cup: false}` takes all of this away. (Break on purpose: gate pointsEl's
  // cup half on `a.SeuraCUPPoints` and not the rail, and the rows keep them.)
  const realFetch = appJs.fetchJson;
  appJs.setFetchJson((url, opts) =>
    url === '/api/meet/democup' ? Promise.resolve({ cup: false }) : realFetch(url, opts),
  );
  await go(`/c/democup/g/${encodeURIComponent(groupKey(10, 0, '60m'))}`, 1400);
  ok(
    'a meet without the flag shows no points',
    !D.querySelector('#app .cup-points') && !D.querySelector('#app .qual-note'),
  );
  await go('/c/democup', 1600);
  ok('and no row on its meet page', !rows('#app .row-title').some((n) => text(n) === 'Seuracup'));
  await go('/c/democup/cup', 1400);
  log(`not a cup: ${text(D.querySelector('#app .notice'))}`);
  ok(
    'and the route itself says so rather than drawing an empty table',
    !D.querySelector('#app table') &&
      text(D.querySelector('#app .notice')) === 'Tämä kilpailu ei ole Seuracup-osakilpailu.',
  );
  appJs.setFetchJson(realFetch);
}
