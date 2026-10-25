// Checks the class and discipline filter on the demo with no follow-list
// (docs/views.md, "The day list"). It covers the folded
// line, its chips and count lines, a start's badges ticking the same choice,
// and the choice holding there and back.
//   dev/probe.html?probe=probe-filter&url=c/demo
export default async function probe({ D, W, log, ok, wait, groupKey, appJs, settle }) {
  W.localStorage.removeItem('kisatCompView');
  W.localStorage.removeItem('kisatFollow');
  appJs.navigate('/c/demo');
  await settle();

  const box = () => D.querySelector('#app details.day-filter');
  const summary = () => box()?.querySelector('summary').textContent.trim();
  const rows = () => [...D.querySelectorAll('#app .list a.row[href*="/g/"]')];
  const titles = () => rows().map((r) => r.querySelector('.row-title').textContent.trim());
  const chip = (text) => [...box().querySelectorAll('button.chip-toggle')].find((b) => b.textContent.trim() === text);
  // Finds the multi-event section's fold (renderComp) by its summary.
  const otteluBox = () =>
    [...D.querySelectorAll('#app > details > summary')].find((h) => h.textContent.trim() === 'Ottelut')?.parentElement;
  const tap = async (node) => {
    node.click();
    await settle();
  };

  const whole = rows().length;
  log(`summary: ${summary()} · rows: ${whole}`);
  ok('one folded line, naming no choice', !!box() && !box().open && summary() === 'Sarjat ja lajit');
  ok('the line fits the phone', box().getBoundingClientRect().right <= W.innerWidth);

  // (Break on purpose: give .round-dot `white-space: pre`, and a broken title
  // keeps its dot at the end of the first line.)
  const dots = [...D.querySelectorAll('#app .row-title .round-dot')].map((d) => ({
    width: d.getBoundingClientRect().width,
    broken: d.nextElementSibling.getBoundingClientRect().top > d.parentElement.getBoundingClientRect().top + 5,
  }));
  log(`round dots: ${dots.filter((d) => d.broken).length} broken of ${dots.length}`);
  ok('a title on one line has its dot', dots.some((d) => !d.broken) && dots.every((d) => d.broken || d.width > 0));
  ok(
    'a title broken before its round has none',
    dots.some((d) => d.broken) && dots.every((d) => !d.broken || d.width === 0),
  );

  box().querySelector('summary').click();
  await wait(100);
  await tap(chip('13'));
  log(`13: ${summary()} · ${titles().join(' | ')}`);
  ok('the box stays open over the re-render', box().open);
  ok('the line names the class', summary() === 'Sarjat ja lajit: 13');
  // (Break on purpose: group the whole day's rows in renderComp, and the 60m
  // row lists all four classes.)
  const sprint = rows().find((r) => /^60m/.test(r.querySelector('.row-title').textContent));
  ok('a start lists the chosen classes alone', sprint?.querySelector('.row-sub')?.textContent.trim() === 'P13, T13');
  ok('and fewer starts than the day has', rows().length > 0 && rows().length < whole);
  ok(
    'no chip spills past the phone',
    [...box().querySelectorAll('button')].every((b) => b.getBoundingClientRect().right <= W.innerWidth),
  );

  // On a start the badges carry the same choice, and the sections follow it.
  appJs.navigate(`/c/demo/g/${encodeURIComponent(groupKey(10, 45, '60m'))}`);
  await settle();
  const badges = () => [...D.querySelectorAll('#app .cat-badges .cat-badge')];
  const pressed = () =>
    badges()
      .filter((b) => b.getAttribute('aria-pressed') === 'true')
      .map((b) => b.textContent.trim());
  const heads = () =>
    [...D.querySelectorAll('#app h3')].map((h) => h.textContent.trim().split(' ')[0]).filter((t) => t !== 'Erä');
  log(`start: pressed ${pressed().join(',')} · sections ${[...new Set(heads())].join(',')}`);
  ok('every class keeps its badge', badges().length === 4);
  ok("the day's choice is ticked", pressed().join(',') === 'P13,T13');
  ok('and its sections alone are drawn', [...new Set(heads())].join(',') === 'P13,T13');
  await tap(badges().find((b) => b.textContent.trim() === 'T11'));
  ok('a badge adds its class', [...new Set(heads())].join(',') === 'P11,T11,P13,T13');

  // A start of other classes is not an empty page.
  appJs.navigate(`/c/demo/g/${encodeURIComponent(groupKey(13, 30, 'Kolmiloikka'))}`);
  await settle();
  log(`Kolmiloikka: pressed ${pressed().join(',') || '-'} · sections ${[...new Set(heads())].join(',')}`);
  ok('a start the choice holds none of stays whole', pressed().length === 0 && new Set(heads()).size === 2);

  // Physical heats have no class to keep, so their half offers no tick.
  appJs.navigate(`/c/demo/g/${encodeURIComponent(groupKey(14, 30, '3000m'))}`);
  await settle();
  log(
    `3000m: ${badges()
      .map((b) => `${b.tagName} ${b.textContent.trim()}`)
      .join(', ')}`,
  );
  ok("the shared heats' badges are plain", badges().length === 3 && badges().every((b) => b.tagName === 'SPAN'));

  // Back on the day, the chips carry the badge's tick.
  appJs.navigate('/c/demo');
  await settle();
  log(`back: ${summary()}`);
  ok("the day reads the badge's tick", summary() === 'Sarjat ja lajit: 11, 13');
  ok('and is folded again', !box().open);

  // A multi-event's leg counts as its own discipline, and a discipline choice
  // drops the Ottelut section.
  box().querySelector('summary').click();
  await tap(chip('T/P'));
  ok('the lead ticks its row whole', summary() === 'Sarjat ja lajit: 9, 11, 13');
  await tap(chip('T/P'));
  ok('and unticks it', summary() === 'Sarjat ja lajit');
  ok('the Ottelut section is there', !!otteluBox());
  await tap(chip('Pituus'));
  log(`Pituus: ${summary()} · ${titles().join(' | ')}`);
  ok('long jump alone, the legs with it', titles().length === 4 && titles().every((t) => /Pituus/.test(t)));
  ok('no Ottelut section under a discipline', !otteluBox());
  await tap(chip('9'));
  await tap(chip('Kiekko'));
  log(`9 + Pituus, Kiekko: ${titles().join(' | ')}`);
  ok('both halves hold', titles().length === 2);
  await tap(chip('Pituus'));
  ok(
    'a choice that fits no start says so',
    [...D.querySelectorAll('#app .notice')].some(
      (n) => n.textContent.trim() === 'Ei valintoihin sopivia lähtöjä tänä päivänä.',
    ),
  );

  // The whole day offers the counts toggle, and a start already run gets no
  // count.
  await tap(chip('Kiekko'));
  await tap(chip('9'));
  const toggle = chip('Erät ja osallistujat');
  ok('the whole day offers it', !!toggle && toggle.getAttribute('aria-pressed') === 'false');
  const rowAt = (h, m, event) =>
    rows().find((r) => r.getAttribute('href').endsWith(encodeURIComponent(groupKey(h, m, event))));
  const subs = (r) => [...r.querySelectorAll('.row-sub:not(.row-sub-statuses)')].map((n) => n.textContent.trim());
  ok('and says nothing until it is on', subs(rowAt(15, 0, 'Kuula')).join('|') === 'P13, T13');
  await tap(toggle);
  log(
    `counts: ${rows()
      .map((r) => subs(r).join(' / '))
      .filter(Boolean)
      .join(' | ')}`,
  );
  // This start's classes differ in phase, so its class list is on the
  // statuses line (groupStatuses) and `subs` finds only a count line.
  // (Break on purpose: drop the startFinished filter in renderComp, and the
  // 400m aidat, run at 15.30, counts its two leftovers.)
  ok('a start already run is not counted', subs(rowAt(15, 30, '400m aidat')).length === 0);
  // (Break on purpose: sum each class's own Heats in startCounts, and the
  // 3000m claims 4 erää for its two races. The field total survives that
  // break, so the erät catch it.)
  ok(
    'a shared draw is counted once, its leftover beside it',
    subs(rowAt(14, 30, '3000m')).join('|') === '2 erää · 12 osallistujaa|M65: Ei ilmoittautuneita',
  );
  // Classes drawn apart get a line each, and the head drops its class list,
  // as the lines name the classes. (Break on purpose: drop `named` from
  // countRowLines, and 'P13, T13' shows above them too.)
  ok(
    'a line per class, and the head drops its list',
    subs(rowAt(15, 0, 'Kuula')).join('|') === 'P13: Ei ilmoittautuneita|T13: 3 ilmoittautunutta',
  );
  // Nobody has confirmed in the Kuula above, and somebody has here. (Break
  // on purpose: drop countLine's confirmed gate, and the Kuula's line above
  // reads 'T13: 0/3 varmistanutta'.)
  ok(
    'a start somebody has confirmed in counts those instead',
    subs(rowAt(14, 30, 'Korkeus')).join('|') === 'T13|1/4 varmistanutta',
  );
  ok(
    'a count line fits the phone',
    rows().every((r) =>
      [...r.querySelectorAll('.row-sub')].every((n) => n.getBoundingClientRect().right <= W.innerWidth),
    ),
  );
  await tap(chip('3000m'));
  ok(
    'a choice narrows what is counted with everything else',
    rows().length === 1 && subs(rows()[0]).join('|') === '2 erää · 12 osallistujaa|M65: Ei ilmoittautuneita',
  );
  await tap(chip('3000m'));
  await tap(chip('Erät ja osallistujat'));
  ok('and off again', subs(rowAt(15, 0, 'Kuula')).join('|') === 'P13, T13');

  W.localStorage.removeItem('kisatCompView');
}
