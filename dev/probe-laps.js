// Checks the lap counter (docs/lap-counter.md) on the demo's races.
// Nothing on it moves unless the referee touches it, and a count in progress
// is stored under `laps:<compId>:<groupKey>` (docs/juoksut.md).
//   dev/probe.html?probe=probe-laps&url=%3Fmode%3Djuoksut
import { defaultTrack } from '/lib/lap-counter.js';

export default async function probe({ frame, W, ok, wait, groupKey, appJs }) {
  // A full navigation replaces contentDocument, so this reads it afresh. The
  // runner's own `D` would point at the detached one.
  const doc = () => frame.contentDocument;
  const app = () => doc().getElementById('app');
  const appText = () => app().textContent;

  const K800 = groupKey(9, 0, '800m');
  const KRELAY = groupKey(14, 0, '4x100m viesti');

  const go = async (hash, ms = 1200) => {
    appJs.navigate(hash);
    await wait(ms);
  };
  const counterLink = () =>
    [...app().querySelectorAll('a.btn')].find((a) => /Kierroslaskuri|Maaliintulot/.test(a.textContent));

  // The run starts clean, or a previous run's taps open a counted race.
  for (const k of Object.keys(W.localStorage)) {
    if (k.startsWith('laps:') || k.startsWith('track:')) W.localStorage.removeItem(k);
  }
  // The demo is dated today, so the season picks its track (defaultTrack). The
  // checks up to the track's own section count a 400 m track, and from October
  // to April they fail unless it is stored.
  W.localStorage.setItem('track:demo', JSON.stringify({ track: 400, t: Date.now() }));

  // --- The way in, and the two shapes of race ---
  await go(`/c/demo/g/${encodeURIComponent(K800)}`);
  const link = counterLink();
  ok('a distance race offers the counter', !!link);
  ok('...labelled as a lap counter', link?.textContent.includes('Kierroslaskuri'));
  ok(
    "...pointing at the start's own laps route",
    link?.getAttribute('href') === `/c/demo/g/${encodeURIComponent(K800)}/laps`,
  );

  await go(`/c/demo/g/${encodeURIComponent(KRELAY)}`);
  // 4 x 100 m is 400 m, so it is one crossing on a 400 m track and no laps.
  // The counter then records the finish order, and its link says so.
  ok('a one-crossing race offers finish recording instead', counterLink()?.textContent.includes('Maaliintulot'));
  // A field event never offers it at all, whatever the mode.
  await go(`/c/demo/g/${encodeURIComponent(groupKey(12, 0, 'Kuula'))}`);
  ok('a field event offers no counter', !counterLink());

  // --- The counter itself ---
  await go(`/c/demo/g/${encodeURIComponent(K800)}/laps`);
  ok('the laps route renders the counter', !!app().querySelector('.tile-grid'));
  ok('title names the start', doc().getElementById('title').textContent.includes('800m'));
  ok('both heats are offered', app().querySelectorAll('.heat-tabs .tab').length === 2);
  const tiles = () => [...app().querySelectorAll('.tile-grid .tile')];
  ok("heat 1's two runners get a tile each", tiles().length === 2);
  ok("the board opens on the race's own lap count", app().querySelector('.board .board-num')?.textContent === '2');
  ok('the start list is there before anything is tapped', appText().includes('Lähtölista'));
  ok('the counter explains itself behind the header ?', !doc().getElementById('help').hidden);

  // --- Counting a race ---
  const clock = () => doc().getElementById('lapclock');
  ok('the clock reads zero', clock()?.textContent === '0:00');
  clock().click();
  await wait(400);
  const first = tiles()[0];
  const bib = first.querySelector('.bib').textContent;
  first.click();
  await wait(400);
  ok('a tap counts a crossing', !!appText().match(/1\./));
  ok('...and the board follows the leader down', app().querySelector('.board .board-num')?.textContent === '1');

  // A second press straight after the first is a fumbled double tap. With one
  // crossing there is no measured pace, so the flat TAP_GUARD_MS (3 s)
  // applies. The tile shows the refusal, and nothing is recorded.
  tiles()
    .find((t) => t.querySelector('.bib').textContent === bib)
    .click();
  await wait(400);
  ok(
    'a press too soon to be a lap is refused',
    app().querySelector('.tile.rejected') != null && !appText().includes('2.'),
  );
  // Past the guard, the same press is a real crossing.
  await wait(3500);
  tiles()
    .find((t) => t.querySelector('.bib').textContent === bib)
    .click();
  await wait(400);
  const finished = tiles().find((t) => t.querySelector('.bib').textContent === bib);
  ok('the second crossing is the finish', finished.className.includes('finished'));
  ok('...and it is timed', /\d,\d/.test(finished.textContent));
  ok('...and the list turns into the standings', appText().includes('Tilanne'));

  // A count in progress is stored under this key (docs/juoksut.md).
  const key = `laps:demo:${K800}`;
  ok('the tap log is stored under laps:<compId>:<groupKey>', W.localStorage.getItem(key) != null);
  const stored = JSON.parse(W.localStorage.getItem(key));
  ok('...and holds the two crossings', Object.values(stored.heats)[0].events.length === 2);

  // --- Undo pops the last tap ---
  const heatKey = Object.keys(stored.heats)[0];
  [...app().querySelectorAll('button')].find((b) => b.textContent.includes('Kumoa')).click();
  await wait(400);
  ok('undo takes the last crossing back', JSON.parse(W.localStorage.getItem(key)).heats[heatKey].events.length === 1);
  ok('...and the runner is out on the track again', !app().querySelector('.tile.finished'));

  // --- Correcting the order the boxes were tapped in ---
  // test/lap-counter.test.mjs tests what a drag does to the tap log
  // (reorderCrossing). This checks that only rows that may move get a handle,
  // that a synthetic drag reaches the code a finger does, and that the
  // correction is stored.
  const listRows = () => [...app().querySelectorAll('.tbl tbody tr')];
  const grips = () => [...app().querySelectorAll('.tbl .grip')];
  const nros = () => listRows().map((tr) => tr.cells[1].textContent);
  // One runner is on one crossing and the other on none. Nobody has anybody
  // to change places with, so no row offers a handle.
  // (Break on purpose: drop the `j - i > 1` in reorderSpans,
  // lib/lap-counter.js.)
  ok('a lone runner on a count of their own has no handle', grips().length === 0);

  const second = tiles().find((t) => t.querySelector('.bib').textContent !== bib);
  second.click();
  await wait(400);
  ok('both runners on one crossing can be reordered', grips().length === 2);
  const wasFirst = nros()[0];
  const wasSecond = nros()[1];
  ok('...and the tapped order is the order shown', wasFirst === bib);

  // Drag the second row's handle up past the first. The move and the
  // release go to the window, which is where app/laps.js listens for them.
  const grip = grips()[1];
  const y = grip.getBoundingClientRect().top;
  const point = (type, clientY, target) =>
    target.dispatchEvent(new W.PointerEvent(type, { clientY, bubbles: true, button: 0, pointerId: 1 }));
  point('pointerdown', y, grip);
  point('pointermove', y - 60, W);
  ok('the dragged row follows the finger', listRows()[1].style.transform !== '');
  point('pointerup', y - 60, W);
  await wait(400);
  ok('the drag swapped the two places', nros()[0] === wasSecond && nros()[1] === wasFirst);
  const logged = () => JSON.parse(W.localStorage.getItem(key)).heats[heatKey].events;
  ok(
    '...as an entry of its own in the tap log, not a rewrite',
    logged().length === 3 && Array.isArray(logged().at(-1).order) && logged().at(-1).n === 1,
  );

  // Undo takes the correction back like any other entry.
  [...app().querySelectorAll('button')].find((b) => b.textContent.includes('Kumoa')).click();
  await wait(400);
  ok('undo takes the correction back', nros()[0] === wasFirst && logged().length === 2);

  // A keyboard makes the same correction on a machine that is not a phone.
  // (Break on purpose: drop the grip's onkeydown.)
  grips()[1].focus();
  grips()[1].dispatchEvent(new W.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  await wait(300);
  ok('an arrow key makes the same correction', nros()[0] === wasSecond);
  ok(
    '...and the focus follows the competitor, not the place',
    doc().activeElement?.dataset?.id === grips()[0].dataset.id,
  );
  [...app().querySelectorAll('button')].find((b) => b.textContent.includes('Kumoa')).click();
  await wait(400);
  ok('...and it comes back the same way', nros()[0] === wasFirst && logged().length === 2);

  // A drag too short to reach another place still ends in a click on a row
  // whose tap opens the mark sheet. Synthetic pointer events bring no click,
  // so this dispatches the one a finger would.
  // (Break on purpose: drop the click listener in endRowDrag, app/laps.js.)
  const stay = grips()[0];
  const y0 = stay.getBoundingClientRect().top;
  point('pointerdown', y0, stay);
  point('pointermove', y0 + 8, W);
  point('pointerup', y0 + 8, W);
  stay.dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
  await wait(300);
  ok('a drag too short to move anything opens no mark sheet', !doc().querySelector('.sheet'));
  ok('...and leaves the order alone', nros()[0] === wasFirst && logged().length === 2);
  // Nothing was corrected, so nothing re-rendered, and these are the rows the
  // drag moved. They must be back where the layout has them.
  // (Break on purpose: drop the transform reset in clearRowDrag,
  // app/laps.js.)
  ok(
    '...and puts the rows it moved back',
    listRows().every((tr) => !tr.style.transform),
  );

  // --- A pack that went by faster than one person could tap it ---
  // The demo's 3000 m puts two classes in one shared heat
  // (docs/lap-counter.md, "Recording a pack"). A seeded tap log makes the
  // field overdue, and this checks the chip, the sheet and the one press.
  // test/lap-counter.test.mjs tests packCrossings.
  const K3000 = groupKey(14, 30, '3000m');
  const store3000 = `laps:demo:${K3000}`;
  // Heat 1 of the 3000 m holds both classes' runners, merged by lane.
  const seedHeat = async (build) => {
    await go(`/c/demo/g/${encodeURIComponent(K3000)}/laps`);
    const snap = JSON.parse(W.localStorage.getItem(store3000));
    const heat = snap.roster.heats[0];
    snap.heats[String(heat.index)] = build(heat.rows.map((r) => r.id));
    W.localStorage.setItem(store3000, JSON.stringify(snap));
    // The view is left and entered again, so it is built from the new log.
    await go('/c/demo');
    await go(`/c/demo/g/${encodeURIComponent(K3000)}/laps`);
    return { heat, key: String(heat.index) };
  };
  {
    const now = Date.now();
    const lap = 70_000;
    const startTs = now - 400_000;
    let ids = [];
    // Everyone crossed four times at a steady 70 s. A 3000 m on a 400 m track
    // opens with 200 m, so the first crossing is half a lap in.
    const { heat, key: hKey } = await seedHeat((rowIds) => {
      ids = rowIds;
      const events = [];
      for (let n = 1; n <= 4; n += 1) {
        for (const id of ids) events.push({ id, t: startTs + 35_000 + (n - 1) * lap });
      }
      // On the fifth lap only the leader and the tail were tapped, twenty-odd
      // seconds ago. Those two presses bracket the pack.
      events.push({ id: ids[0], t: now - 25_000 });
      events.push({ id: ids.at(-1), t: now - 20_000 });
      return { startTs, startTs0: startTs, events, done: {} };
    });
    ok('the 3000 m heat is a field of seven', heat.rows.length === 7);
    // The prompt tick draws the chip, so it appears when applyLive first runs
    // and not the instant the view is built.
    await wait(600);
    const chip = () => app().querySelector('.chip-pack');
    ok(
      'the pack chip counts what is still missing',
      chip() != null && !chip().hidden && /5 kirjaamatta/.test(chip().textContent),
    );
    // The two that were tapped are not in it. Only being overdue tells a
    // missed press from a runner who has been lapped.
    // (Break on purpose: count every row behind the leader in missingIn,
    // app/laps.js, instead of the overdue ones.)
    ok('...and not the two that were', !/7 kirjaamatta/.test(chip().textContent));

    chip().click();
    await wait(400);
    const sheet = () => doc().querySelector('.sheet');
    ok('it opens a sheet naming them', sheet() != null && sheet().querySelectorAll('.pick-row').length === 5);
    ok(
      '...every one ticked, since the operator watched them go by',
      [...sheet().querySelectorAll('.pick-row')].every((r) => r.className.includes('on')),
    );
    ok('...saying how long each has been missing', /myöhässä/.test(sheet().querySelector('.pick-note').textContent));
    // Someone who stepped off the track is in the list too, and unticking
    // them is the only way to tell the app.
    // (Break on purpose: make packSheet's own button pass every row's id.)
    const dropped = sheet().querySelectorAll('.pick-row')[0];
    const droppedNro = dropped.querySelector('.pick-num').textContent;
    dropped.click();
    await wait(200);
    const record = [...sheet().querySelectorAll('button')].find((b) => /Kirjaa \d+ ylitystä/.test(b.textContent));
    ok('...and the button counts what is actually ticked', /Kirjaa 4/.test(record.textContent));
    record.click();
    await wait(500);

    const log = () => JSON.parse(W.localStorage.getItem(store3000)).heats[hKey].events;
    const packEv = log().at(-1);
    ok('one press appends one entry holding the whole pack', Array.isArray(packEv.pack) && packEv.pack.length === 4);
    ok(
      '...every crossing in it marked an estimate',
      packEv.pack.every((c) => c.est),
    );
    // packCrossings puts the times between the two presses made, in the order
    // the runners stood. This checks that the view gave it the right heat and
    // the right ids.
    ok(
      '...inside the window the pack was seen in',
      packEv.pack.every((c) => c.t >= now - 25_000 && c.t <= now - 20_000),
    );
    const droppedId = ids.find((id) => `#${heat.rows.find((r) => r.id === id).bib}` === droppedNro);
    ok('...and the one unticked got nothing', droppedId != null && !packEv.pack.some((c) => c.id === droppedId));
    // Four of the five are on five crossings now, so the chip is down to
    // the one that was left out.
    await wait(600);
    ok('the chip is down to what is left', /1 kirjaamatta/.test(chip().textContent));

    // One undo takes the whole pack back, exactly as it takes back a tap.
    // (Break on purpose: append the crossings individually in recordPack.)
    [...app().querySelectorAll('button')].find((b) => b.textContent.includes('Kumoa')).click();
    await wait(500);
    ok('undo takes the whole pack back', log().length === 30);
    await wait(600);
    ok('...and the chip is back to five', /5 kirjaamatta/.test(chip().textContent));
  }

  // --- Who has been lapped ---
  // The crossing count alone steps up when the leader crosses, before the
  // runner behind reaches the line (lapsBehind, lib/lap-counter.js). The
  // table marks a whole lap down, so a gap of two crossings reads as a lap,
  // not a mis-count.
  {
    const now = Date.now();
    let slow = null;
    // Six runners are a tenth of a lap past the line on 70 s laps. One runs
    // 90 s laps and is two crossings down, which is a whole lap and a bit.
    // The counts on their own would read two.
    const { heat } = await seedHeat((ids) => {
      slow = ids.at(-1);
      const events = [];
      for (const id of ids) {
        const [lap, laps, last] = id === slow ? [90_000, 4, 40_000] : [70_000, 6, 10_000];
        for (let k = laps - 1; k >= 0; k -= 1) events.push({ id, t: now - last - k * lap });
      }
      const startTs = now - 500_000;
      return { startTs, startTs0: startTs, events, done: {} };
    });
    await wait(400);
    const marks = [...app().querySelectorAll('.tbl .laps-down')];
    // (Break on purpose: use p.count alone as the progress in lapsBehind,
    // lib/lap-counter.js, and the lapped runner reads two laps down.)
    ok('the lapped runner is marked as a lap down', marks.length === 1);
    ok('...saying how many laps it is', /1 kier\./.test(marks[0]?.textContent || ''));
    ok(
      "...on their own row and nobody else's",
      marks[0]?.closest('tr')?.textContent.includes(heat.rows.find((r) => r.id === slow).name),
    );
  }

  // --- The next-up band ---
  // A slot is held until its crossing is recorded (bandSlots,
  // lib/lap-counter.js). The 3000 m above has seven runners and gets no band.
  // The 3x600 m relay has 11 teams in one heat (docs/lap-counter.md, "The
  // changeover"), and its slots survive a press's re-render.
  const KRELAY3 = groupKey(17, 30, '3x600m viesti');
  ok('a small field gets no band, and keeps the row of tiles', !app().querySelector('.band'));
  {
    const now = Date.now();
    await go(`/c/demo/g/${encodeURIComponent(KRELAY3)}/laps`);
    const store = `laps:demo:${KRELAY3}`;
    const snap0 = JSON.parse(W.localStorage.getItem(store));
    const rows = snap0.roster.heats[0].rows;
    ok('the relay heat is eleven teams', rows.length === 11);
    const slots = () => [...app().querySelectorAll('.band .band-slot')];
    ok('a field over eight gets one', slots().length === 3);
    // The band is empty and inert before the race.
    ok(
      '...standing empty before anybody is near',
      slots().every((s) => s.className.includes('empty') && s.disabled),
    );
    const emptyH = Math.round(app().querySelector('.band').getBoundingClientRect().height);

    // Two laps in, on 60 s laps, the teams are three seconds apart. The leader
    // is 50 m from the line and each team 20 m further back, so the first six
    // are inside the band's 150 m and the rest are not.
    const lap = 60_000;
    const startTs = now - 200_000;
    const events = [];
    rows.forEach((r, i) => {
      const second = now - 52_500 + i * 3_000;
      events.push({ id: r.id, t: second - lap });
      events.push({ id: r.id, t: second });
    });
    snap0.heats[String(snap0.roster.heats[0].index)] = {
      startTs,
      startTs0: startTs,
      events,
      done: {},
    };
    W.localStorage.setItem(store, JSON.stringify(snap0));
    await go('/c/demo');
    await go(`/c/demo/g/${encodeURIComponent(KRELAY3)}/laps`);
    await wait(600);
    const who = (s) => s.querySelector('.band-who').textContent;
    const filled = slots().filter((s) => !s.className.includes('empty'));
    ok('it fills as the field comes round', filled.length === 3);
    // Six are in reach of three slots, so the three nearest get them. The rest
    // are on the grid, which still pulses at them.
    // (Break on purpose: sort bandQueue the other way round.)
    ok(
      '...nearest first, leftmost first',
      slots().map(who).join() ===
        rows
          .slice(0, 3)
          .map((r) => `#${r.bib}`)
          .join(),
    );
    // The band is as tall full as empty, or the grid drops by a row's height
    // as the first team comes into range, under a finger on its way to a tile.
    // (Break on purpose: drop min-height from both .band-slot and .band.dense
    // .band-slot, since an eleven-team heat is drawn dense.)
    ok(
      '...without the band having grown',
      Math.round(app().querySelector('.band').getBoundingClientRect().height) === emptyH,
    );
    ok(
      '...saying what to call and how long',
      /\S/.test(slots()[0].querySelector('.band-call').textContent) &&
        /s|nyt|myöhässä/.test(slots()[0].querySelector('.band-away').textContent),
    );
    ok(
      'an empty slot is not a button',
      slots().every((s) => !s.className.includes('empty') || s.disabled),
    );

    // A slot's press works like a tile's, and the slot's own flash confirms it.
    const firstWho = who(slots()[0]);
    const held = slots().slice(1).map(who);
    const before = JSON.parse(W.localStorage.getItem(store)).heats[String(snap0.roster.heats[0].index)].events.length;
    slots()[0].click();
    await wait(300);
    const after = JSON.parse(W.localStorage.getItem(store)).heats[String(snap0.roster.heats[0].index)].events;
    ok('a band slot records a crossing like a tile', after.length === before + 1);
    ok('...for the team that was in it', after.at(-1).id === rows.find((r) => `#${r.bib}` === firstWho).id);

    // Only the view can get this wrong. A press re-renders the whole counter,
    // and the other slots must stay exactly where they were, or every tap
    // re-ranks the band.
    // (Break on purpose: move `const band = …` inside body(), app/laps.js.)
    ok('...and the slots either side did not move', slots().slice(1).map(who).join() === held.join());
    // The pressed slot stays empty for a moment, so the second half of a
    // fumbled double press records nobody.
    // (Break on purpose: drop the freeAt hold in bandSlots,
    // lib/lap-counter.js.)
    ok(
      '...and the slot it emptied is dead for a moment',
      slots()[0].className.includes('empty') && slots()[0].disabled,
    );
  }

  // --- Leaving, and coming back ---
  await go(`/c/demo/g/${encodeURIComponent(K800)}`);
  ok('back on the event view', !!app().querySelector('.tbl'));

  // --- Nothing on the counter moves on its own ---
  // The interval spy is armed before the navigation, since scheduleRefresh
  // runs as the route changes. Only the prompt tick may appear. A tile's
  // identity catches a re-render however it was scheduled.
  const seen = [];
  let phase = 'leaving';
  const realInterval = W.setInterval;
  W.setInterval = function spy(fn, ms, ...rest) {
    seen.push({ phase, ms });
    return realInterval.call(W, fn, ms, ...rest);
  };
  phase = 'laps';
  await go(`/c/demo/g/${encodeURIComponent(K800)}/laps`);
  ok('the count survived leaving and returning', app().textContent.includes('Tilanne'));
  const marked = tiles()[0];
  marked.dataset.probeMark = '1';
  // The wait outlasts the event view's refresh (GROUP_REFRESH_MS).
  await wait(30_000);
  ok('no tile was rebuilt under the finger', tiles()[0]?.dataset.probeMark === '1');
  ok('the clock is still ticking on its own node', /^\d+:\d\d$/.test(clock().textContent));
  ok('no refresh timer was installed for the counter', !seen.some((s) => s.phase === 'laps' && s.ms >= 1000));
  ok(
    '...and the prompt tick was',
    seen.some((s) => s.phase === 'laps' && s.ms < 1000),
  );
  W.setInterval = realInterval;

  // --- Everyone home or out ---
  // A competitor out of the race counts as done, so a DNF lets the list
  // turn into the finish order. The stored count is put back afterwards.
  {
    const saved = W.localStorage.getItem(key);
    const s = JSON.parse(saved);
    const [a, b] = s.roster.heats.find((h) => h.index === s.activeHeat).rows;
    const t0 = Date.now() - 300_000;
    s.heats[s.activeHeat] = {
      startTs: t0,
      events: [
        { id: a.id, t: t0 + 60_000 },
        { id: a.id, t: t0 + 120_000 },
      ],
      done: { [b.id]: 'DNF' },
    };
    W.localStorage.setItem(key, JSON.stringify(s));
    await go('/c/demo');
    await go(`/c/demo/g/${encodeURIComponent(K800)}/laps`);
    const headings = [...app().querySelectorAll('h2')].map((h) => h.textContent);
    ok('one home and one DNF is the finish order', headings.includes('Maaliintulojärjestys'));
    ok('...with no next-call column', !app().querySelector('.tbl th.next'));
    W.localStorage.setItem(key, saved);
  }

  // --- The meet's track (docs/lap-counter.md) ---
  // The schedule view sets the track for every start of the meet, and the
  // counter reads it without offering it. An 800 m is two crossings of a
  // 400 m track and four of a hall's 200 m one.
  W.localStorage.removeItem('track:demo');
  await go(`/c/demo`);
  const trackSel = () => app().querySelector('.track-pick select');
  ok("the schedule view offers the meet's track", !!trackSel());
  ok("...defaulting to the season's own", trackSel().value === String(defaultTrack(new Date())));
  trackSel().value = '200';
  trackSel().dispatchEvent(new W.Event('change'));
  await wait(300);
  ok(
    "...stored per competition, under juoksut's own key",
    JSON.parse(W.localStorage.getItem('track:demo') || '{}').track === 200,
  );
  await go(`/c/demo/g/${encodeURIComponent(K800)}/laps`);
  // The leader has one crossing logged, so the board reads 4 − 1 in a hall
  // where it read 2 − 1 outdoors.
  ok("the counter counts the hall's laps instead", app().querySelector('.board .board-num')?.textContent === '3');
  // Put it back, so a probe run leaves the device as it found it.
  await go('/c/demo');
  trackSel().value = '400';
  trackSel().dispatchEvent(new W.Event('change'));
  await wait(300);

  // --- The mode gate ---
  // The mode is read once at boot from the query string, so this reloads.
  // Kisat mode on a dev host has no other origin to send a counter URL to, so
  // it lands on home. Production sends it to the Juoksut host (renderRoute,
  // app.js).
  W.location.replace('/');
  await wait(1800);
  appJs.navigate('/c/demo');
  await wait(1200);
  // The track setting sits on the filter bar, and in this mode the bar is the
  // follow-list's row with nothing in the setting's place.
  ok('Kisat mode offers no track setting', !app().querySelector('.track-pick'));
  appJs.navigate(`/c/demo/g/${encodeURIComponent(K800)}`);
  await wait(1800);
  ok('Kisat mode offers no counter on a start', !counterLink());
  appJs.navigate(`/c/demo/g/${encodeURIComponent(K800)}/laps`);
  await wait(1800);
  ok('...and a counter URL does not render one', !app().querySelector('.tile-grid'));
  ok('...it lands on home instead', frame.contentWindow.location.pathname === '/');
}
