// Checks the hurdle setup box (hurdleBox, steepleBox and shuttleBox,
// app/hurdles.js; docs/hurdles.md) in Juoksut mode, hence the `url`
// (dev/AGENTS.md, "Running a probe"). It covers a start of three settings, a
// start already run and its fold across the refresh, an unmarked setting's
// figure, the steeple box, the aitaviesti's taping figure, and the kenttä
// select and link, and that no view asks for the meet body. It reloads into Kisat mode at the end, where the box must
// be absent, as a gate written as a global passes every check above it
// (dev/probe-mode.js).
//
//   dev/probe.html?probe=probe-hurdles&url=%3Fmode%3Djuoksut
//
// lib/hurdles.js groups the settings and finds the marks and lanes, and the
// offline suite tests it (hurdleStartSetups). The box fetches static files
// under /data/, so no Worker is needed.
export default async function probe({ frame, W, log, ok, wait, groupKey, appJs, demoJs }) {
  const doc = () => frame.contentDocument;
  const app = () => doc().getElementById('app');
  const go = async (hash, ms = 1500) => {
    appJs.navigate(hash);
    await wait(ms);
  };

  const K60 = groupKey(10, 10, '60m aidat');
  const K400 = groupKey(15, 30, '400m aidat');
  const K800 = groupKey(9, 0, '800m');
  const start = (key) => `/c/demo/g/${encodeURIComponent(key)}`;

  // The box is one <details> in either state. The rest of the page is the
  // results, and no check here reaches into it.
  const box = () => app().querySelector('details.hurdles');
  const heads = () => [...(box()?.querySelectorAll('thead th') || [])].map((th) => th.textContent);
  const bodyRows = () => [...(box()?.querySelectorAll('tbody tr') || [])];
  const cells = (tr) => [...tr.children].map((td) => td.textContent.trim());

  // The Juoksut host answers /api/meet with 404, so no view of the mode asks
  // for it (fetchMeetBody, app/data.js). On a dev host the Worker answers it,
  // so only the requests show the call. (Break on purpose: drop the mode's
  // gate from fetchMeetBody.)
  const realFetchJson = appJs.fetchJson;
  const asked = [];
  appJs.setFetchJson((url, opts) => {
    asked.push(url);
    return realFetchJson(url, opts);
  });
  await go('/c/demo', 1500);
  await go(start(K800), 1500);
  await go('/c/demo/o/P9%203-ottelu', 1500);
  appJs.setFetchJson(realFetchJson);
  const meetAsks = asked.filter((u) => u.startsWith('/api/meet/'));
  log(`${asked.length} requests, of /api/meet/: ${JSON.stringify(meetAsks)}`);
  ok('the day list, a start and a multi-event ask for no meet body', asked.length > 0 && meetAsks.length === 0);

  await go(start(K60), 2500);
  ok('a drawn hurdle start carries the box, open', !!box() && box().open);
  // The box has a row per setting and not per class. This start's three
  // classes need three settings.
  ok('...a row per setting', bodyRows().length === 3);
  // The lanes lead each row, lowest first, in the order the track is walked
  // and not the programme's.
  ok(
    '...the lanes leading each row, lowest first and a run as a range',
    bodyRows()
      .map((tr) => tr.children[0].firstChild.textContent)
      .join('|') === '1|3|5–6',
  );
  ok(
    '...with the classes standing in them muted underneath',
    bodyRows()[2].querySelector('.hurdle-cats')?.textContent === 'M17',
  );
  // A hurdle is placed by its height, mark and count, and the distances come
  // after. The checks read classes, as a theme can move a computed colour.
  // (Break on purpose: add .hurdle-dim to the Aitoja cell.)
  ok(
    'the height, the mark and the count are not muted',
    [...bodyRows()[0].children].slice(1, 4).every((td) => !td.classList.contains('hurdle-dim')),
  );
  ok(
    '...and the distances after them are one muted mitat cell',
    [...bodyRows()[0].children].length === 5 &&
      bodyRows()[0].children[4].classList.contains('hurdle-dim') &&
      cells(bodyRows()[0])[4] === '12 / 8 / 16',
  );
  ok(
    "the columns are SUL's own, lanes then height and mark",
    heads().join('|') === 'Radat|Korkeus|Merkintä|Aitoja|Mitat',
  );
  // The five columns fit a phone only at the box's smaller size (.setup-tbl,
  // index.html). (Break on purpose: drop the max-width: 520px block.)
  const boxWrap = () => box().querySelector('.tbl-wrap');
  log(`box ${boxWrap().scrollWidth} in ${boxWrap().clientWidth}`);
  ok('...and the five fit a phone, the mitat with them', boxWrap().scrollWidth <= boxWrap().clientWidth);
  // The first row's setting uses the first five of a six-circle mark, and
  // its cell says so (markParts, app/hurdles.js).
  ok(
    'a setting on part of a longer mark says so',
    cells(bodyRows()[0])[2].includes('musta ympyrä') && cells(bodyRows()[0])[2].includes('5/6 ensimmäistä'),
  );
  // Each mark is drawn as well as named (markGlyph, app/hurdles.js).
  // getAttribute reads the class, as an <svg>'s className is no string.
  // (Break on purpose: drop the glyph from the cell, or take 'viiva' out of
  // HURDLE_SYMBOLS.)
  const glyphs = () =>
    bodyRows().map((tr) => {
      const g = tr.children[2].firstChild?.firstChild;
      return g && `${g.getAttribute('class')}/${g.firstChild.tagName}`;
    });
  ok(
    '...and every mark is drawn as well as named',
    glyphs().join('|') ===
      'hurdle-mark hurdle-mark-black/circle' +
        '|hurdle-mark hurdle-mark-yellow/rect' +
        '|hurdle-mark hurdle-mark-blue/rect',
  );
  // The glyph stays on the colour word's line, and only the symbol wraps. The
  // stylesheet holds the two together, so the check reads the computed style.
  // (Break on purpose: drop .hurdle-mark-name's nowrap, or build the glyph
  // with el() and not svgEl().)
  const markName = bodyRows()[0].children[2].firstChild;
  ok(
    '...the glyph riding with the colour word',
    markName.textContent === 'musta' &&
      markName.firstChild?.classList.contains('hurdle-mark') &&
      markName.firstChild.namespaceURI === 'http://www.w3.org/2000/svg' &&
      W.getComputedStyle(markName).whiteSpace === 'nowrap',
  );

  // The 400 m start has two undrawn classes, and one has no published row.
  // Each keeps a row of its own with no lane and no neighbour's numbers. The
  // start has also run, so the box is folded to one line.
  await go(start(K400), 2500);
  ok('a start already run carries the box folded', !!box() && !box().open);
  ok('...to a summary and nothing else', box().querySelector('summary').textContent === 'Aidat');
  ok('...and still has its results', app().textContent.includes('Tulokset sarjoittain'));
  box().open = true;
  await wait(200);
  // Drawn and undrawn rows share one table and one set of columns. (Break on
  // purpose: put the undrawn classes in a table of their own.)
  ok(
    '...opening in place onto one table, drawn and undrawn rows alike',
    box().querySelectorAll('table').length === 1 && box().querySelectorAll('.hurdle-heat').length === 0,
  );
  ok(
    '...the drawn lanes first and – for a class nobody has drawn',
    bodyRows()
      .map((tr) => tr.children[0].firstChild.textContent)
      .join('|') === '1–2|–|–',
  );
  ok(
    '...where a class with no published row says so rather than guessing',
    box().textContent.includes('Tuntematon sarja'),
  );
  // The refresh rebuilds this <details> every GROUP_REFRESH_MS, and a box the
  // reader opened stays open (keptOpen, app/shell.js). A new node shows the
  // fold was restored. (Break on purpose: drop `open:` from hurdleShell.)
  const before = box();
  await appJs.render(true);
  await wait(200);
  ok('...and stays open across the refresh that rebuilds it', box() !== before && box().open);

  await go(start(K800), 2000);
  ok('a start that is no hurdle race carries none either', !box());

  // --- The unmarked setting's figure (hurdleFigure, app/hurdles.js) ---
  // A setting on the sheet's own paint carries no figure, as its cell names
  // the mark. e54's 100 m (off a measured meet, 2026-08) is painted nowhere,
  // but five of its ten hurdles stand on the 60 m black circles. So it
  // carries a one-lane strip with lähtö at the far end and the circles under
  // half ticks. It is undrawn, so the box is open and the class leads its one
  // row. (Break on purpose: hand hurdleTapes a null mark, and the 60 m start
  // grows three figures.)
  await go(start(K60), 2500);
  ok('a start on its own paint carries no figure', !!box() && !box().querySelector('.shuttle-tapes'));
  const KM65 = groupKey(10, 0, '100m aidat');
  await go(start(KM65), 2500);
  const figs = () => [...(box()?.querySelectorAll('.shuttle-tapes svg') || [])];
  ok(
    'an unmarked setting carries the one-lane figure, open on a start still undrawn',
    !!box() &&
      box().open &&
      heads()[0] === 'Sarja' &&
      bodyRows().length === 1 &&
      cells(bodyRows()[0])[0] === 'M65' &&
      cells(bodyRows()[0])[2] === '–' &&
      figs().length === 1 &&
      figs()[0].querySelectorAll('.shuttle-tape').length === 10 &&
      new Set([...figs()[0].querySelectorAll('.shuttle-tape')].map((r) => r.getAttribute('y'))).size === 1 &&
      figs()[0].querySelectorAll('.shuttle-foot').length === 10 &&
      [...figs()[0].querySelectorAll('.shuttle-dim-label')].map((t) => t.textContent).join('|') === 'lähtö|maali' &&
      [...figs()[0].querySelectorAll('.shuttle-num')].map((t) => t.textContent).join('|') === '12|8|8|8|8|8|8|8|8|8|16',
  );
  ok(
    '...the paint under the hurdles that happen to stand on some',
    [...figs()[0].querySelectorAll('.shuttle-mark')]
      .map((g) => `${g.getAttribute('class')}/${g.firstChild.tagName}`)
      .join('|') === Array(5).fill('shuttle-mark hurdle-mark-black/circle').join('|') &&
      figs()[0].getAttribute('aria-label') === 'Aitojen paikat' &&
      !box().querySelector('.shuttle-legend') &&
      !box().textContent.includes('null'),
  );
  // One row needs no caption, and the strip fits the phone whole. (Break on
  // purpose: pin S at 12 in tapeFigure.)
  ok(
    '...and the strip fits the phone whole',
    box().querySelector('.shuttle-tapes').scrollWidth === box().querySelector('.shuttle-tapes').clientWidth,
  );

  // --- The steeple box (steepleBox, app/hurdles.js) ---
  // A group start has no lanes. Two classes on one 76,2 cm bar, off a
  // measured meet (2026-09), make one row. (Break on purpose: key the row on
  // the class, and it becomes two.)
  const KEST = groupKey(14, 40, '1500m esteet');
  await go(start(KEST), 2500);
  ok(
    'a steeple start carries the box under its own word, open',
    !!box() && box().open && box().querySelector('summary').textContent === 'Esteet',
  );
  ok('...its columns the class, the bar and the mark, nothing past it', heads().join('|') === 'Sarja|Korkeus|Merkintä');
  ok(
    '...one row for two classes on one bar',
    bodyRows().length === 1 && cells(bodyRows()[0]).join('|') === 'M15, N|76,2 cm|sininen neliö',
  );
  ok('...the mark drawn as the square every track paints', glyphs().join('|') === 'hurdle-mark hurdle-mark-blue/rect');

  // --- The aitaviesti box (shuttleBox, app/hurdles.js) ---
  // The drawn lanes lead the rows, each number widened to its pair
  // (shuttleStartRows, lib/hurdles.js). The figure below shows both
  // directions on one taping line. test/hurdles.test.mjs tests the geometry
  // (hurdleRelaySpec, shuttleTapes).
  const KREL = groupKey(16, 30, '4x60m aitaviesti');
  await go(start(KREL), 2500);
  // One setting covers every leg, so the draw leads the table and not an
  // Osuudet column. The drawn 2, 4 and 6 widen to the three pairs. (Break on
  // purpose: lead the table with the legs unconditionally.)
  ok(
    'an aitaviesti start carries the box, the drawn pairs leading its one every-leg setting',
    !!box() &&
      heads().join('|') === 'Radat|Korkeus|Merkintä|Aitoja|Mitat' &&
      bodyRows().length === 1 &&
      cells(bodyRows()[0])[0] === '1–6' &&
      cells(bodyRows()[0])[1] === '60,0 cm',
  );
  // The setting is symmetric, so both directions find the same circles and
  // no leg is named. (Break on purpose: look the mark up in the even legs'
  // direction alone, in relayTableRow.)
  ok(
    '...the paint unqualified where every leg stands on it',
    cells(bodyRows()[0])[2].includes('vihreä ympyrä') && !cells(bodyRows()[0])[2].includes('(os'),
  );
  // Each lane of the pair carries the same seven tapes and feet on a row of
  // its own, and both end gaps are 10,5. (Break on purpose: drop the odd
  // lane in tapeFigure.)
  const fig = () => box()?.querySelector('.shuttle-tapes svg');
  const tapeYs = () => new Set([...fig().querySelectorAll('.shuttle-tape')].map((r) => r.getAttribute('y')));
  ok(
    '...and the taping figure below it, gaps labelled tape to tape',
    !!fig() &&
      fig().querySelectorAll('.shuttle-tape').length === 14 &&
      tapeYs().size === 2 &&
      fig().querySelectorAll('.shuttle-foot').length === 14 &&
      [...fig().querySelectorAll('.shuttle-num')].map((t) => t.textContent).join('|') ===
        '10,5|6,5|6,5|6,5|6,5|6,5|6,5|10,5' &&
      // The relay starts at the maali line, so the far end is named by its
      // distance. (Break on purpose: name it lähtö.)
      [...fig().querySelectorAll('.shuttle-dim-label')].map((t) => t.textContent).join('|') === '60 m|maali',
  );
  // The sheet paints every relay position, so each tape has its circle under
  // a half tick on a tier of its own. (Break on purpose: drop the tier's
  // height.)
  ok(
    '...and the paint under each tape',
    [...fig().querySelectorAll('.shuttle-mark')]
      .map((g) => `${g.getAttribute('class')}/${g.firstChild.tagName}`)
      .join('|') === Array(7).fill('shuttle-mark hurdle-mark-green/circle').join('|') &&
      [...fig().querySelectorAll('.shuttle-tick')].every((t) => t.getAttribute('y2') === '78') &&
      fig().getAttribute('height') === '128',
  );
  // (Break on purpose: swap the arrows, and the legend lies about who meets
  // the feet.)
  ok(
    '...the legend giving each direction its legs',
    box().querySelector('.shuttle-legend')?.textContent === 'osuudet 2 ja 4 → · ← osuudet 1 ja 3',
  );
  // The metre shrinks to fit the column, so a phone holds the strip whole.
  // (Break on purpose: pin S at 12, and it scrolls.)
  const strip = () => box()?.querySelector('.shuttle-tapes');
  ok('...and the strip fits the phone whole', strip().scrollWidth === strip().clientWidth);
  // The strip also fills the column, as its margins are the labels' measured
  // widths (labelWidth, app/hurdles.js). (Break on purpose: add 10 to R in
  // tapeFigure, and the right edge stands 10 px clear.)
  const gaps = () => {
    const w = Number(fig().getAttribute('width'));
    const bs = [...fig().querySelectorAll('*')].map((n) => n.getBBox()).filter((b) => b.width || b.height);
    return [Math.min(...bs.map((b) => b.x)), w - Math.max(...bs.map((b) => b.x + b.width))];
  };
  log(
    `figure gaps ${gaps()
      .map((g) => g.toFixed(1))
      .join(' / ')}`,
  );
  ok(
    '...drawn edge to edge',
    gaps().every((g) => g > -1 && g < 5),
  );
  // Turned to landscape and back, the strip is redrawn to its column, with
  // the metre still capped at 12 px (redrawOnResize, app/hurdles.js).
  // (Break on purpose: drop the resize redraw.)
  const figW = () => Number(fig().getAttribute('width'));
  const phoneW = figW();
  const turn = async (px) => {
    frame.style.width = `${px}px`;
    await wait(600);
  };
  await turn(900);
  log(`strip ${phoneW} in 402, ${figW()} in ${app().clientWidth}`);
  ok(
    '...redrawn to the column when the phone turns',
    app().clientWidth > 700 && figW() > phoneW && figW() <= app().clientWidth,
  );
  await turn(402);
  ok(
    "...and back to the phone's own when it turns back",
    figW() === phoneW && strip().scrollWidth === strip().clientWidth,
  );
  // A tap turns the strip end for end, and the legend's arrows turn with it.
  // The facing is stored per meet (storedFlip, app/hurdles.js), so the
  // refresh keeps it. (Break on purpose: rebuild the strip without the
  // legend, and the arrows lie about who meets the feet.)
  const legend = () => box().querySelector('.shuttle-legend')?.textContent;
  const endX = (i) => Number([...fig().querySelectorAll('.shuttle-dim-label')][i].getAttribute('x'));
  strip().dispatchEvent(new W.Event('click'));
  await wait(100);
  ok(
    'a tap flips maali to the near end, the legend turning with it',
    endX(0) > endX(1) && legend() === '← osuudet 2 ja 4 · osuudet 1 ja 3 →',
  );
  await appJs.render(true);
  await wait(200);
  ok('...and the refresh leaves it turned', endX(0) > endX(1));
  strip().dispatchEvent(new W.Event('click'));
  await wait(100);
  ok('...and a second tap turns it back', endX(0) < endX(1) && legend() === 'osuudet 2 ja 4 → · ← osuudet 1 ja 3');
  // Each band is named by the drawn lanes of its parity, as even legs run the
  // odd lane (shuttleBandNames, lib/hurdles.js). With the draw stripped, a
  // one-class start falls back to the parity's word. (Break on purpose: swap
  // the parities, and the names stand in each other's bands.)
  const laneNames = () => [...fig().querySelectorAll('.shuttle-lane-name')].map((t) => t.textContent).join('|');
  ok('...the bands named by the drawn lanes of their parity', laneNames() === '1, 3, 5|2, 4, 6');
  const e13 = demoJs.DEMO_EVENTS.e13.Rounds[0].Heats[0].Allocations;
  const drawn = e13.map((a) => a.Position);
  e13.forEach((a) => {
    a.Position = null;
  });
  await appJs.render(true);
  await wait(200);
  ok('...and by parillinen and pariton while the one class is undrawn', laneNames() === 'pariton|parillinen');
  e13.forEach((a, i) => {
    a.Position = drawn[i];
  });
  await appJs.render(true);
  await wait(200);

  // --- The sekaviesti box (e50, off a measured meet, 2026-08) ---
  // Its two rows split the drawn pair, each direction on a lane of its own.
  // The team is drawn 3, so the M hurdles stand on 3 and the N on 4
  // (shuttleStartRows, lib/hurdles.js). It has run, so the box is folded, and
  // a closed <details> keeps its DOM for the checks. (Break on purpose: lead
  // with the legs over a draw.)
  const KSEKA = groupKey(16, 45, '4x100m aitaviesti');
  await go(start(KSEKA), 2500);
  ok(
    'the sekaviesti is two rows splitting the drawn pair, folded on a start already run',
    !!box() &&
      !box().open &&
      bodyRows().length === 2 &&
      heads().join('|') === 'Radat|Korkeus|Merkintä|Aitoja|Mitat' &&
      bodyRows()[0].children[0].firstChild.textContent === '3' &&
      bodyRows()[0].querySelector('.hurdle-cats')?.textContent === 'M' &&
      bodyRows()[1].children[0].firstChild.textContent === '4' &&
      bodyRows()[1].querySelector('.hurdle-cats')?.textContent === 'N',
  );
  ok(
    '...a height per direction, in lane order',
    cells(bodyRows()[0])[1] === '99,1 cm' && cells(bodyRows()[1])[1] === '83,8 cm',
  );
  ok(
    '...the legend giving each class its direction',
    box().querySelector('.shuttle-legend')?.textContent === 'M osuudet 2 ja 4 → · ← N osuudet 1 ja 3',
  );
  // Each direction's ten tapes stand in its own lane, so the 1,25 m pairs do
  // not touch and the strip fits a phone. The box is folded, so the width is
  // read off the svg. (Break on purpose: pin S at 12, and the width triples.)
  ok(
    '...twenty tapes split over the two lanes, and the strip fits the phone',
    fig().querySelectorAll('.shuttle-tape').length === 20 &&
      tapeYs().size === 2 &&
      fig().querySelectorAll('.shuttle-foot').length === 20 &&
      Number(fig().getAttribute('width')) <= app().clientWidth,
  );
  ok("...each direction's band named by its lane of the pair", laneNames() === '3|4');

  // --- The kenttä select, on the schedule ---
  // The box's marks come from this choice (docs/venues.md). The render shows
  // the optgroups, the plain lengths first and each kenttä under its
  // locality, and one <select> writes two keys.
  await go('/c/demo', 2000);
  const pick = () => app().querySelector('.track-pick');
  const sel = () => pick()?.querySelector('select');
  const stored = (key) => {
    try {
      return JSON.parse(W.localStorage.getItem(`${key}:demo`));
    } catch {
      return null;
    }
  };
  const choose = async (value) => {
    sel().value = value;
    sel().dispatchEvent(new W.Event('change'));
    await wait(100);
  };

  ok('the select is a kenttä, not a rata', sel()?.getAttribute('aria-label') === 'Kenttä');
  ok(
    '...the generic lengths first, then a group per locality',
    [...sel().children].map((g) => `${g.label}:${[...g.children].map((o) => o.textContent).join(',')}`).join('|') ===
      'Yleiset:400 m,200 m|Helsinki:Eläintarha,Heteniitty,Liikuntamylly|Tampere:Pirkkahalli|Turku:Kupittaa',
  );
  // A kenttä writes its own key and the length the lap counter reads.
  // (Break on purpose: drop the saveTrack call from the handler.)
  await choose('v:helsinki-elaintarha');
  ok(
    '...a kenttä stores itself and its length',
    stored('venue')?.id === 'helsinki-elaintarha' && stored('track')?.track === 400,
  );
  // A bare length is no kenttä, so the kenttä's key goes and cannot go
  // stale. (Break on purpose: make saveVenue only ever setItem.)
  await choose('200');
  ok('...a bare length clears the kenttä', stored('venue') === null && stored('track')?.track === 200);
  // With a kenttä chosen, the box reads its board in place of the sheet
  // (venueTable, lib/venues.js), through a second fetch (loadChosenVenue,
  // app/hurdles.js). This board paints none of the start's three 60 m
  // settings, so all three rows come back unmarked. (Break on purpose: fall
  // through to the sheet's marks.)
  await choose('v:helsinki-elaintarha');
  await go(start(K60), 2500);
  ok(
    '...and a kenttä chosen puts its own board in the box',
    bodyRows().length === 3 && bodyRows().every((tr) => cells(tr)[2] === '–'),
  );
  // Without a mark, the distances are what gets taped out, so they are not
  // muted. (Break on purpose: hard-code 'num hurdle-dim' in
  // hurdleSettingRow's mitat cell.)
  ok(
    '...and a row with no mark unmutes its distances for the tape',
    bodyRows().every((tr) => [...tr.children].slice(4).every((td) => !td.classList.contains('hurdle-dim'))),
  );
  // Each of the three grows a figure, as each has hurdles on the board's
  // other paint. Three rows need telling apart, so each figure is captioned
  // by its lanes. (Break on purpose: drop the lanes from hurdleFigure's
  // caption, and the captions name the classes.)
  ok(
    '...and a figure per unmarked row, captioned by its lanes',
    figs().length === 3 &&
      [...box().querySelectorAll('.shuttle-legend')].map((c) => c.textContent).join('|') ===
        'Radat 1|Radat 3|Radat 5–6' &&
      figs().every((f) => f.querySelectorAll('.shuttle-tape').length === 5) &&
      figs().reduce((n, f) => n + f.querySelectorAll('.shuttle-mark').length, 0) === 5,
  );
  // An aitaviesti reads the same board, keyed on position (hurdleRelaySpec
  // through venueTable). Its 100 m line carries the sekaviesti's M legs, and
  // the N legs stand on no paint. (Break on purpose: hand shuttleBox the
  // sheet's table in place of vtable in setupBox.)
  await go(start(KSEKA), 2500);
  ok(
    "...and an aitaviesti stands on the board's own paint, or on nothing",
    cells(bodyRows()[0])[2] === 'keltainen viiva' && cells(bodyRows()[1])[2] === '–',
  );
  // At 1,25 m the phone's strip has no room for the M legs' lines, so it has
  // no tier and the cell carries the mark. (Break on purpose: drop the pitch
  // gate in tapeFigure.)
  ok(
    '...but a phone-wide strip leaves 1,25 m pairs unglyphed',
    fig().querySelectorAll('.shuttle-mark').length === 0 && fig().getAttribute('height') === '116',
  );

  // --- The kenttä link ---
  // /c/demo/k/<id> writes what the select would (activateVenueLink,
  // app/hurdles.js). (Break on purpose: drop saveTrack from it.)
  await go('/c/demo/k/helsinki-heteniitty', 2000);
  ok(
    'a kenttä link writes the choice and lands on the schedule',
    W.location.pathname === '/c/demo' &&
      stored('venue')?.id === 'helsinki-heteniitty' &&
      stored('track')?.track === 400 &&
      sel().value === 'v:helsinki-heteniitty',
  );
  // (Break on purpose: save the id unchecked.)
  await go('/c/demo/k/nowhere', 2000);
  ok(
    '...an unknown kenttä writes nothing',
    W.location.pathname === '/c/demo' && stored('venue')?.id === 'helsinki-heteniitty',
  );
  await go('/c/demo/k/200', 2000);
  ok('...and a bare length clears it, like the select', stored('venue') === null && stored('track')?.track === 200);

  // --- Kisat mode, where none of it belongs ---
  // A real reload is needed, as the mode is read once at boot. It opens the
  // root, since only the Worker answers a path (dev/probe-runner.js).
  W.location.replace('/');
  await wait(2500);
  appJs.navigate(start(K60));
  await wait(2000);
  ok('Kisat mode is in fact Kisat mode', doc().getElementById('title').textContent.includes('60m aidat'));
  ok('...and the same start carries no box there', !box());
  await go('/c/demo/k/helsinki-elaintarha', 2000);
  ok(
    '...nor is the kenttä link its route: it falls to home',
    doc().getElementById('title').textContent.startsWith('Kisat'),
  );
}
