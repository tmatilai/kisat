// Checks a Seuracup final against democupfinal (docs/views.md,
// "The club cup"). It covers the standings in halves with the sukkulaviesti's
// tie-break, the place-based rail on a start, and no qual-note.
//   dev/probe.html?probe=probe-cupfinal&url=c/democupfinal
// fetchJson answers the meet body from the fixture, so no Worker is needed.
export default async function probe({ D, log, ok, wait, groupKey, appJs }) {
  const go = async (path, ms = 1400) => {
    appJs.navigate(path);
    await wait(ms);
  };
  const text = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : null);
  const rows = (sel) => [...D.querySelectorAll(sel)];
  // A ladder is drawn as the phone's cards and the wide grid, one hidden.
  const shown = (sel) => rows(sel).filter((n) => n.offsetParent !== null);

  await go('/c/democupfinal/cup');
  const table = rows('#app tbody tr').map((tr) => [...tr.children].map((td) => text(td)).join(' '));
  log(`standings: ${table.join(' | ')}`);
  // test/cup.test.mjs checks the order and the halves, and this checks how
  // they print.
  // (Break on purpose: round to whole points in cupPointsText, and 65,5 is 66.)
  ok(
    "the clubs in the final's order, halves with a comma",
    table.join(' | ') ===
      '1. Testilän Kisa 76 | 2. Demon Urheilijat 76 | 3. Näyteniemen Vauhti 65,5 | 4. Mallikylän Vire 57,5 ' +
        '| 5. Harjoituspiirin Urheilijat 36,5 | 6. Esimerkkilän Ponnistus 36 | 7. Kokeilulan Kiri 30 | 8. Pistelän Pyrintö 29,5',
  );

  await go(`/c/democupfinal/g/${encodeURIComponent(groupKey(10, 10, 'Korkeus'))}`);
  const points = shown('#app .cup-points').map((p) => text(p));
  log(`korkeus points: ${points.join(' ')}`);
  // (Break on purpose: read a final's points off SeuraCUPPoints in pointsRail.)
  ok(
    "a shared height scores the places' halves, every row counting",
    points.filter((p) => p === '11,5 p.').length === 2 &&
      points.length === 15 &&
      shown('#app .cup-points-scored').length === 15,
  );
  // (Break on purpose: drop `!cup.final` from cupNote's gate.)
  ok('and no note, nothing being muted', !D.querySelector('#app .qual-note'));

  await go(`/c/democupfinal/g/${encodeURIComponent(groupKey(11, 10, '60m aidat'))}`);
  const dnf = rows('#app tbody tr, #app .ladder-card').find((r) => /Camilla Kokeilu/.test(text(r)));
  log(`dnf row: ${text(dnf)}`);
  // (Break on purpose: drop pointsEl's early return on a missing score.)
  ok('a DNF carries no points', !!dnf && !dnf.querySelector('.cup-points'));
}
