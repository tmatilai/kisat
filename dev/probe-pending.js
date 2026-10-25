// Checks the day list's placing and note, the name cell's asides and the
// athlete sheet on the demo. A day-list placing is muted while its round is
// not Official (allocPosition and resultPending, lib/results.js). An
// event-view row carries the nearest earlier round's mark by the name and the
// bests on the club line (athleteNameParts, app/event.js), and the sheet
// lists every earlier round. The wind and the unit decide whether a beaten
// best un-mutes, and a followed row's bold stays off the club line. The
// athlete quick-filter's roster is answered offline for the demo, so no
// Worker is needed.
//
//   dev/probe.html?probe=probe-pending&url=c/demo%23/a/i1-a
export default async function probe({ W, D, log, ok, wait, groupKey, appJs, demoJs, settle }) {
  await wait(1500); // the athlete link's roster fetch and redirect

  log(`path: ${W.location.pathname}`);
  // The rows are found by "200m" alone, as parseEventName (lib/schedule.js)
  // puts the class on a line of its own.
  const rows = [...D.querySelectorAll('.list a.row')].filter((r) => r.textContent.includes('200m'));
  log(`200m rows found: ${rows.length}`);
  const find = (label) =>
    rows.find((r) => r.querySelector('.row-title')?.textContent.includes(label)) ||
    rows.find((r) => r.textContent.includes(label));

  // Alkuerät is Official with every heat run, so the followed runner's 2/8
  // is final and not muted.
  const alku = find('Alkuerät');
  ok('Alkuerät row found', !!alku);
  const alkuPos = alku?.querySelector('.watch-row-pos');
  log(`Alkuerät position: "${alkuPos?.textContent}" pending=${alkuPos?.classList.contains('watch-row-pos-pending')}`);
  ok('Alkuerät shows 2/8', alkuPos?.textContent === '2/8');
  ok('Alkuerät position is NOT muted (round Official)', !alkuPos?.classList.contains('watch-row-pos-pending'));

  // Välierät is Progress with one heat of two run. Her 1/6 is real, but the
  // second heat can still pass it, so it is muted.
  const vali = find('Välierät');
  ok('Välierät row found', !!vali);
  const valiPos = vali?.querySelector('.watch-row-pos');
  log(`Välierät position: "${valiPos?.textContent}" pending=${valiPos?.classList.contains('watch-row-pos-pending')}`);
  ok('Välierät shows 1/6', valiPos?.textContent === '1/6');
  ok('Välierät position IS muted (round still Progress)', valiPos?.classList.contains('watch-row-pos-pending'));
  const valiStyle = D.defaultView.getComputedStyle(valiPos);
  const alkuStyle = D.defaultView.getComputedStyle(alkuPos);
  log(`colors: Alkuerät=${alkuStyle.color} Välierät=${valiStyle.color}`);
  ok('muted position actually renders in a different (muted) color', valiStyle.color !== alkuStyle.color);

  // Loppukilpailu is undrawn and borrows Välierät's field. matchedEntries
  // (lib/watch.js) strips a borrowed row's result and has no heat for it, so
  // the placing is empty and nothing is muted.
  const loppu = find('Loppukilpailu');
  ok('Loppukilpailu row found', !!loppu);
  const loppuPos = loppu?.querySelector('.watch-row-pos');
  log(`Loppukilpailu position: "${loppuPos?.textContent}"`);
  ok('Loppukilpailu position is empty (no stale previous-round rank)', loppuPos?.textContent === '');
  // This final's field can still change, as Välierät has a heat to run.
  const note = (row) => row?.querySelector('.watch-provisional-note')?.textContent.trim() || '';
  log(`Loppukilpailu note: "${note(loppu)}"`);
  ok('the moving final says its field can still change', note(loppu).startsWith('Osallistujat voivat'));
  ok('and neither run round carries the note', !note(alku) && !note(vali));

  // --- A settled final carries no note (fieldMayChange, lib/schedule.js) ---
  // The 800 m's Alkuerät is Official and its cut is made, so the final's
  // three qualifiers are settled, lanes drawn or not. Competition 20348's
  // M 100m final had this shape, with its sixteen decided an hour earlier.
  appJs.navigate('/c/demo#/a/j2-a');
  await settle();
  const eightHundred = [...D.querySelectorAll('.list a.row')].filter((r) => r.textContent.includes('800m'));
  const final800 = eightHundred.find((r) => r.textContent.includes('Loppukilpailu'));
  ok('M 800m final row found', !!final800);
  log(`800m final: note "${note(final800)}" rows ${eightHundred.length}`);
  // (Break on purpose: gate provisional in groupLines, app/meet.js, on
  // `prevField != null` alone.)
  ok('a settled final carries no note at all', note(final800) === '');
  // The row shows the previous round's field, or the check above passes with
  // nothing on it to flag.
  ok(
    "and it really is showing the previous round's field",
    !!final800 && /Otto Testinen/.test(final800.textContent) && !final800.querySelector('.watch-row-pos')?.textContent,
  );

  // --- A final whose earlier round is not drawn yet carries the note ---
  // Before any heat is drawn, the final's line comes from Enrollments, which
  // the earlier round can still narrow. The first round's line cannot change.
  const alku800 = demoJs.DEMO_EVENTS.e10.Rounds.find((r) => r.Id === 'r10a');
  const saved800 = { Heats: alku800.Heats, Status: alku800.Status };
  Object.assign(alku800, { Heats: [], Status: 'Unallocated' });
  await appJs.render(true);
  await settle();
  const undrawn800 = [...D.querySelectorAll('.list a.row')].filter((r) => r.textContent.includes('800m'));
  const undrawnFinal = undrawn800.find((r) => r.textContent.includes('Loppukilpailu'));
  const undrawnAlku = undrawn800.find((r) => r.textContent.includes('Alkuerät'));
  log(`undrawn 800m: final note "${note(undrawnFinal)}", Alkuerät note "${note(undrawnAlku)}"`);
  ok('the final still shows the followed runner', !!undrawnFinal && /Otto Testinen/.test(undrawnFinal.textContent));
  // (Break on purpose: gate provisional in groupLines, app/meet.js, on
  // `prevField != null` again.)
  ok('and says its field can still change', note(undrawnFinal).startsWith('Osallistujat voivat'));
  ok('while the first round says nothing', !!undrawnAlku && note(undrawnAlku) === '');
  Object.assign(alku800, saved800);

  // --- The round whose two copies of Status disagree ---
  // The Kuula's schedule row says Official and its results say Progress, as
  // a finished round's stale copy does (reconcileStatuses, lib/schedule.js).
  // Competition 20354 read so a day after it finished. A one-heat round is
  // one that resultPending mutes and qualPending never does.
  appJs.navigate('/c/demo#/a/b1-a');
  await settle();
  const kuula = [...D.querySelectorAll('.list a.row')].find((r) => r.textContent.includes('Kuula'));
  ok('Kuula row found', !!kuula);
  const chip = kuula?.querySelector('.chip')?.textContent;
  const kuulaPos = kuula?.querySelector('.watch-row-pos');
  log(
    `Kuula: chip "${chip}" position "${kuulaPos?.textContent}" ` +
      `pending=${kuulaPos?.classList.contains('watch-row-pos-pending')}`,
  );
  ok('the chip reads finished', chip === 'Tulokset valmiit');
  ok('Kuula shows 1/3', kuulaPos?.textContent === '1/3');
  // (Break on purpose: drop reconcileStatuses from eventStoreFor, and this
  // placing is muted beside a chip that says finished.)
  ok('and its placing is NOT muted, like the chip beside it', !kuulaPos?.classList.contains('watch-row-pos-pending'));

  // --- The event view: what a row says besides its name ---
  // An earlier round's mark and the bests measure no part of the round on
  // screen, so they are muted asides (athleteNameParts, app/event.js). The
  // nearest earlier mark rides on the name's line and the bests on the club
  // line.
  // Four starts cover a list from a finished round, one from a running
  // round, one with no earlier round, and a single-round final.
  const openStart = async (h, m, event) => {
    appJs.navigate(`/c/demo/g/${encodeURIComponent(groupKey(h, m, event))}`);
    await settle();
  };
  const table = () => D.querySelector('#app .tbl');
  const headCells = () => [...(table()?.querySelectorAll('thead th') || [])].map((th) => th.textContent.trim());
  const bodyRows = () => [...(table()?.querySelectorAll('tbody tr') || [])];
  const rowFor = (name) => bodyRows().find((r) => r.textContent.includes(name));
  // The mark on the name's line and the asides on the club line are read
  // apart, so an aside on the wrong line fails a check.
  const markOf = (name) => rowFor(name)?.querySelector('.prev-mark')?.textContent.trim();
  const asidesOf = (name) =>
    [...(rowFor(name)?.querySelectorAll('.name-aside') || [])].map(
      (s) => `${s.textContent.trim()}${s.classList.contains('name-aside-beaten') ? '!' : ''}`,
    );
  // The club line marks a beaten best by weight alone, so two sections read
  // the computed weight.
  const weight = (n) => (n ? D.defaultView.getComputedStyle(n).fontWeight : '');
  // Every mark check is an exact match, which pins the mark carrying nothing
  // else. A Q/q inside it would be worn by every row of a qualifier list.
  const anyBadge = () => !!D.querySelector('#app .cell-name .q-badge');
  const rowsLog = () =>
    bodyRows()
      .map((r) => r.querySelector('.cell-name')?.textContent.replace(/\s+/g, ' ').trim())
      .join(' / ');

  // The 800 m final is undrawn behind an Official Alkuerät, so its list is
  // that round's three qualifiers, each with a time and a badge.
  await openStart(10, 0, '800m');
  log(`800m final columns: ${headCells().join(' | ')}`);
  log(`800m final rows: ${rowsLog()}`);
  // (Break on purpose: drop the bestCols gate, and PB and SB stand as two
  // empty columns.)
  ok('with an earlier round to show, the bests stop being columns', headCells().join('|') === 'Nro|Nimi');
  ok('and it is the three qualifiers, not the whole field', bodyRows().length === 3);
  // (Break on purpose: render `a.PB` in place of the mark, and both fail, as
  // the 800 m runners carry no bests.)
  ok('the automatic qualifier carries his heat time, named by its round', markOf('Eetu Vauhtinen') === 'AE 1.52,10');
  ok('so does the fill-in', markOf('Otto Testinen') === 'AE 1.53,40');
  // (Break on purpose: add qualBadgeEl to the prev-mark span.) Every row here
  // qualified, so a Q/q on each says nothing and costs a phone row its width.
  ok('and no row wears the badge that got it here, since they all would', !anyBadge());
  ok('and the one who missed the cut is not in the list at all', !rowFor('Veeti Harjoitinen'));

  // The 200 m final is undrawn behind a Välierät still in Progress, so it
  // lists that round's whole field, the unrun heat included. A runner through
  // both earlier rounds shows the later one alone.
  await openStart(10, 15, '200m');
  log(`200m final rows: ${rowsLog()}`);
  ok('the whole field is listed, unfinished round and all', bodyRows().length === 6);
  ok('the last round is the one on the name line', markOf('Elina Vauhtinen') === 'VE 25,00');
  // (Break on purpose: add the older rounds to the club line, and her
  // Alkuerät 25,10 joins the bests there.) She is the one runner here with
  // bests, so the check tells a dropped round from an empty line.
  ok('and the round before it is not shown at all', asidesOf('Elina Vauhtinen').join() === 'PB&SB 24,88');
  // Milla's Välierät heat is unrun, so her mark comes from the nearest round
  // she has one in. (Break on purpose: let a resultless allocation into
  // earlierMarks, and she gets an empty "VE".)
  ok(
    'a runner whose latest heat has not been run falls back to the round that has',
    markOf('Milla Kokeinen') === 'AE 25,05' && asidesOf('Milla Kokeinen').length === 0,
  );
  // Sara's standing Välierät q is not here either, as the mark is the whole
  // aside in both states.
  ok("nor does the unfinished round's own standing q come along", !anyBadge());

  // The sheet behind the name holds what the row has no width for
  // (openAthleteSheet, app/follow.js). It lists every earlier round by its
  // full name, with the club and the bib, and it costs no fetch.
  rowFor('Elina Vauhtinen').querySelector('.cell-name a.athlete-link').click();
  await settle();
  // The two cells are read apart, as the gap between them is layout and the
  // cell a value lands in is half the check.
  const sheetMarks = [...D.querySelectorAll('.sheet .athlete-mark')].map(
    (m) =>
      `${m.querySelector('.athlete-mark-round').textContent.trim()} ` +
      m.querySelector('.athlete-mark-result').textContent.trim(),
  );
  log(
    `athlete sheet: "${D.querySelector('.sheet .sheet-title')?.textContent}" / ` +
      `"${D.querySelector('.sheet .sheet-hint')?.textContent}" / ${sheetMarks.join(' | ')}`,
  );
  // (Break on purpose: hand athleteCard the row's `prev` alone and not
  // nameAside's `marks`, and the sheet says only what the row said.)
  ok(
    'the sheet carries both earlier rounds, nearest first and named in full',
    sheetMarks.join(' / ') === 'Välierät 25,00 / Alkuerät 25,10',
  );
  ok(
    '...under the name, with the club spelled out and the bib beside it',
    D.querySelector('.sheet .sheet-title').textContent === 'Elina Vauhtinen' &&
      D.querySelector('.sheet .sheet-hint').textContent === 'Demon Urheilijat · Nro 61',
  );
  // The bests are on the row already, as asides or as columns, so the sheet
  // adds none.
  ok('and no bests of its own', !D.querySelector('.sheet .name-aside'));
  ok('the row underneath still shows the last round alone', markOf('Elina Vauhtinen') === 'VE 25,00');
  D.querySelector('.sheet-close').click();
  await settle();
  ok(
    'and the sheet closes off the same start it was opened over',
    !D.querySelector('.sheet') && !!rowFor('Elina Vauhtinen'),
  );

  // Keihäs has no rounds, so its list is the raw Enrollments and the bests
  // stay columns. The leading blank column is the varmistus tick, which an
  // entry list reserves in a meet that confirms (enrollmentTable,
  // app/event.js).
  await openStart(15, 0, 'Keihäs');
  log(`Keihäs columns: ${headCells().join(' | ')}`);
  ok(
    'with nothing earlier, the bests are still columns',
    headCells().join('|') === '|Nro|Nimi|PB|SB' && bodyRows().length > 0,
  );
  ok('and no row claims a previous mark', !D.querySelector('#app .prev-mark'));

  // The 100 m has one finished round, so its bests are context to a result.
  // They sit on the club line, in the four shapes the fixture carries.
  await openStart(12, 0, '100m');
  log(`100m rows: ${rowsLog()}`);
  ok('a finished single-round final has no bests columns either', headCells().join('|') === 'Sija|Nro|Nimi|Tulos');
  ok('two bests that agree collapse to one label', asidesOf('Ville Mallinen').join() === 'PB&SB 11,20');
  ok('two that differ print as two', asidesOf('Aleksi Testinen').join() === 'PB 10,98,SB 11,05');
  // (Break on purpose: flip the track comparison in beatsMark, and the PB is
  // marked where the SB should be.)
  ok(
    "a season's best this run passed stops being muted, and the PB it did not reach stays",
    asidesOf('Kasperi Kokeinen').join() === 'PB 11,30,SB 11,62!',
  );
  // The check above reads the class, and this one reads its weight. On the
  // club line weight means "this result passed it" and nothing else.
  const kasperi = rowFor('Kasperi Kokeinen');
  log(
    `Kasperi asides: ${[...kasperi.querySelectorAll('.name-aside')].map((n) => `${n.textContent.trim()}=${weight(n)}`).join(' | ')}`,
  );
  ok(
    'and the un-muted one is the only weight on that line',
    weight(kasperi.querySelector('.name-aside-beaten')) === '600' &&
      weight(kasperi.querySelector('.name-aside:not(.name-aside-beaten)')) === '400',
  );
  ok('a row with no bests at all says nothing', asidesOf('Guest Runner').length === 0);
  ok('and none of them is a previous round', !D.querySelector('#app .prev-mark'));

  // --- The wind, which decides whether a beaten best may un-mute ---
  // A best is wind-legal, so a mark run in more than +2,0 stays muted
  // (beatsMark and windAided, lib/results.js).
  // These rows span several heats and tables, so the section reads the whole
  // view.
  const anyRow = (name) =>
    [...D.querySelectorAll('#app tbody tr, #app .ladder-card')].find((r) => r.textContent.includes(name));
  const asidesAnywhere = (name) =>
    [...(anyRow(name)?.querySelectorAll('.name-aside') || [])].map(
      (s) => `${s.textContent.trim()}${s.classList.contains('name-aside-beaten') ? '!' : ''}`,
    );

  // The 100 m Alkuerät has run heats at +1,5, +2,0 and +2,4, each with a row
  // past its SB. The three winds are legal, at the limit and aided.
  await openStart(9, 45, '100m');
  log(`100m Alkuerät winds: ${[...D.querySelectorAll('#app .wind')].map((w) => w.textContent.trim()).join(' | ')}`);
  log(
    `Emilia ${asidesAnywhere('Emilia Testinen')} / Peppi ${asidesAnywhere('Peppi Harjoitinen')} ` +
      `/ Ella ${asidesAnywhere('Ella Demoinen')}`,
  );
  ok(
    'the three run heats print their readings',
    [...D.querySelectorAll('#app .wind')].map((w) => w.textContent.trim()).join('|') ===
      'tuuli +1,5|tuuli +2,0|tuuli +2,4',
  );
  ok(
    "a legal wind un-mutes the season's best that fell",
    asidesAnywhere('Emilia Testinen').join() === 'PB 12,44,SB 12,50!',
  );
  // (Break on purpose: make windAided use >=, and this one stays muted.)
  ok(
    'and so does exactly +2,0, which is the limit and inside it',
    asidesAnywhere('Peppi Harjoitinen').join() === 'PB 12,52,SB 12,60!',
  );
  // (Break on purpose: drop the wind argument in nameAside, and this row
  // un-mutes like the two above.)
  ok(
    'but +2,4 leaves both muted, 12,19 past a 12,22 SB and all',
    asidesAnywhere('Ella Demoinen').join() === 'PB 12,15,SB 12,22',
  );

  // The Pituus final has no heat-level wind, so two rows of one heat differ
  // by the wind of the attempt each Result came from (resultWind,
  // lib/results.js).
  await openStart(13, 0, 'Pituus');
  log(`Katri ${asidesAnywhere('Katri Testinen')} / Silvia ${asidesAnywhere('Silvia Kokeinen')}`);
  ok("a legal jump past a season's best un-mutes it", asidesAnywhere('Katri Testinen').join() === 'PB 4.95,SB 4.88!');
  ok('and a +2,3 one does not, though it passed both', asidesAnywhere('Silvia Kokeinen').join() === 'PB&SB 5.55');

  // --- The unit, which decides the same on a field mark ---
  // Korkeus is the fixture's wrong-unit start, centimetre results against
  // metre bests (docs/tuloslista-api.md, "Field events"). A vertical jump has
  // no wind, so these rows test the unit alone. 190 passed 1,88 m, and 195
  // passed neither 1,98 m nor its 1,95 m SB.
  await openStart(13, 30, 'Korkeus');
  log(`Joel ${asidesAnywhere('Joel Esimerkkinen')} / Veikko ${asidesAnywhere('Veikko Mittainen')}`);
  // (Break on purpose: make fieldMark read every string as one unit, and
  // Joel's two un-mute as well on 195 > 1.98.)
  ok(
    'a metre best is un-muted by the centimetre result that passed it',
    asidesAnywhere('Veikko Mittainen').join() === 'PB&SB 1.88!',
  );
  ok('and not by the one that did not', asidesAnywhere('Joel Esimerkkinen').join() === 'PB 1.98,SB 1.95');

  // The unit is also what the row prints (markFormat, lib/results.js).
  // (Break on purpose: return the mark unconverted from verticalMarkText, and
  // the result reads "190".)
  const resultOf = (name) => anyRow(name)?.querySelector('.result')?.textContent.trim();
  log(`Veikko result "${resultOf('Veikko Mittainen')}" / Aada "${resultOf('Aada Harjoitinen')}"`);
  ok('the result is metres where the API said centimetres', resultOf('Veikko Mittainen') === '1.90');
  ok('and a bar the jumper never cleared is still the code it came as', resultOf('Aada Harjoitinen') === 'NH');

  // The bests take the same conversion. The fixture's bests are in metres,
  // so formatted and raw read alike. The centimetre spelling is set here and
  // not in demo.js, where a start with one of each is a shape nobody measured.
  // (Break on purpose: hand nameAside PLAIN_MARK, and this reads "PB&SB 188".)
  const setBests = (v) => {
    for (const a of demoJs.DEMO_EVENTS.e4.Rounds[0].Heats[0].Allocations) {
      if (a.Result === '190') Object.assign(a, { PB: v, SB: v });
    }
  };
  setBests('188');
  await appJs.render(true);
  await settle();
  log(`Veikko, bests in centimetres: ${asidesAnywhere('Veikko Mittainen')}`);
  ok(
    'a centimetre best is drawn in the metres the result beside it is in',
    asidesAnywhere('Veikko Mittainen').join() === 'PB&SB 1.88!',
  );
  setBests('1.88');

  // --- The same club line on a followed athlete's row ---
  // A followed row (rowClass, app/event.js) is tinted, and only its name's
  // line is bold. The club line's one weight is the beaten best, so a bold
  // cell reads as a PB on every followed row. The quick-filter goes back to
  // the 200 m runner with bests before her start is reopened.
  appJs.navigate('/c/demo#/a/i1-a');
  await settle();
  await openStart(10, 15, '200m');
  const mine = rowFor('Elina Vauhtinen');
  const theirs = rowFor('Sara Testinen');
  log(
    `Elina: watched=${mine?.classList.contains('watched')} name=${weight(mine?.querySelector('.name-main'))} ` +
      `aside=${weight(mine?.querySelector('.name-aside'))} / Sara: name=${weight(theirs?.querySelector('.name-main'))}`,
  );
  ok("the quick-filter's own athlete is the followed row", !!mine?.classList.contains('watched'));
  ok(
    'her name is bold where an unfollowed one is not',
    weight(mine?.querySelector('.name-main')) === '700' && weight(theirs?.querySelector('.name-main')) === '400',
  );
  // (Break on purpose: move the 700 to `tr.watched .cell-name` in index.html,
  // and this aside reads 700 while every check above passes.)
  ok(
    "but her PB&SB is drawn exactly as everyone else's",
    weight(mine?.querySelector('.name-aside')) === '400' && asidesOf('Elina Vauhtinen').join() === 'PB&SB 24,88',
  );
}
