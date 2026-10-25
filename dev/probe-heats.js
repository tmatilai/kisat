// Checks a start run in several heats on the demo alone (docs/views.md,
// "A start's page"). It covers heat order, the toggle and
// its freeze, the heat chips, the winds and the tables a heat can be.
//   dev/probe.html?probe=probe-heats
export default async function probe({ D, W, log, ok, groupKey, appJs, demoJs, settle }) {
  const KEYS = {
    alkuerat100: groupKey(9, 45, '100m'),
    alkuerat: groupKey(8, 30, '200m'),
    valierat: groupKey(9, 30, '200m'),
    karsinta: groupKey(11, 0, 'Pituus'),
    finaali: groupKey(12, 0, '100m'),
    aidat: groupKey(15, 30, '400m aidat'),
    kiekko: groupKey(16, 15, 'Kiekko'),
    aitaviesti: groupKey(16, 30, '4x60m aitaviesti'),
  };
  const open = async (name) => {
    appJs.navigate(`/c/demo/g/${encodeURIComponent(KEYS[name])}`);
    await settle();
  };
  const headings = () => [...D.querySelectorAll('#app h3')].map((h) => h.textContent.trim());
  // Reads the heat number off the heading's own text node. The heading also
  // carries its chip (heatChip) and any wind (windSpan), and a third aside
  // must not break the order checks.
  const heatHeads = () =>
    [...D.querySelectorAll('#app h3')]
      .filter((h) => /^Erä /.test(h.textContent))
      .map((h) => ({ el: h, text: h.firstChild.textContent.trim() }));
  const heatHeadings = () => heatHeads().map((h) => h.text);
  // Reads each heat heading's chip in heat order.
  const heatChips = () => heatHeads().map((h) => h.el.querySelector('.chip')?.textContent.trim() || '—');
  const showing = () =>
    [...D.querySelectorAll('#app .seg-btn')].find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent;
  const tap = async (label) => {
    [...D.querySelectorAll('#app .seg-btn')].find((b) => b.textContent === label).click();
    await settle();
  };
  const cells = (tr) => [...tr.children].map((td) => td.textContent.trim());

  // --- A round still being run opens on its heats ---
  await open('valierat');
  ok('toggle offered on a half-run round', !!D.querySelector('#app .seg'));
  ok('opens on Erät while unfinished', showing() === 'Erät');

  // The view stays on Erät when render(true), the 25 s refresh, catches the
  // round finishing (resultViewState, app/event.js).
  const setValieratStatus = (s) => {
    demoJs.DEMO_EVENTS.e9.Rounds.find((r) => r.Id === 'r9v').Status = s;
  };
  setValieratStatus('Official');
  await appJs.render(true);
  await settle();
  ok('a round finishing under the reader does not switch the view', showing() === 'Erät');
  setValieratStatus('Progress');

  // --- Each heat's chip says whether it has run (heatChip, app/event.js) ---
  // Välierät has heat 1 run and heat 2 still to come. Without the chips only
  // the columns would tell the two apart.
  log(`välierät heat chips: ${heatChips().join(' | ')}`);
  ok('a chip per heat, saying which is which', heatChips().join('|') === 'Tulokset|Ei vielä tuloksia');
  // e32, off competition 20348's N 100m Alkuerät, has five heats and the
  // boundary in the middle, where a reader scrolls to find it. Two heats on
  // one screen would pass a chip that worked only in pairs.
  await open('alkuerat100');
  log(`100m alkuerät chips: ${heatChips().join(' | ')}`);
  ok(
    'the boundary is marked wherever it falls',
    heatChips().join('|') === 'Tulokset|Tulokset|Tulokset|Ei vielä tuloksia|Ei vielä tuloksia',
  );
  ok('a chip on every one of the five heats', heatChips().length === 5);
  // The chip and its table take one hasResults, so a run heat is ranked
  // (Sija, Tulos) and one to come is a lane sheet (Rata, SB). Each heading is
  // checked against its own table, so a heading that loses its table fails.
  const headOf = (h) => [...h.el.nextElementSibling.querySelectorAll('th')].map((t) => t.textContent.trim());
  ok(
    "each chip agrees with its own table's columns",
    heatHeads().every(({ el: h }) => {
      const done = h.querySelector('.chip').textContent.trim() === 'Tulokset';
      const cols = headOf({ el: h });
      return (
        done === (cols.includes('Sija') && cols.includes('Tulos')) &&
        done !== (cols.includes('Rata') && cols.includes('SB'))
      );
    }),
  );
  // The two heats still to come are lane sheets with both bests, not empty
  // results tables.
  ok(
    'the heats still to come are lane sheets',
    heatHeads()
      .slice(3)
      .every(({ el: h }) => headOf({ el: h }).join(',') === 'Rata,Nro,Nimi,PB,SB'),
  );

  // --- A dead heat at the cut wears the badge on both rows ---
  // The sixth and last q is a tie the API gives to one half
  // (docs/tuloslista-api.md). The round must reach qualBadgeEl for the
  // other half's q to show. Aada's same 12,61 ranks alone and stays bare.
  const rowFor = (name) => [...D.querySelectorAll('#app tbody tr')].find((tr) => tr.textContent.includes(name));
  const badgeOf = (name) => rowFor(name)?.querySelector('td.result .q-badge')?.textContent.trim() ?? '—';
  log(
    `12,61: Lotta ${badgeOf('Lotta Esimerkkinen')}, Alisa ${badgeOf('Alisa Mittainen')}, ` +
      `Aada ${badgeOf('Aada Mallinen')}`,
  );
  // (Break on purpose: drop qualBadgeEl's round argument, and Alisa reads "—".)
  ok('both halves of the tie carry it', badgeOf('Lotta Esimerkkinen') === 'q' && badgeOf('Alisa Mittainen') === 'q');
  // (Break on purpose: tie on Result in tiedQualBadge, and Aada reads q.)
  ok('and the same time on its own rank does not', badgeOf('Aada Mallinen') === '—');
  ok('the badge is still muted while the round runs', !!rowFor('Alisa Mittainen').querySelector('.q-badge-pending'));

  // --- A finished round opens on the merged list ---
  await open('alkuerat');
  ok('opens on Kokonaistulokset when finished', showing() === 'Kokonaistulokset');
  ok('no heat headings there', heatHeadings().length === 0);
  const rows = [...D.querySelectorAll('#app tbody tr')];
  ok('whole field in one table', rows.length === 8);
  log(`first: ${cells(rows[0]).join(' | ')}`);
  log(`last: ${cells(rows[7]).join(' | ')}`);
  ok('ranked 1..8 round-wide', rows.map((tr) => cells(tr)[0]).join(',') === '1.,2.,3.,4.,5.,6.,7.,8.');
  // The winner ran in heat 2, and with no heat headings only her club line
  // can say so.
  ok("leader is heat 2's own winner", /Milla Kokeinen/.test(cells(rows[0])[2]));
  ok('every row names its heat', rows.filter((tr) => /Erä \d/.test(tr.textContent)).length === 8);

  // --- The heats, and their own places ---
  await tap('Erät');
  const heatHeadingText = heatHeadings();
  log(`heat headings: ${heatHeadingText.join(', ')}`);
  ok('four heats, in heat order', heatHeadingText.join('|') === 'Erä 1|Erä 2|Erä 3|Erä 4');
  // Every heat of a finished round has run, so every chip reads Tulokset. A
  // chip on one state only would leave these heats bare.
  ok('every heat of a finished round is chipped', heatChips().join('|') === 'Tulokset|'.repeat(3) + 'Tulokset');
  ok('four tables', D.querySelectorAll('#app .tbl-wrap').length === 4);
  // Each heat counts its own places from 1 (displayRank). Heat by heat, the
  // round-wide places are 2/6, 1/7, 3/5 and 4/8.
  const heatRanks = [...D.querySelectorAll('#app tbody')].map((b) =>
    [...b.querySelectorAll('tr')].map((tr) => cells(tr)[0]).join(','),
  );
  log(`heat places: ${heatRanks.join(' | ')}`);
  ok(
    'every heat counts from 1',
    heatRanks.every((r) => r === '1.,2.'),
  );

  // A tapped view holds through the same refresh.
  await appJs.render(true);
  await settle();
  ok('a tap survives a refresh', showing() === 'Erät');

  // Leaving the start drops the tap, so the start opens on its own status
  // again.
  appJs.navigate('/c/demo');
  await settle();
  await open('alkuerat');
  ok('leaving and returning decides afresh', showing() === 'Kokonaistulokset');

  // --- The wind rides on the heading, and only where it means something ---
  // Alkuerät has opened merged again. Each of its four heats carries a
  // reading, and the readings show in the Erät view.
  const winds = () => [...D.querySelectorAll('#app .wind')].map((s) => s.textContent.trim());
  ok('no wind in the merged list', winds().length === 0);
  await tap('Erät');
  log(`heat winds: ${winds().join(' | ')}`);
  ok('a reading per heat heading, in heat order', winds().join('|') === 'tuuli +0,2|tuuli −0,1|tuuli +0,1|tuuli 0,0');
  ok(
    'on the heading, not in the table',
    [...D.querySelectorAll('#app .wind')].every((s) => s.closest('h3') && !s.closest('table')),
  );
  // Välierät's heat 2 is not yet run and carries 'NM', "not measured", which
  // must not print as a wind (docs/tuloslista-api.md, "Wind").
  await open('valierat');
  log(`välierät winds: ${winds().join(' | ')}`);
  ok('NM is not a wind', winds().join('|') === 'tuuli +0,3');

  // --- Nothing to toggle ---
  await open('finaali');
  ok('single-heat final has no toggle', !D.querySelector('#app .seg'));
  // A lone heat has no "Erä 1" heading and this start has one class, so its
  // wind goes on the title.
  log(`final winds: ${winds().join(' | ')}`);
  ok('single-heat start shows it on the title', winds().join('|') === 'tuuli −0,3');
  ok('on the Tulokset heading', D.querySelector('#app .wind')?.closest('h2')?.textContent.includes('Tulokset'));

  // --- The class order in a start of several classes ---
  // Classes go in programme order (compareCategories, lib/schedule.js), and
  // those nobody entered go last (renderGroup). This start's programme order
  // is P13, M, N with M alone run, so neither rule alone gives M, P13, N.
  await open('aidat');
  const cats = [...D.querySelectorAll('#app .cat-badge')].map((b) => b.textContent.trim());
  log(`categories: ${cats.join(', ')}`);
  ok('entrants first, then programme order', cats.join(',') === 'M,P13,N');
  const catHeads = headings().filter((t) => !/^Erä /.test(t));
  log(`headings: ${catHeads.join(' | ')}`);
  ok('headings follow', catHeads.map((t) => t.split(' ')[0]).join(',') === 'M,P13,N');
  // P13's round is a heat shell with nobody in it, and N has no round at all.
  // Both say so, and only M draws a table. (Break on purpose: read a round as
  // drawn by Heats.length in roundAllocated, and P13 draws an empty table.)
  const notices = [...D.querySelectorAll('#app .notice')].map((n) => n.textContent.trim());
  const tables = D.querySelectorAll('#app table, #app .ladder-views').length;
  log(`notices: ${JSON.stringify(notices)}, tables: ${tables}`);
  ok('the empty ones say nobody is in them', notices.join('|') === 'Ei ilmoittautuneita.|Ei ilmoittautuneita.');
  ok('...and draw no table', tables === 1);
  // M's one heat carries a reading, but a 400 m race takes no wind (heatWind,
  // lib/results.js). Neither this heading nor the class's own prints it.
  ok('no wind on a 400 m', winds().length === 0);

  // --- The same on a field event, as a ladder grid and ladder cards ---
  await open('karsinta');
  ok('field round offers it too', !!D.querySelector('#app .seg'));
  ok('finished field round opens merged', showing() === 'Kokonaistulokset');
  // Both layouts are in the DOM, and CSS shows one (ladderViews,
  // app/event.js). The grid is counted for structure and the cards for
  // content.
  ok('one merged ladder', D.querySelectorAll('#app .tbl.ladder').length === 1);
  const cards = () => [...D.querySelectorAll('#app .ladder-card')];
  ok('all four jumpers in it', cards().length === 4);
  log(`field first: ${cards()[0]?.textContent.replace(/\s+/g, ' ').trim().slice(0, 70)}`);
  ok('field rows name their heat', cards().filter((c) => /Erä \d/.test(c.textContent)).length === 4);
  // r3q's round-wide ranks are 1, 2, 8 and 13 (demo.js), so the check is on
  // their order and not on 1..4. A real Karsinta ranks round-wide too
  // (docs/tuloslista-api.md, "Results and ranks").
  const fieldRanks = cards().map((c) => parseInt(c.querySelector('.num').textContent, 10));
  log(`field ranks merged: ${fieldRanks.join(', ')}`);
  ok(
    'field ranked round-wide',
    fieldRanks.every((r, i) => i === 0 || r > fieldRanks[i - 1]),
  );
  await tap('Erät');
  const perHeat = cards().map((c) => c.querySelector('.num').textContent.trim());
  log(`field places per heat: ${perHeat.join(', ')}`);
  ok('field heats count from 1', perHeat.join(',') === '1.,2.,1.,2.');

  // --- A field start drawn and not yet thrown, off 20348's N Kiekko ---
  // With no attempt taken, the start is a start list with both bests
  // (startListTable, app/event.js). An
  // attempt grid would have no columns and an empty Tulos.
  await open('kiekko');
  const headers = () => [...D.querySelectorAll('#app thead th')].map((t) => t.textContent.trim());
  log(`kiekko columns: ${headers().join(' | ')}`);
  ok('a throwing order and both bests', headers().join('|') === 'Järj.|Nro|Nimi|PB|SB');
  // (Break on purpose: drop fieldLadderTable's start-list branch, and the
  // columns read Järj.|Nro|Nimi|Tulos with nothing under them.)
  ok('no attempt grid at all', !D.querySelector('#app .tbl.ladder') && !D.querySelector('#app .ladder-card'));
  const kiekkoRows = [...D.querySelectorAll('#app tbody tr')];
  ok(
    'six in the ring, in drawn order',
    kiekkoRows.length === 6 && kiekkoRows.map((tr) => cells(tr)[0]).join(',') === '1,2,3,4,5,6',
  );
  log(`kiekko row 4: ${cells(kiekkoRows[3]).join(' | ')}`);
  // Row 4's PB is further than her SB, so the two columns cannot swap
  // unseen.
  ok('the bests are on the page', cells(kiekkoRows[3]).slice(-2).join('|') === '52.33|50.46');
  ok('and the one with no mark reads as empty, not as a dash', cells(kiekkoRows[0]).slice(-2).join('') === '');

  // --- An aitaviesti's lane column (shuttlePairDraw, lib/hurdles.js) ---
  // A team's hurdles fill both lanes of its pair and the draw names one, so
  // the column is the pair. The check runs in Kisat mode, with no setup box.
  // e13 draws a measured meet's shape (2026-02), with three teams at 2, 4
  // and 6.
  await open('aitaviesti');
  const laneCells = () => [...D.querySelectorAll('#app tbody tr')].map((tr) => cells(tr)[0]);
  log(`aitaviesti columns: ${headers().join(' | ')}`);
  ok("an aitaviesti's lane column names the pair", headers()[0] === 'Radat' && laneCells().join(',') === '1–2,3–4,5–6');
  // Where a meet numbers the pairs (measured, 2026-09), a pair would name
  // lanes nobody stands in, so the drawn number stands under Rata. (Break on
  // purpose: return true from shuttlePairDraw and this reads Radat /
  // 1–2,1–2,3–4.)
  const e13 = demoJs.DEMO_EVENTS.e13.Rounds[0].Heats[0].Allocations;
  e13.forEach((a, i) => {
    a.Position = i + 1;
  });
  await appJs.render(true);
  await settle();
  ok(
    '...and falls back where the draw is not a pair per team',
    headers()[0] === 'Rata' && laneCells().join(',') === '1,2,3',
  );
  e13.forEach((a, i) => {
    a.Position = 2 * i + 2;
  });
  await appJs.render(true);
  await settle();
  ok('...and the fixture is whole again', laneCells().join(',') === '1–2,3–4,5–6');

  // Nothing overflows the phone's width, though the name cell carries the
  // heat tag (athleteNameParts) and the filter bar carries the toggle.
  await open('alkuerat');
  const doc = D.documentElement;
  log(`page width ${doc.scrollWidth} vs viewport ${W.innerWidth}`);
  ok('no horizontal overflow', doc.scrollWidth <= W.innerWidth + 1);
  const bar = D.querySelector('#app .filter-bar').getBoundingClientRect();
  log(`toggle bar ${Math.round(bar.width)}px wide, ${bar.height}px tall`);
  ok('toggle on one line', bar.height < 60);
}
