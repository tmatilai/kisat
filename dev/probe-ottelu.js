// Verifies the multi-events end to end (docs/views.md, "Multi-events"). It
// checks the Ottelut section on the schedule view, the standings page, a
// leg's own start with its points, and a multi-event not yet started. The
// logic is lib/combined.js's (combinedEventStarts, combinedLegColumns), and
// app/event.js draws it (renderCombined, combinedStandingsTable, pointsEl).
//
//   dev/probe.html?probe=probe-ottelu
//
// The demo holds every case, so no Worker is needed. One of its multi-events
// has a scored leg, a running one and an unstarted one, and another has drawn
// legs and no score. Each is modelled on a measured meet.
export default async function probe({ D, W, log, ok, wait, groupKey, appJs }) {
  const go = async (hash, ms = 1200) => {
    appJs.navigate(hash);
    await wait(ms);
  };
  const text = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : null);
  const rows = (sel) => [...D.querySelectorAll(sel)];
  const heads = (level) => rows(`#app ${level}`).map((h) => text(h));
  // Finds the Ottelut fold by its summary, since the sections above the day
  // vary by meet. A cup meet adds a row, for one (probe-cup).
  const otteluBox = () => rows('#app > details > summary').find((h) => text(h) === 'Ottelut')?.parentElement;
  const otteluList = () => otteluBox()?.querySelector('.list');

  // --- The schedule view: one section for the whole meet ---
  await go('/c/demo', 1800);
  const label = (n) =>
    n.matches('details')
      ? text(n.querySelector('summary'))
      : n.matches('h2')
        ? text(n)
        : n.className || n.tagName.toLowerCase();
  const sections = rows('#app > *').map(label);
  log(`schedule flow: ${sections.join(' / ').slice(0, 160)}`);
  // The filter bar leads, then the multi-events, then the day's own list, so
  // no section the filter governs sits above it. (Break on purpose: push the
  // Ottelut section before filterBar.)
  ok('the filter bar leads the page', sections[0] === 'filter-bar');
  ok(
    "the multi-events come next, above the day's list",
    sections.indexOf('Ottelut') > sections.indexOf('filter-bar') &&
      sections.indexOf('Ottelut') < sections.lastIndexOf('list'),
  );
  const otteluRows = otteluList() ? [...otteluList().children] : [];
  log(`ottelu rows: ${otteluRows.map((r) => text(r)).join(' | ')}`);
  ok(
    'a row per multi-event, in programme order',
    otteluRows.length === 3 &&
      text(otteluRows[0]).startsWith('P9 3-ottelu') &&
      text(otteluRows[1]).startsWith('T9 3-ottelu') &&
      text(otteluRows[2]).startsWith('T11 3-ottelu'),
  );
  const t9Row = otteluRows[1];
  // A row has no leg count, no day on a one-day meet and no varmistus line
  // once started (combinedStartRow, probe-varmistus).
  ok('and nothing else but its chip', !t9Row.querySelector('.row-sub'));
  // One leg has been run, so the chip reads under way and not the least
  // advanced leg's phase (combinedEventStatus, lib/schedule.js).
  ok('and a chip for the multi-event as a whole', text(t9Row.querySelector('.chip')) === 'Käynnissä');
  ok('the one that has not started says so', text(otteluRows[0].querySelector('.chip')) === 'Eräjaot tehty');
  // The legs stay ordinary starts in the day list, the page's last top-level
  // `.list`, as the Ottelut section's list sits inside the fold.
  const dayTitles = [...rows('#app > .list').pop().querySelectorAll('.row-title')].map((n) => text(n));
  log(`legs in the day list: ${dayTitles.filter((t) => /3-ottelu/.test(t)).join(' | ')}`);
  ok('the legs are still in the day list', dayTitles.filter((t) => /3-ottelu/.test(t)).length === 9);

  // --- The fold ---
  // A shut fold stays shut on the way back. (Break on purpose: drop
  // `ottelut` from normalizeCompView and the way back opens it again.)
  const dayTop = () => rows('#app > .list').pop().getBoundingClientRect().top;
  const wasOpen = dayTop();
  ok('open to begin with', otteluBox().open);
  otteluBox().querySelector('summary').click();
  await wait(200);
  log(`day list top: ${Math.round(wasOpen)} open, ${Math.round(dayTop())} shut`);
  ok("shut, the day's starts come up to meet it", !otteluBox().open && dayTop() < wasOpen - 40);
  await go('/', 900);
  await go('/c/demo', 1800);
  ok('and the way back leaves it shut', !otteluBox().open);
  otteluBox().querySelector('summary').click();
  await wait(200);
  ok('reopening brings the rows back', otteluBox().open && otteluList().children.length === 3);

  // --- The standings ---
  otteluList().children[1].click();
  await wait(1500);
  log(`hash: ${W.location.pathname}`);
  ok('the row opens the standings route', /\/c\/demo\/o\/T9%203-ottelu$/.test(W.location.pathname));
  log(`title: ${text(D.getElementById('title'))}`);
  ok('titled for the multi-event', text(D.getElementById('title')) === 'T9 3-ottelu');
  log(`headings: ${heads('h2').join(' | ')}`);
  ok('two sections: the points and the legs', heads('h2').length === 2 && heads('h2')[1] === 'Osalajit');

  const table = D.querySelector('#app table.tbl.standings');
  const head = [...table.querySelectorAll('thead th')].map((th) => text(th));
  log(`columns: ${head.join(' | ')}`);
  // The columns follow the contest order (SubEvents[].Index), which the
  // fixture lists out of order. (Break on purpose: drop the sort in
  // combinedLegColumns and this reads Pituus / Kuula / 40m.)
  ok('a column per leg, in contest order', head.join('|') === 'Sija|Nimi|40m|Pituuskesken|Kuula|Pisteet');
  // Only the leg under way says "kesken", as its points are not final. The
  // 40m's own round is stale at Progress, and the schedule's Official wins
  // (combinedLegColumns, lib/combined.js). (Break on purpose: read the status
  // off the SubEvent's own round and the finished 40m reads "kesken" too.)
  // Each heading links to the leg's own start. (Break on purpose: render the
  // label as plain text and these are 0 links.)
  const legLinks = [...table.querySelectorAll('thead a.leg-link')];
  log(`leg links: ${legLinks.map((a) => `${text(a)} -> ${a.getAttribute('href').slice(-24)}`).join(' | ')}`);
  ok('every column heading opens its own start', legLinks.length === 3);
  ok(
    "and the 40m's points to the 40m",
    legLinks[0].getAttribute('href') === `/c/demo/g/${encodeURIComponent(groupKey(8, 45, '3-ottelu 40m'))}`,
  );
  const states = [...table.querySelectorAll('thead .leg-state')].map((s) => text(s));
  log(`leg states: ${states.join(' | ')}`);
  ok('only the leg being contested says so', states.join('|') === 'kesken');
  // The chip beside the heading states the ottelu's phase, and no notice
  // repeats it.
  ok(
    'and nothing repeats the chip in prose',
    ![...D.querySelectorAll('#app .notice')].some((n) => /kesken/.test(n.textContent)),
  );
  const body = [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => text(td)));
  log(
    `standings: ${body
      .map((r) => r.join(' '))
      .join(' // ')
      .slice(0, 320)}`,
  );
  ok('one row per athlete, ranked', body.length === 7 && body[0][0] === '1.');
  // A cell leads with its points and has the mark that scored them under,
  // as this is the multi-event's own table. (Break on purpose: swap the two
  // lines in standingsCell and this reads "7,22 200 p.".)
  ok('each cell leads with the points', /^200 p\.\s*7,22$/.test(body[0][2]));
  // The gap is a block under the total, so the cell's text runs the two
  // together. The page shows "350−42" on two lines.
  ok(
    'the total ranks the table',
    body.map((r) => (r[5].match(/^\d+/) || [''])[0]).join(',') === '392,350,316,302,134,401,',
  );
  // Every total but the leader's carries its gap to the leader, muted under
  // it. A guest above the leader reads ahead, as she is ranked against
  // nobody (combinedLeaderPoints, lib/combined.js). (Break on purpose: take
  // the leader as the biggest total and the winner's own cell grows a "−9".
  // Everybody else is then measured against the guest.)
  log(`totals: ${body.map((r) => r[5]).join(' | ')}`);
  ok('the leader is the one row with nothing to make up', body[0][5] === '392');
  ok(
    'and everybody else is measured against her',
    body
      .slice(1, 5)
      .map((r) => r[5])
      .join('|') === '350−42|316−76|302−90|134−258',
  );
  ok('the guest above her reads as ahead, not behind', body[5][5] === '401+9');
  ok('her own row is ranked nowhere', body[5][0] === '—');
  // A withdrawal's total is a word, so it has no gap and no rank
  // (combinedGap, docs/tuloslista-api.md).
  ok('a withdrawal carries its own word and no gap under it', body[6][5] === 'DNF');
  ok('and is ranked nowhere either', body[6][0] === '—');
  // A leg somebody has not reached yet is blank and not a zero.
  ok('an unjumped leg is an empty cell', body[4][3] === '' && body[6][3] === '');
  ok(
    'and an unstarted leg is a whole empty column',
    body.every((r) => r[4] === ''),
  );
  // The 40m ran in two heats, and every row has its mark (totalResults).
  // (Break on purpose: read Rounds[0].Heats[0] and four rows lose theirs.)
  ok(
    'both heats of the 40m are in it',
    body.every((r) => /p\./.test(r[2])),
  );
  // The name cell is the shared one, with a club line under the name and the
  // athlete link that opens the quick-filter.
  ok(
    'the shared name cell, club line and all',
    !!table.querySelector('tbody tr .cell-name .org') && !!table.querySelector('tbody tr .cell-name a.athlete-link'),
  );
  // The root's own heat is a container and not a race, so no row names it.
  // (Break on purpose: leave totalResults' heatIndex on the rows in
  // combinedTotals and every name grows an "Erä 0".)
  ok('and no heat tag on any of them', !table.querySelector('tbody .heat-tag'));

  // As a ladder table, it has a min-width the wrapper scrolls under at phone
  // width, and Sija and Nimi stay pinned while the legs scroll. The width is
  // standingsWidth's, 40 + 150 + 64 + 3 x 88.
  const wrap = table.closest('.tbl-wrap');
  const sticky = (n) => W.getComputedStyle(table.querySelectorAll('tbody tr td')[n]).position;
  log(
    `table: min-width ${table.style.minWidth}, wrap ${wrap.clientWidth} of ${wrap.scrollWidth}, ` +
      `sticky ${sticky(0)}/${sticky(1)}/${sticky(2)}`,
  );
  ok('sized off its leg count', table.style.minWidth === '518px');
  ok("and scrolls inside the phone's width", wrap.scrollWidth > wrap.clientWidth);
  ok(
    'with Sija and Nimi pinned and the legs not',
    sticky(0) === 'sticky' && sticky(1) === 'sticky' && sticky(2) !== 'sticky',
  );
  // Three legs fit the ordinary 1000 px main, and a decathlon's ten do not.
  ok('a short multi-event does not widen the page', !D.getElementById('app').classList.contains('wide'));

  // Each leg below links to its own start.
  const legRows = [...D.querySelectorAll('#app > .list')].pop().children;
  log(`legs: ${[...legRows].map((r) => text(r)).join(' | ')}`);
  ok(
    'three legs, in schedule order',
    [...legRows].map((r) => text(r.querySelector('.row-title'))).join('|') === '40m|Pituus|Kuula',
  );
  ok(
    'each with its own status chip',
    [...legRows].map((r) => text(r.querySelector('.chip'))).join('|') === 'Tulokset valmiit|Käynnissä|Eräjaot tehty',
  );

  // --- A leg's own start: points beside the marks, standings under them ---
  legRows[0].click();
  await wait(1500);
  log(`leg hash: ${W.location.pathname}`);
  ok(
    'a leg opens the ordinary event view',
    W.location.pathname === `/c/demo/g/${encodeURIComponent(groupKey(8, 45, '3-ottelu 40m'))}`,
  );
  // This reads the leg's own table and not the standings under it.
  const results = [...D.querySelectorAll('#app .tbl:not(.standings) tbody tr')].map((tr) => text(tr));
  log(`40m rows: ${results.join(' // ').slice(0, 240)}`);
  // (Break on purpose: drop pointsRail's IsCombinedEvent branch and every
  // one of these loses its points.)
  ok('every result carries its score', results.filter((r) => /\d+ p\./.test(r)).length === 7);
  ok('the mark is still the mark', /7,22\s*200 p\./.test(results[0]));

  // The leg's page ends with the ottelu's standings table, under the leg's
  // own results. (Break on purpose: drop the standings block from
  // categorySections and this section is gone.)
  const legStandings = D.querySelector('#app table.tbl.standings');
  // The table folds under a summary that is its title (standingsShell).
  const legTitle = text(legStandings?.closest('details')?.querySelector('summary')) || '';
  log(`leg page standings: ${legTitle}`);
  ok("the leg page carries the ottelu's standings", /^T9 3-ottelu · ottelupisteet/.test(legTitle));
  // The column of the leg whose page this is links nowhere. (Break on
  // purpose: stop passing the leg's EventId to combinedStandingsTable and
  // the 40m links to itself.)
  const legPageLinks = [...(legStandings?.querySelectorAll('thead a.leg-link') || [])].map((a) => text(a));
  log(`links on the leg page: ${legPageLinks.join(' | ')}`);
  ok('the column you are already on is not a link', legPageLinks.join('|') === 'Pituus|Kuula');
  ok(
    'and it is the same table the standings page shows',
    !!legStandings && [...legStandings.querySelectorAll('tbody tr')].length === 7,
  );
  ok(
    "below the leg's own results, not above them",
    !!legStandings &&
      legStandings.compareDocumentPosition(D.querySelector('#app .tbl:not(.standings)')) ===
        Node.DOCUMENT_POSITION_PRECEDING,
  );
  ok("and its heading carries the ottelu's own chip", /Käynnissä$/.test(legTitle));

  // An ordinary event's allocations carry CEPoints 0 too, so pointsRail gates
  // the score on IsCombinedEvent. A gate on the value would print "0 p." on
  // every result.
  await go(`/c/demo/g/${encodeURIComponent(groupKey(12, 0, '100m'))}`, 1200);
  const ordinary = [...D.querySelectorAll('#app tbody tr')].map((tr) => text(tr));
  log(`M 100m rows: ${ordinary.join(' // ').slice(0, 200)}`);
  // This checks .ce-points and not the text, as a cup meet's cell carries
  // club points there too (pointsEl, probe-cup). The demo carries
  // SeuraCUPPoints without being a cup meet.
  ok('an ordinary event shows no leg points at all', ordinary.length > 0 && !D.querySelector('#app .ce-points'));

  // --- The follow-list reaches the section ---
  // The athlete quick-filter needs no /api call here, as the demo's roster
  // comes from the fixture (probe-pending uses the same route). o1 is the
  // athlete leading the T9 3-ottelu.
  await go('/c/demo#/a/o1-a', 2200);
  log(`after the quick filter: ${W.location.pathname}`);
  const watched = [...otteluList().children];
  log(`ottelut when filtered: ${watched.map((r) => text(r)).join(' | ')}`);
  ok('the multi-event is still listed', watched.length === 1);
  const line = watched[0].querySelector('.watch-row-athlete');
  ok('and now carries the followed athlete', !!line);
  const cells = line ? [...line.children].map((c) => text(c)) : [];
  log(`her line: ${JSON.stringify(cells)}`);
  // Her line gives name, club, her place in the whole multi-event and the
  // points behind it (combinedWatchLines). (Break on purpose: read the lines
  // off a leg and not the root, and the place becomes the 40m's.)
  ok(
    'with her standing in the ottelu, not in a leg',
    cells[1] === 'Oona Demoinen' && cells[3] === '1/7' && /^392\s*p\.$/.test(cells[4]),
  );
  // The placing is muted until the whole multi-event is finished, as a
  // day-list placing is while its round can still move (combinedWatchLine).
  ok('and the placing is muted while it can still move', line.querySelector('.watch-row-pos-pending') !== null);
  // The day list below keeps her own legs.
  const dayRows = [...D.querySelectorAll('#app > .list')].pop().children;
  ok('her three legs are in the day list below', dayRows.length === 3);

  // --- The multi-event that has not started ---
  //
  // Its root's round is an empty heat shell, as an undrawn round's can be
  // (docs/tuloslista-api.md), so the entry list stands in for the field
  // until a leg is scored (combinedTotals). (Break on purpose: drop the
  // Enrollments fallback in combinedTotals and the table gives way to
  // "Ottelun kokonaispisteitä ei ole julkaistu.")
  await go('/c/demo/o/P9%203-ottelu', 1500);
  log(`unstarted: ${text(D.getElementById('title'))}`);
  const empty = D.querySelector('#app table.tbl.standings');
  const emptyBody = empty
    ? [...empty.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => text(td)))
    : [];
  log(`entry list: ${emptyBody.map((r) => r.join(' ')).join(' // ')}`);
  ok('the entry list stands in for the standings', emptyBody.length === 4);
  ok('with the names on it', emptyBody[0] && /Eino Demoinen/.test(emptyBody[0][1]));
  ok(
    'nobody is placed',
    emptyBody.every((r) => r[0] === '—'),
  );
  ok(
    'no total, and so no gap either',
    emptyBody.every((r) => r[5] === ''),
  );
  ok(
    'and the legs are still columns of their own',
    empty &&
      [...empty.querySelectorAll('thead th')].map((th) => text(th)).join('|') === 'Sija|Nimi|40m|Pituus|Kuula|Pisteet',
  );
  // (Break on purpose: write a sentence about the unscored total.)
  const notices = () => [...D.querySelectorAll('#app .notice')].map((n) => text(n));
  log(`notices: ${JSON.stringify(notices())}`);
  ok(
    'the em dashes are left to stand on their own',
    notices().every((t) => t.startsWith('Varmistaneita')),
  );
  ok('and its three legs are listed below', [...D.querySelectorAll('#app > .list')].pop().children.length === 3);

  // A key that names nothing gets an answer and not an error page.
  await go('/c/demo/o/N17%207-ottelu', 1200);
  log(`missing: ${text(D.getElementById('title'))} — ${text(D.querySelector('#app .notice'))}`);
  ok('an unknown multi-event says so', text(D.getElementById('title')) === 'Ottelua ei löytynyt');
}
