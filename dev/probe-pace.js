// Pins which results documents each refresh of the demo's day list fetches,
// and checks that opening a start fetches its own (docs/views.md, "The
// refresh"). test/schedule.test.mjs tests docMaxAge itself.
//   dev/probe.html?probe=probe-pace
export default async function probe({ W, log, ok, groupKey, appJs, settle }) {
  // The clock stands at 06:00, before every demo start, so only a round in
  // progress is live. No demo document has a Last-Modified before its round's
  // start (demoModifiedAt, demo.js), so every other document counts as quiet
  // since long ago.
  const day = new W.Date();
  day.setHours(6, 0, 0, 0);
  let clock = day.getTime();
  const realNow = W.Date.now;
  W.Date.now = () => clock;

  // Harjoituspiirin Urheilijat has entrants in rounds that run, rounds that are
  // Official, rounds still to come and a multi-event. The counts add a document
  // for each class of every start still to come.
  const realFetchJson = appJs.fetchJson;
  let fetched = [];
  let schedules = 0;
  appJs.setFetchJson(async (url, opts) => {
    if (url === '/api/watch/wpace') {
      return {
        label: 'Tahti',
        entries: [{ type: 'club', id: '6', name: 'Harjoituspiirin Urheilijat', enabled: true }],
      };
    }
    const m = /\/results\/demo\/([^/]+)$/.exec(url);
    if (m) fetched.push(m[1]);
    if (url.endsWith('/competition/demo')) schedules += 1;
    return realFetchJson(url, opts);
  });
  appJs.setActiveFollow('wpace');
  appJs.updateViewState('demo', { counts: true, mode: 'all' });
  const take = () => {
    const ids = fetched.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    fetched = [];
    schedules = 0;
    return ids;
  };
  const refreshAt = async (ms) => {
    clock = day.getTime() + ms;
    await appJs.render(true);
    await settle();
    return take();
  };

  appJs.navigate('/c/demo');
  await settle();
  const first = take();
  log(`first render: ${first.length}: ${first.join(' ')}`);
  ok('the first render fetches each document once', first.length === new Set(first).size);
  ok('and fetches the day', first.length === 45);

  // 25 s later, only the followed rounds in progress are due.
  // (Break on purpose: pass loadDay's store no followed ids, and this fetches
  // all 45. Pass it an empty set, and this fetches none.)
  const tick = await refreshAt(25_000);
  log(`at 0:25: ${tick.join(' ')}`);
  ok('a refresh 25 s later fetches the 6 followed events in progress', tick.join(' ') === 'e16 e18 e32 e35 e60 e61');

  // At 2:25, the rest of the followed events still to come are due as well.
  const followed = await refreshAt(145_000);
  log(`at 2:25: ${followed.length}: ${followed.join(' ')}`);
  ok('2 minutes on, the followed events still to run are due too', followed.length === 16);
  // e37 is the root of the T9 3-ottelu, whose legs e34 to e36 the club
  // entered. The roster lists only the legs. (Break on purpose: drop the
  // `followed.add` from eventStoreFor, and e37 waits until 10:25.)
  ok('and they include the multi-event root of a followed leg', followed.includes('e37'));

  // At 5:25, the followed events that are Official are due once more.
  const finished = await refreshAt(325_000);
  log(`at 5:25: ${finished.length}: ${finished.join(' ')}`);
  ok('5 minutes on, the followed Official events are due as well', finished.length === 24);

  // At 10:25, every kept copy is due, the counted ones included.
  const all = await refreshAt(625_000);
  log(`at 10:25: ${all.length}`);
  ok('10 minutes on, the refresh fetches the whole day again', all.join(' ') === first.join(' '));

  // Opening a start fetches its documents, though the day list's copies are
  // a few seconds old. (Break on purpose: give loadGroupDetail's store an
  // empty set of followed ids, and this fetches only e31, which the day list
  // never read.)
  clock += 5_000;
  appJs.navigate(`/c/demo/g/${encodeURIComponent(groupKey(13, 45, '400m'))}`);
  await settle();
  const openedSchedules = schedules;
  const opened = take();
  log(`opening 400m at 13.45: ${opened.join(' ')}, and ${openedSchedules} schedule`);
  ok('opening a start fetches it fresh', opened.join(' ') === 'e30 e31');
  // The schedule the day list fetched 5 s earlier serves the start, and a
  // refresh fetches it again. (Break on purpose: drop the `reuse` from
  // fetchSchedule, and the start fetches one. Reuse it on a refresh too, and the
  // refresh fetches none.)
  ok('opening a start right after a refresh reuses the schedule', openedSchedules === 0);
  clock += 5_000;
  await appJs.render(true);
  await settle();
  log(`a refresh 5 s later: ${schedules} schedule`);
  ok('a refresh fetches the schedule', schedules === 1);
  take();

  // A clock set back before the kept copies fetches them all again.
  // (Break on purpose: drop `age >= 0` from keptJson, and this fetches none.)
  appJs.navigate('/c/demo');
  await settle();
  take();
  const back = await refreshAt(-3_600_000);
  log(`at 5:00: ${back.length}`);
  ok('a clock set back an hour fetches the whole day again', back.join(' ') === first.join(' '));

  W.Date.now = realNow;
  appJs.setFetchJson(realFetchJson);
  appJs.setActiveFollow(null);
}
