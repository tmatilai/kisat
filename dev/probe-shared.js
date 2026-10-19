// Verifies the combined heat view of a start whose classes were drawn into
// one physical heat (docs/views.md, "A start's page").
// lib/results.js's heatsAreShared, mergeHeats and heatPlaces decide it, and
// app/event.js's sharedHeatTable draws it. It checks the two tabs, the Erät
// tab read as one race, each row once per tab, and four kinds of start that
// must not use it.
//
//   dev/probe.html?probe=probe-shared
//
// The demo holds every start this reads (demo.js), so no Worker is needed.
export default async function probe({ D, W, log, ok, wait, groupKey, appJs }) {
  const KEYS = {
    kolmetuhatta: groupKey(14, 30, '3000m'),
    kelaus: groupKey(15, 45, '200m kelaus'),
    viesti: groupKey(18, 0, '4x400m viesti'),
    kolmiloikka: groupKey(13, 30, 'Kolmiloikka'),
    kuusikymppi: groupKey(10, 45, '60m'),
    nelisataa: groupKey(13, 45, '400m'),
    aidat: groupKey(15, 30, '400m aidat'),
    alkuerat: groupKey(8, 30, '200m'),
  };
  const open = async (name, ms = 1200) => {
    appJs.navigate(`/c/demo/g/${encodeURIComponent(KEYS[name])}`);
    await wait(ms);
  };
  const cells = (tr) => [...tr.children].map((td) => td.textContent.trim());
  // Lists the page's top-level nodes in order, for the log.
  const flow = () =>
    [...D.querySelectorAll('#app > *')].map((n) =>
      n.matches('h2, h3') ? n.textContent.trim() : n.tagName.toLowerCase(),
    );
  const heads = (level) => [...D.querySelectorAll(`#app ${level}`)].map((h) => h.textContent.trim());
  const tables = () => [...D.querySelectorAll('#app .tbl-wrap table')];
  const bodyRows = (t) => [...t.querySelectorAll('tbody tr')];
  const allRows = () => [...D.querySelectorAll('#app tbody tr')];
  const headRow = (t) => [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
  const segButtons = () => [...D.querySelectorAll('#app .seg-btn')].map((b) => b.textContent);
  const showing = () =>
    [...D.querySelectorAll('#app .seg-btn')].find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent;
  const tap = async (label, ms = 600) => {
    [...D.querySelectorAll('#app .seg-btn')].find((b) => b.textContent === label).click();
    await wait(ms);
  };

  // --- Before the race: the lane allocation of a heat two classes share ---
  await open('kolmetuhatta');
  log(`flow: ${flow().join(' / ').slice(0, 260)}`);
  // Two classes are racing, so the start opens on the races
  // (defaultResultView).
  log(`segment: ${segButtons().join(' | ')} — showing ${showing()}`);
  ok('a shared start is two tabs', segButtons().join('|') === 'Erät|Sarjat');
  ok('an unfinished one opens on the races', showing() === 'Erät');
  ok('titled for a race not yet run', heads('h2').includes('Ratajärjestys'));
  // The view replaces the per-class sections and never stacks above them.
  ok('and nothing else on the page', heads('h2').length === 1);
  // A heading also carries the heat's state chip (heatChip, app/event.js) and
  // its wind, so this reads the heat number alone.
  const heatHeads = [...D.querySelectorAll('#app h3')]
    .filter((h) => /^Erä /.test(h.textContent))
    .map((h) => h.firstChild.textContent.trim());
  log(
    `heat headings: ${heads('h3')
      .filter((t) => /^Erä /.test(t))
      .join(', ')}`,
  );
  ok('one heading per physical heat', heatHeads.slice(0, 2).join('|') === 'Erä 1|Erä 2');
  ok('two tables and no more', tables().length === 2);
  // A 3000 m carries a Wind in the API, though no wind rule covers it. The
  // gate in mergeHeats hides it (heatWind, lib/results.js), or a heading
  // prints −2,6.
  ok('no wind on a 3000 m', D.querySelectorAll('#app .wind').length === 0);

  const [heat1] = tables();
  log(`columns: ${headRow(heat1).join(' | ')}`);
  ok('lane first, category of its own', headRow(heat1)[0] === 'Rata' && headRow(heat1).includes('Sarja'));
  // Before the race the last column is the season's best, as a lane sheet
  // is read for who is up against whom.
  ok('SB where the result will go', headRow(heat1).at(-1) === 'SB');
  const lanes = bodyRows(heat1).map((tr) => cells(tr)[0]);
  const cats1 = bodyRows(heat1).map((tr) => cells(tr).at(-2));
  log(`heat 1 lanes: ${lanes.join(',')} — ${cats1.join(',')}`);
  ok('seven in heat 1', lanes.length === 7);
  ok(
    'read down the lanes',
    lanes.map(Number).every((n, i, a) => i === 0 || n > a[i - 1]),
  );
  // The view exists because neither class's own table reads down the
  // track.
  ok('the two classes interleave', new Set(cats1).size === 2 && cats1[0] !== cats1[1]);
  ok(
    'nobody is placed yet',
    bodyRows(heat1).every((tr) => !/^\d+\.$/.test(cells(tr)[0])),
  );
  ok('and no class placing either', D.querySelectorAll('#app .cat-rank').length === 0);

  // The other tab is the same start class by class, and it holds the class
  // nobody entered.
  await tap('Sarjat');
  log(`sarjat: ${heads('h2').join(' | ')} // ${heads('h3').join(' | ')}`);
  ok('the classes are the other tab', heads('h2').join('') === 'Sarjat');
  ok('all three of them, leftover included', heads('h3').length === 3);
  ok(
    'the empty class says so',
    [...D.querySelectorAll('#app .notice')].some((n) => n.textContent.includes('Ei ilmoittautuneita')),
  );
  ok('no combined table here', ![...D.querySelectorAll('#app thead')].some((h) => h.textContent.includes('Sarja')));

  // --- After: the finish order of the race the crowd watched ---
  await open('kelaus');
  // Every class is official, so this start opens on the classes
  // (defaultResultView).
  log(`kelaus segment: ${segButtons().join(' | ')} — showing ${showing()}`);
  ok('a finished start opens on the classes', showing() === 'Sarjat');
  const perClassRows = allRows().length;
  await tap('Erät');
  // A section heading also carries the wind, so these test a prefix.
  log(`kelaus h2s: ${heads('h2').join(' | ')}`);
  ok(
    'titled for a race that has been run',
    heads('h2').some((t) => t.startsWith('Tulokset') && !t.includes('sarjoittain')),
  );
  ok('one reading of the start at a time', heads('h2').length === 1);
  // A start of one heat has no heading per heat, so a 200 m's wind rides on
  // the section title (renderGroup).
  const winds = [...D.querySelectorAll('#app .wind')];
  log(`winds: ${winds.map((s) => s.textContent.trim()).join(' | ')}`);
  ok(
    'the reading is on the combined heading',
    winds[0]?.textContent.includes('−0,4') && winds[0]?.closest('h2')?.textContent.startsWith('Tulokset'),
  );
  const combined = tables()[0];
  log(`columns: ${headRow(combined).join(' | ')}`);
  ok('placing first now, not the lane', headRow(combined)[0] === 'Sija');
  const rows = bodyRows(combined);
  log(
    rows
      .map((tr) => cells(tr).filter(Boolean).join(' '))
      .join(' ;; ')
      .slice(0, 320),
  );
  ok('everyone in the heat is in it', rows.length === 7);
  // The two tabs are one start read two ways, so each holds every row once.
  log(`rows per tab: Erät ${rows.length}, Sarjat ${perClassRows}`);
  ok('each row once per tab', rows.length === perClassRows);
  // The places are heatPlaces' own, since each class's round places its own
  // winner first and the API's ranks repeat down the heat.
  ok(
    'placed 1..6 over both classes',
    rows
      .slice(0, 6)
      .map((tr) => cells(tr)[0])
      .join(',') === '1.,2.,3.,4.,5.,6.',
  );
  ok('fastest first', rows[0].textContent.includes('26,91'));
  // The class cell carries a place after the label, so this strips the place
  // before counting the classes.
  const catCells = rows.map((tr) => cells(tr).at(-2));
  const catLabels = catCells.map((t) => t.replace(/\s*\d+\.$/, ''));
  log(`class column: ${catCells.join(' | ')}`);
  ok('the two classes are mixed through the order', new Set(catLabels.slice(0, 6)).size === 2);
  // Each row also gives its place in its own class, so the smaller class's
  // winner reads 4th in the heat and 1st in his class.
  const m19 = rows.find((tr) => catCells[rows.indexOf(tr)].startsWith('M19 T54'));
  log(`first M19 row: ${cells(m19).filter(Boolean).join(' ')}`);
  ok('the class carries its own placing', cells(m19)[0] === '4.' && /M19 T54\s*1\.$/.test(cells(m19).at(-2)));
  // The sixth finisher is a guest out of competition, whom the heat places
  // and no class ranks, so five rows carry a class place.
  const guest = rows[5];
  log(`sixth: ${cells(guest).filter(Boolean).join(' ')}`);
  ok('a placed row per class placing', D.querySelectorAll('#app .cat-rank').length === 5);
  ok(
    'the out-of-competition guest is placed but not ranked',
    cells(guest)[0] === '6.' && !/\d\.$/.test(cells(guest).at(-2)),
  );
  // A DNS sorts last and gets no place, which is not the same as last place.
  const dns = rows.at(-1);
  log(`last row: ${cells(dns).filter(Boolean).join(' ')}`);
  ok('the DNS is last and unplaced', /DNS/.test(dns.textContent) && cells(dns)[0] === '—');
  ok('and gets no class placing either', !/\d\./.test(cells(dns).at(-2)));
  // The name is the quick-filter's link, as in the per-class tables.
  ok('names are still athlete links', !!combined.querySelector('.athlete-link'));

  // --- Four classes over two heats, each class in its own combination ---
  // P13 runs heat 1 only, P11 heat 2 only, and T11 and T13 both (demo.js).
  // Neither tab may lose a row or print one twice.
  await open('kuusikymppi');
  log(`60m segment: ${segButtons().join(' | ')} — showing ${showing()}`);
  ok('read as a shared start', segButtons().join('|') === 'Erät|Sarjat');
  await tap('Erät');
  const sixtyHeats = heads('h3').filter((t) => /^Erä /.test(t));
  log(`60m heats: ${sixtyHeats.join(' | ')}`);
  ok('two physical heats', sixtyHeats.length === 2);
  ok('a wind on each, and not the same one', sixtyHeats[0].includes('+0,2') && sixtyHeats[1].includes('−0,5'));
  const [h1, h2] = tables();
  const classesIn = (t) =>
    bodyRows(t).map((tr) =>
      cells(tr)
        .at(-2)
        .replace(/\s*\d+\.$/, ''),
    );
  log(`heat 1 classes: ${classesIn(h1).join(',')}`);
  log(`heat 2 classes: ${classesIn(h2).join(',')}`);
  ok('heat 1 holds T13, P13 and T11 — and no P11', new Set(classesIn(h1)).size === 3 && !classesIn(h1).includes('P11'));
  ok('heat 2 holds T13, P11 and T11 — and no P13', new Set(classesIn(h2)).size === 3 && !classesIn(h2).includes('P13'));
  ok('six in each', bodyRows(h1).length === 6 && bodyRows(h2).length === 6);
  ok(
    'placed 1..6 over every class in the heat',
    bodyRows(h1)
      .map((tr) => cells(tr)[0])
      .join(',') === '1.,2.,3.,4.,5.,6.',
  );
  // One row reads third in the heat and first in her class. A class place is
  // round-wide, so T13's spans both heats.
  const t13 = bodyRows(h1).find((tr) => cells(tr).at(-2).startsWith('T13'));
  log(`first T13 row in heat 1: ${cells(t13).filter(Boolean).join(' ')}`);
  ok('third in the race, first of her class', cells(t13)[0] === '3.' && /T13\s*1\.$/.test(cells(t13).at(-2)));
  const namesIn = (t) => bodyRows(t).map((tr) => cells(tr)[1]);
  const heatNames = [...namesIn(h1), ...namesIn(h2)];
  // The other tab holds the same twelve people in four class tables. A class
  // of two heats is one ranked list whose rows name their heat, and a class
  // of one heat names none.
  await tap('Sarjat');
  const classHeads = heads('h3');
  log(`60m classes: ${classHeads.join(' | ')}`);
  ok('four class sections', classHeads.length === 4);
  const classRows = allRows();
  log(`rows: Erät ${heatNames.length}, Sarjat ${classRows.length}`);
  ok('the same twelve people, once each', classRows.length === 12 && heatNames.length === 12);
  const tagged = classRows.filter((tr) => /Erä \d/.test(tr.textContent));
  log(`rows naming their heat: ${tagged.length}`);
  ok('only the two-heat classes name a heat, and all of their rows do', tagged.length === 8);
  ok('nobody is in two class tables', new Set(classRows.map((tr) => [...tr.children][1].textContent)).size === 12);

  // --- The same with teams ---
  await open('viesti');
  await tap('Erät');
  const relay = tables()[0];
  const relayRows = bodyRows(relay);
  log(
    relayRows
      .map((tr) => cells(tr).filter(Boolean).join(' '))
      .join(' ;; ')
      .slice(0, 320),
  );
  ok('five teams in the heat', relayRows.length === 5);
  ok("the physical winner is the smaller class's", cells(relayRows[0]).at(-2).startsWith('Mixed 15'));
  ok('the DNF is placed nowhere', cells(relayRows.at(-1))[0] === '—');
  // A team entered with six names shows only the four who run, the class's
  // own leg count (relayLegs over relayLineup).
  const legs = relay.querySelector('.org').textContent.split(',').length;
  log(`first team's named runners: ${legs}`);
  ok('four legs named', legs === 4);

  // --- And the starts that must not be read this way ---
  // A field start of two classes calls both heat 1 as well, but each class
  // draws its own order from 1, so the numbers collide (laneDrawn,
  // lib/results.js; docs/tuloslista-api.md, "Heats and allocations").
  await open('kolmiloikka');
  log(`kolmiloikka h2s: ${heads('h2').join(' | ')} // seg: ${segButtons().join('|') || '(none)'}`);
  ok('no combined view for a field start', !heads('h2').includes('Tulokset'));
  ok('read class by class instead', heads('h2').join('').includes('sarjoittain'));
  ok('no class column anywhere', ![...D.querySelectorAll('#app thead')].some((h) => h.textContent.includes('Sarja')));
  // Both classes are on the page in a table each.
  const kolmiHeads = heads('h3');
  log(`kolmiloikka classes: ${kolmiHeads.join(' | ')}`);
  ok('both classes rendered', kolmiHeads.length === 2);
  ok('three jumpers each', D.querySelectorAll('#app .ladder-card').length === 6);

  // A track start's two classes can each draw their own lanes from 1, so six
  // runners share four lanes (lanesAreOneDraw, lib/results.js). The rate is in
  // docs/tuloslista-api.md ("Heats and allocations").
  await open('nelisataa');
  log(`400m h2s: ${heads('h2').join(' | ')} // seg: ${segButtons().join('|') || '(none)'}`);
  ok('no combined view when the lanes collide', !heads('h2').includes('Tulokset'));
  ok('read class by class instead', heads('h2').join('').includes('sarjoittain'));
  ok('no class column anywhere', ![...D.querySelectorAll('#app thead')].some((h) => h.textContent.includes('Sarja')));
  log(`400m classes: ${heads('h3').join(' | ')}`);
  ok('both classes rendered, three runners each', heads('h3').length === 2 && allRows().length === 6);

  // Of three classes only one is drawn, so its own table says it all. One
  // section heading, whatever it reads, shows there is no combined view.
  await open('aidat');
  log(`aidat h2s: ${heads('h2').join(' | ')}`);
  ok(
    'no combined view when the classes do not share a heat',
    heads('h2').length === 1 && !heads('h2')[0].startsWith('Ratajärjestys'),
  );
  // Several heats of one class are not shared, so the start keeps the
  // ordinary Erät and Kokonaistulokset segment.
  await open('alkuerat');
  log(`alkuerät h2s: ${heads('h2').join(' | ')} // seg: ${segButtons().join('|')}`);
  ok('no combined view for a single-category start', heads('h2').length === 1);
  ok('and the plain segment there', segButtons().join('|') === 'Erät|Kokonaistulokset');

  // The class column holds a label and a place, the widest thing these
  // starts render.
  await open('kelaus');
  await tap('Erät');
  const doc = D.documentElement;
  log(`page width ${doc.scrollWidth} vs viewport ${W.innerWidth}`);
  ok('no horizontal overflow', doc.scrollWidth <= W.innerWidth + 1);
}
