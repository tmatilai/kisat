// Tests the medal table and a championship's year (docs/views.md).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoCupEventResults, demoEventResults, inventedDistricts } from './fixtures.mjs';
import { combinedEventStarts, combinedLeaderPoints, combinedRootStart } from '../public/lib/combined.js';
import { cupSeasonHref, cupSeasonMeets, cupSeasonPiirit, cupSeries } from '../public/lib/cup.js';
import {
  clubNameKey,
  coverOfTicks,
  coverTicks,
  coverWords,
  coversStart,
  medalScope,
  meetCoverChoices,
  meetScopes,
  piiriEntries,
  scopeFor,
  scopeSplitLabel,
  tickedScopes,
} from '../public/lib/districts.js';
import { SEASON_FIRST_YEAR, seasonYearOk, seasonYears } from '../public/lib/indexes.js';
import {
  buildRoundGoesOn,
  cacheTtlFor,
  clubMedalStarts,
  clubMedalists,
  followedRows,
  medalAges,
  medalFor,
  medalPlaces,
  medalRowsOf,
  medalSeasonAges,
  medalSeasonClubMeets,
  medalSeasonFollowedMedalists,
  medalSeasonMedalists,
  medalSeasonMeetAges,
  medalSeasonMeetEmpty,
  medalSeasonMeetHolds,
  medalSeasonMeets,
  medalSeasonRecord,
  medalSeasonTable,
  medalTable,
  medalTables,
  medalistBoxes,
  medalistsOpenAll,
  meetMedals,
  meetMedalsBody,
  recordSettled,
  restMedals,
  scopeMedalStarts,
  scopeResults,
  scopeTablesAddNothing,
  warmSeasonMeets,
} from '../public/lib/medals.js';
import { displayRank, isFinalRound, officialRank } from '../public/lib/results.js';
import { buildRoster } from '../public/lib/roster.js';
import { reconcileStatuses, roundGroupKey, scheduleStatuses } from '../public/lib/schedule.js';
import { filterEventIds, watchTargets } from '../public/lib/watch.js';
import {
  DEMO_CUP_EVENTS,
  DEMO_CUP_ID,
  DEMO_DISTRICTS,
  DEMO_EVENTS,
  DEMO_ID,
  DEMO_ROAD_ROW,
  demoSchedule,
} from '../public/demo.js';
import districts from '../public/data/districts.json' with { type: 'json' };
import seuracup from '../public/data/seuracup.json' with { type: 'json' };

// --- isFinalRound/medalFor/followedRows/medalistBoxes/medalTable: the
// medal table page and a championship's year (docs/views.md) ---
test('isFinalRound/medalFor/followedRows/medalistBoxes/medalTable', () => {
  const finalRound = { Id: 'f', RoundTypeCategory: 'Final', Status: 'Official' };
  const heats = { Id: 'h', RoundTypeCategory: 'Qualify', Status: 'Official' };
  assert.equal(isFinalRound([heats, finalRound], finalRound), true);
  assert.equal(isFinalRound([heats, finalRound], heats), false, 'a heat is no final while a final follows');
  assert.equal(
    isFinalRound([heats], heats),
    true,
    "an event's only round is its final whatever the flag says — the single-round Alkuerät the cup skips (docs/tuloslista-api.md)",
  );
  assert.equal(isFinalRound([finalRound], null), false);

  assert.equal(medalFor({ ResultRank: 1 }, finalRound, [heats, finalRound]), 1);
  assert.equal(medalFor({ ResultRank: 3 }, finalRound, [finalRound]), 3);
  assert.equal(medalFor({ ResultRank: 4 }, finalRound, [finalRound]), null);
  assert.equal(medalFor({ ResultRank: null }, finalRound, [finalRound]), null);
  assert.equal(medalFor({ ResultRank: 2 }, heats, [heats, finalRound]), null, 'second in the heats is no medal');
  assert.equal(medalFor({ ResultRank: 2 }, heats, [heats]), 2, 'but second in an event run as one round is');
  assert.equal(
    medalFor({ ResultRank: 1, NotInCompetition: true }, finalRound, [finalRound]),
    null,
    'a guest takes no medal — the cup skips the same rows (docs/tuloslista-api.md)',
  );

  // renderMedals (app/medals.js) passes the followed events reconciled with
  // the schedule, and the root of each followed multi-event.
  const schedule = demoSchedule();
  const byId = scheduleStatuses(schedule);
  const withRoots = (targets, roster) => {
    const results = [...filterEventIds(targets, roster)].map((eventId) => ({
      eventId,
      data: reconcileStatuses(DEMO_EVENTS[eventId], byId),
    }));
    for (const root of new Set(results.map((r) => r.data.RootId).filter(Boolean))) {
      results.push({ eventId: root, data: DEMO_EVENTS[root] });
    }
    return results;
  };
  const roster = buildRoster(demoEventResults());
  const demu = watchTargets([{ type: 'club', id: 1, enabled: true }], roster);
  const rows = followedRows(schedule, withRoots(demu, roster), demu);
  const of = (name, event) => rows.filter((r) => r.name === name && (!event || r.event === event));

  // A single-round final gives a medal that stands and prints no round name.
  const ville = of('Ville Mallinen', 'M 100m');
  assert.equal(ville.length, 1);
  assert.equal(ville[0].medal, 2);
  assert.equal(ville[0].pending, false);
  assert.equal(ville[0].roundName, null, 'one round: the event name says it all');
  assert.deepEqual(ville[0].link, {
    kind: 'group',
    key: roundGroupKey(schedule[Object.keys(schedule)[0]].find((r) => r.Id === 'r1')),
  });
  assert.equal(ville[0].total, 4);
  assert.equal(ville[0].place, '2/4', 'the official placing over the field');
  assert.equal(ville[0].key, 'aa1-a');
  assert.equal(ville[0].athleteId, 'a1-a');
  assert.equal(ville[0].subCategory, 'Sprint');

  // e2's round copy lags the schedule, and the reconciled status is read
  // (reconcileStatuses).
  const onni = of('Onni Harjoitinen', 'M Kuula')[0];
  assert.equal(onni.medal, 1);
  assert.equal(onni.pending, false, 'reconciled with the schedule, the throw stands');
  // A round still moving keeps its medal, flagged.
  const joel = of('Joel Esimerkkinen', 'M Korkeus')[0];
  assert.equal(joel.medal, 1);
  assert.equal(joel.pending, true);

  // A qualifying round gives no medal. The round is named, since the event
  // has more than one.
  const ronja = of('Ronja Merkkinen', 'N Pituus')[0];
  assert.equal(ronja.alloc.ResultRank, 2);
  assert.equal(ronja.medal, null, 'second in the Karsinta is not a medal');
  assert.equal(ronja.roundName, 'Karsinta');

  // Every round a person is matched in is a line. The undrawn final's comes
  // off the semis' field (previousRoundField).
  const elina = of('Elina Vauhtinen', 'N 200m');
  assert.deepEqual(
    elina.map((r) => r.roundName),
    ['Alkuerät', 'Välierät', 'Loppukilpailu'],
  );
  assert.deepEqual(
    elina.map((r) => r.medal),
    [null, null, null],
  );
  assert.equal(elina[2].alloc.Result, null, 'the undrawn final carries no result borrowed from the semis');

  // A relay is one line for the club, with no athlete, and its medal goes to
  // the club.
  const relay = rows.filter((r) => r.event === 'M 4x100m viesti');
  assert.equal(relay.length, 1);
  assert.equal(relay[0].key, 'o1');
  assert.equal(relay[0].athleteId, null);
  assert.equal(relay[0].legCount, 4);
  assert.equal(relay[0].medal, 1);

  // A guest's rank gives no medal.
  assert.equal(of('Oskari Demoinen')[0].medal, null);
  // An entry before the draw is a line with nothing on it yet.
  const emma = of('Emma Mittainen', 'N Keihäs')[0];
  assert.equal(emma.total, null);
  assert.equal(emma.pending, true);

  // A multi-event is one line for its root and none for its legs, with the
  // status taken from the legs (combinedEventStatus, docs/views.md).
  assert.equal(rows.filter((r) => r.event.startsWith('T9 3-ottelu ')).length, 0, 'no leg is a line');
  const oona = of('Oona Demoinen', 'T9 3-ottelu');
  assert.equal(oona.length, 1);
  assert.deepEqual(oona[0].link, { kind: 'combined', key: 'T9 3-ottelu' });
  assert.equal(oona[0].points, true);
  assert.equal(oona[0].alloc.ResultRank, 1);
  assert.equal(oona[0].total, 7);
  assert.equal(oona[0].medal, 1);
  assert.equal(oona[0].pending, true, 'the multi-event is under way');
  // An unscored multi-event is a line with nothing on it (meetRows).
  const eino = of('Eino Demoinen', 'P9 3-ottelu')[0];
  assert.equal(eino.alloc.ResultRank, null);
  assert.equal(eino.medal, null);

  // A followed person's relay files under the team's club (followedKey,
  // lib/results.js).
  const villeTargets = watchTargets(
    [{ type: 'athlete', id: roster.athletes.find((a) => a.name === 'Ville Mallinen').licenseId, enabled: true }],
    roster,
  );
  const villeRows = followedRows(schedule, withRoots(villeTargets, roster), villeTargets);
  assert.deepEqual(
    villeRows.map((r) => [r.key, r.event]),
    [
      ['aa1-a', 'M 100m'],
      ['o1', 'M 4x100m viesti'],
    ],
  );

  // Boxes go by the medals that stand, then the best placing, then the name.
  // Lines go by medal, then placing, then programme order.
  const boxes = medalistBoxes(rows);
  const medalsOf = boxes.map((b) => b.medals.join(''));
  const firstWithout = medalsOf.indexOf('000');
  assert.ok(
    firstWithout > 0 && medalsOf.slice(firstWithout).every((m) => m === '000'),
    'every box with a medal precedes every box without',
  );
  assert.deepEqual(
    [...new Set(medalsOf.slice(0, firstWithout))],
    ['100', '010', '001'],
    'golds, then silvers, then bronzes',
  );
  const golds = boxes.filter((b) => b.medals[0]).map((b) => b.name);
  assert.deepEqual(
    golds,
    [...golds].sort((a, b) => a.localeCompare(b, 'fi')),
    'level on medals and placing: by name',
  );
  const without = boxes.slice(firstWithout);
  const bests = without.map((b) => b.best ?? Infinity);
  assert.deepEqual(
    bests,
    [...bests].sort((a, b) => a - b),
    'no medal: the best placing decides, nothing placed last',
  );
  assert.ok(
    joel.pending && without.some((b) => b.name === 'Joel Esimerkkinen'),
    'a medal still moving does not count yet',
  );
  const elinaBox = boxes.find((b) => b.name === 'Elina Vauhtinen');
  assert.deepEqual(
    elinaBox.lines.map((r) => r.roundName),
    ['Välierät', 'Alkuerät', 'Loppukilpailu'],
    'lines by placing — her semi win over her second in the heats — and the undrawn final last',
  );
  assert.deepEqual(
    medalistBoxes(
      rows
        .filter((r) => r.name === 'Ronja Merkkinen' || r.name === 'Ville Mallinen')
        .map((r) => ({ ...r, key: 'one', name: 'One', athleteId: '1' })),
    )[0].lines.map((r) => r.event),
    ['M 100m', 'N Pituus'],
    'a medal leads a better placing without one',
  );
  assert.equal(elinaBox.best, 1, 'the best placing counts any round');
  const clubBox = boxes.find((b) => b.key === 'o1');
  assert.equal(clubBox.name, 'Demon Urheilijat');
  assert.equal(clubBox.athleteId, null);
  // A late day sorts after an early one whatever the clock says.
  const twoDays = medalistBoxes([
    {
      key: 'a1',
      name: 'A',
      athleteId: '1',
      org: null,
      alloc: {},
      date: '9.8.2026',
      ts: '2026-08-09T08:00:00+03:00',
      medal: null,
      pending: false,
    },
    {
      key: 'a1',
      name: 'A',
      athleteId: '1',
      org: null,
      alloc: {},
      date: '8.8.2026',
      ts: '2026-08-08T18:00:00+03:00',
      medal: null,
      pending: false,
    },
  ]);
  assert.deepEqual(
    twoDays[0].lines.map((r) => r.date),
    ['8.8.2026', '9.8.2026'],
    'level lines in programme order',
  );

  // The clubs' table counts the medals that stand.
  assert.deepEqual(medalTable(rows), [{ id: '1', name: 'Demon Urheilijat', medals: [5, 5, 1], total: 11 }]);
  const two = watchTargets(
    [
      { type: 'club', id: 1, enabled: true },
      { type: 'club', id: 2, enabled: true },
    ],
    roster,
  );
  const table = medalTable(followedRows(schedule, withRoots(two, roster), two));
  assert.deepEqual(
    table.map((c) => c.name),
    ['Demon Urheilijat', 'Mallikylän Vire'],
  );
  assert.ok(table[1].total < table[0].total);
  const tied = medalTable([
    { org: { Id: 2, Name: 'Beta' }, medal: 1, pending: false },
    { org: { Id: 1, Name: 'Alfa' }, medal: 1, pending: false },
    { org: { Id: 3, Name: 'Nolla' }, medal: 2, pending: true },
  ]);
  assert.deepEqual(
    tied.map((c) => [c.name, c.total]),
    [
      ['Alfa', 1],
      ['Beta', 1],
    ],
    'level clubs by name; a medal still moving is not counted, and a club with none has no row',
  );
  assert.deepEqual(
    medalPlaces(
      [
        [1, 0, 2],
        [1, 0, 2],
        [1, 0, 1],
        [0, 3, 0],
      ].map((medals) => ({ medals })),
    ),
    [1, 1, 3, 4],
    'level metals share a place, the next one skipped',
  );

  // The meet's table (/api/medals) reads every event and the roots, and
  // test-worker.mjs asserts the same numbers. A followed club's row equals
  // the followed rows' table.
  const everything = Object.entries(DEMO_EVENTS).map(([eventId, data]) => ({ eventId, data }));
  const meet = meetMedals(schedule, everything);
  assert.deepEqual(
    meet.map((c) => [c.name, ...c.medals, c.total]),
    [
      ['Testilän Kisa', 6, 3, 3, 12],
      ['Demon Urheilijat', 5, 5, 1, 11],
      ['Mallikylän Vire', 3, 2, 1, 6],
      ['Näyteniemen Vauhti', 2, 3, 3, 8],
      ['Harjoituspiirin Urheilijat', 2, 3, 0, 5],
    ],
  );
  assert.deepEqual(
    meet.find((c) => c.id === '1'),
    medalTable(rows)[0],
  );
  assert.ok(!meet.some((c) => c.total === 0), "the guests' club has no row");
  // A root counts once the schedule has its legs Official, so the T9
  // 3-ottelu's gold is missing above and counted here.
  const finished = Object.fromEntries(
    Object.entries(schedule).map(([day, list]) => [
      day,
      list.map((r) => (r.EventName.startsWith('T9 3-ottelu') ? { ...r, Status: 'Official' } : r)),
    ]),
  );
  const withRoot = meetMedals(finished, everything);
  assert.deepEqual(withRoot.find((c) => c.id === '1').medals, [6, 5, 1], "the root's gold, and no leg's");
  assert.deepEqual(
    meetMedals(
      demoSchedule(DEMO_CUP_ID),
      Object.entries(DEMO_CUP_EVENTS).map(([eventId, data]) => ({ eventId, data })),
    ).map((c) => [c.name, ...c.medals]),
    [
      ['Demon Urheilijat', 4, 2, 1],
      ['Testilän Kisa', 2, 3, 0],
      ['Näyteniemen Vauhti', 0, 1, 1],
      ['Mallikylän Vire', 0, 0, 4],
    ],
    'a single round run as heats alone gives medals, where it scores the cup nothing',
  );

  // Under a piiri the rank is among the piiri's own rows (medalFor's scope,
  // docs/views.md).
  const orgA = { Id: 1, NameShort: 'AaU' };
  const orgB = { Id: 2, NameShort: 'BeU' };
  const field = [
    { Id: 1, ResultRank: 1, Organization: orgB },
    { Id: 2, ResultRank: 2, Organization: orgA },
    { Id: 3, ResultRank: 2, Organization: orgA },
    { Id: 4, ResultRank: 4, Organization: orgB, NotInCompetition: true },
    { Id: 5, ResultRank: 5, Organization: orgA },
    { Id: 6, ResultRank: 6, Organization: orgB },
    { Id: 7, ResultRank: 7, Organization: orgA },
  ];
  const both = {
    piirit: [
      { id: 'a', short: 'A', clubs: ['AaU'] },
      { id: 'b', short: 'B', clubs: ['BeU'] },
    ],
  };
  const ticks = (...ids) => ids.map((id) => ({ id, cover: null }));
  const one = medalScope(both, ticks('a'));
  const under = (a, ranking = { scopeOf: one, field }) => medalFor(a, finalRound, [finalRound], ranking);
  assert.deepEqual(
    field.map((a) => under(a)),
    [null, 1, 1, null, 3, null, null],
    "the piiri's rows alone are ranked: two level golds, no silver, the bronze to its fifth-placed athlete, and its fourth row is fourth",
  );
  const other = medalScope(both, ticks('b'));
  assert.equal(under(field[0], { scopeOf: other, field }), 1);
  assert.equal(under(field[3], { scopeOf: other, field }), null, 'a guest takes none under a piiri either');
  assert.equal(under(field[5], { scopeOf: other, field }), 2, "and is skipped by the piiri's own count");
  assert.equal(
    medalFor(field[1], heats, [heats, finalRound], { scopeOf: one, field }),
    null,
    'a heat is no final under a piiri either',
  );
  assert.equal(medalScope({ piirit: [] }, ticks('a'))(orgA), null);
  assert.equal(medalScope(null, [])(orgA), null);
  // With both chosen, each row ranks under its own piiri.
  assert.deepEqual(
    field.map((a) => medalFor(a, finalRound, [finalRound], { scopeOf: medalScope(both, ticks('a', 'b')), field })),
    [1, 1, 1, null, 3, 2, null],
  );
  assert.equal(scopeFor(both, ticks('a', 'b'), orgB).short, 'B');
  assert.equal(scopeFor(both, ticks('a'), orgB), null, 'not chosen: none');
  assert.equal(scopeFor(both, ticks('a', 'b'), { NameShort: 'Nobody' }), null);
  // A club's second record, made by hand under its own abbreviation, is
  // found by its name (the club index, 2026-09-14, docs/districts.md).
  const byName = { piirit: [{ id: 'a', short: 'A', clubs: ['AaU'], names: ['Aalan Urheilijat'] }] };
  assert.equal(
    scopeFor(byName, ticks('a'), { NameShort: 'AU', Name: 'AALAN  urheilijat ry' })?.id,
    'a',
    'case, spacing and ry aside',
  );
  assert.equal(scopeFor(byName, ticks('a'), { NameShort: 'AU', Name: 'Aalan Urheilijat 2' }), null);
  assert.equal(
    scopeFor(byName, ticks('a'), { NameShort: 'aau' }),
    null,
    'an abbreviation matched exactly, case included',
  );
  assert.equal(medalScope(byName, ticks('a'))({ NameShort: 'AU', Name: 'Aalan Urheilijat' })?.id, 'a');

  // The Worker's body has the meet's table and one per scope with a club in
  // the meet, ranked within the scope. The club no piiri holds is named once.
  const body = meetMedalsBody(schedule, everything, DEMO_DISTRICTS);
  const tables = (b) => b.scopes.map((p) => [p.id, p.short, p.table.map((c) => [c.name, ...c.medals, c.total])]);
  assert.deepEqual(body.table, meet);
  assert.deepEqual(tables(body), [
    [
      'demolainen',
      'Demolainen alue',
      [
        ['Testilän Kisa', 6, 5, 1, 12],
        ['Demon Urheilijat', 5, 5, 1, 11],
        ['Näyteniemen Vauhti', 3, 2, 3, 8],
        ['Mallikylän Vire', 3, 2, 1, 6],
      ],
    ],
    [
      'demy',
      'DemY',
      [
        ['Testilän Kisa', 7, 5, 0, 12],
        ['Demon Urheilijat', 7, 3, 1, 11],
      ],
    ],
    [
      'maly',
      'MalY',
      [
        ['Näyteniemen Vauhti', 8, 1, 0, 9],
        ['Mallikylän Vire', 5, 1, 0, 6],
      ],
    ],
  ]);
  assert.deepEqual(
    body.unknown,
    ['Harjoituspiirin Urheilijat'],
    "the guests' club is in no piiri and is not named either",
  );
  const outside = (o) => meetMedalsBody(schedule, everything, { ...DEMO_DISTRICTS, outside: o }).unknown;
  assert.deepEqual(outside({ clubs: ['HarjU'], names: [] }), [], 'a club known to be in no piiri is not asked about');
  assert.deepEqual(outside({ clubs: [], names: ['Harjoituspiirin Urheilijat ry'] }), [], 'nor by its name');
  assert.deepEqual(body.defaults, [], 'a name saying nothing: no scope in force');
  const named = (name, organiser = 'Demon Urheilijat') =>
    meetMedalsBody(schedule, everything, DEMO_DISTRICTS, { name, organiser }).defaults.map((d) => d.id);
  assert.deepEqual(named('DemY:n pm-kisat'), ['demy']);
  assert.deepEqual(named('Avoimet pm-kilpailut'), ['demy'], "a pm word alone: the organiser's piiri");
  assert.deepEqual(named('DemY:n ja MalY:n junnuhuipentuma'), ['demy', 'maly'], 'two named: both, pm word or not');
  assert.deepEqual(named('Avoimet DemY-hallit'), [], 'one named and neither word: none');
  assert.deepEqual(named('Avoimet DemY:n junnuhallit'), ['demy'], 'a junnu word with the piiri named');
  assert.deepEqual(named('Junnuhallit', 'Demolan Yleisurheilu'), ['demy'], 'the piiri organising a junnu meet');
  assert.deepEqual(named('Junnukisat'), [], "a club's junnu meet");
  assert.deepEqual(named('Avoimet pm-kilpailut', 'Nobody'), [], 'an organiser the rows do not name: none');
  assert.deepEqual(named('SM-kilpailut M/N 15-17', 'Nobody'), ['sm'], 'an SM: the country, whoever organises');
  // Entries closed to two piiris make the meet the second's pm too
  // (closedPair). The demo is open as a whole and closed over
  // its 200 m and 800 m. (Break on purpose: tally the whole meet, and the
  // pair is gone. Or drop the outside bound, and 'DemY:n pm-kisat' gains MalY.)
  const twoRaces = { ages: null, events: ['200m', '800m'] };
  assert.deepEqual(
    piiriEntries(schedule, everything, DEMO_DISTRICTS),
    [
      ['demy', 69],
      ['maly', 49],
      [null, 23],
    ],
    'a person once, a club in no piiri under null',
  );
  assert.deepEqual(piiriEntries(schedule, everything, DEMO_DISTRICTS, twoRaces), [
    ['demy', 6],
    ['maly', 6],
  ]);
  assert.equal(body.closed, null, 'no piiri scope: not tallied');
  const closedBody = meetMedalsBody(schedule, everything, DEMO_DISTRICTS, {
    name: 'DemY:n pm 200m ja 800m',
    organiser: 'Demon Urheilijat',
  });
  assert.deepEqual(closedBody.closed, ['demy', 'maly']);
  assert.deepEqual(
    closedBody.defaults,
    [
      { id: 'demy', cover: twoRaces },
      { id: 'maly', cover: twoRaces },
    ],
    "the partner under the pm word's cover",
  );
  assert.equal(
    meetMedalsBody(schedule, everything, DEMO_DISTRICTS, { name: 'DemY:n pm-kisat', organiser: 'Demon Urheilijat' })
      .closed,
    null,
    'an open meet',
  );
  // (Break on purpose: offer the country on every meet, and body.scopes
  // grows a table.)
  assert.deepEqual(
    meetMedalsBody(schedule, everything, DEMO_DISTRICTS, { name: 'Nuorten SM-kilpailut' }).scopes.map((p) => p.id),
    ['sm', 'demolainen', 'demy', 'maly'],
    'the country a table only where the name says SM',
  );
  assert.deepEqual(
    meetMedalsBody(
      schedule,
      everything,
      {
        alueet: [{ id: 'a', name: 'Anen' }],
        piirit: [{ id: 'x', name: 'X', short: 'DemY', alue: 'a', clubs: ['Nobody'] }],
      },
      { name: 'DemY:n pm-kisat' },
    ).defaults,
    [],
    'a named piiri with no club in the meet is not in force',
  );
  assert.deepEqual(
    meetMedalsBody(schedule, everything, { piirit: [{ id: 'x', name: 'X', short: 'X', clubs: ['Nobody'] }] }).scopes,
    [],
    'a piiri with no club in the meet has no table',
  );
  // A default cover gives the alue its classes and every other scope what is
  // left, so no medal is in two tables (19327).
  const byCover = meetMedalsBody(schedule, everything, DEMO_DISTRICTS, {
    name: 'Demolaisen aluemestaruus 15-19v ja DemY:n pm-kisat',
    organiser: 'Demon Urheilijat',
  });
  assert.deepEqual(byCover.defaults, [
    { id: 'demolainen', cover: { ages: [15, 16, 17, 18, 19], events: null } },
    { id: 'demy', cover: null },
  ]);
  assert.deepEqual(tables(byCover), [
    [
      'demolainen',
      'Demolainen alue',
      [
        ['Testilän Kisa', 3, 2, 0, 5],
        ['Demon Urheilijat', 2, 0, 0, 2],
        ['Näyteniemen Vauhti', 1, 2, 1, 4],
        ['Mallikylän Vire', 0, 1, 1, 2],
      ],
    ],
    [
      'demy',
      'DemY',
      [
        ['Demon Urheilijat', 5, 3, 1, 9],
        ['Testilän Kisa', 4, 3, 0, 7],
      ],
    ],
    [
      'maly',
      'MalY',
      [
        ['Näyteniemen Vauhti', 4, 1, 0, 5],
        ['Mallikylän Vire', 4, 0, 0, 4],
      ],
    ],
  ]);
  // `Muut lajit` holds the meet's medals that no ticked cover reaches, each
  // class of a start by its own age. (Break on purpose: key the body's
  // entries by the start alone.)
  const rest = (ticked) => restMedals(byCover, ticked).map((c) => [c.name, ...c.medals, c.total]);
  assert.deepEqual(rest(byCover.defaults), [], 'the piiri over the rest: nothing left');
  assert.deepEqual(
    rest(byCover.defaults.slice(0, 1)),
    [
      ['Demon Urheilijat', 3, 5, 1, 9],
      ['Testilän Kisa', 3, 2, 2, 7],
      ['Mallikylän Vire', 3, 1, 0, 4],
      ['Harjoituspiirin Urheilijat', 2, 1, 0, 3],
      ['Näyteniemen Vauhti', 1, 1, 2, 4],
    ],
    'the alue alone: the classes outside it, guests and all',
  );
  assert.deepEqual(restMedals(byCover, []), byCover.table, "nothing ticked: the meet's table");
  // The browser's tables are the Worker's under the defaults, `Muut lajit`
  // and the age chips over both. (Break on purpose: let a piiri keep a class
  // its ticked alue covers, or ignore the chips.)
  const pageTables = (b, ticked, cover = null) => {
    const t = medalTables(b, ticked, DEMO_DISTRICTS, cover);
    return [
      t.scopes.map((p) => [p.id, p.table.map((c) => [c.name, ...c.medals, c.total])]),
      t.rest.map((c) => [c.name, ...c.medals, c.total]),
    ];
  };
  assert.deepEqual(
    pageTables(byCover, byCover.defaults),
    [
      tables(byCover)
        .slice(0, 2)
        .map(([id, , clubs]) => [id, clubs]),
      [],
    ],
    "the defaults: the Worker's tables, nothing left",
  );
  assert.deepEqual(pageTables(body, [{ id: 'demy', cover: null }]), [
    [tables(body)[1]].map(([id, , clubs]) => [id, clubs]),
    [],
  ]);
  assert.deepEqual(
    pageTables(byCover, byCover.defaults.slice(0, 1))[1],
    rest(byCover.defaults.slice(0, 1)),
    'the alue alone: the rest is Muut lajit',
  );
  assert.deepEqual(medalTables(byCover, [], DEMO_DISTRICTS).rest, byCover.table, "nothing ticked: the meet's table");
  assert.deepEqual(
    pageTables(byCover, byCover.defaults, { ages: [13], events: null }),
    [
      [
        ['demolainen', []],
        ['demy', [['Testilän Kisa', 1, 1, 0, 2]]],
      ],
      [],
    ],
    'the chips: each table over the classes ticked',
  );
  assert.deepEqual(
    pageTables(byCover, [], { ages: [13], events: null })[1],
    [
      ['Harjoituspiirin Urheilijat', 1, 0, 0, 1],
      ['Mallikylän Vire', 1, 0, 0, 1],
      ['Testilän Kisa', 0, 1, 1, 2],
      ['Näyteniemen Vauhti', 0, 1, 0, 1],
    ],
    "and the meet's own table the same, guests and all",
  );
  assert.deepEqual(
    medalAges(byCover, byCover.defaults, DEMO_DISTRICTS),
    [11, 13, 15, 17, 19, 0],
    'the chips: the classes with a medal on the page',
  );
  // The country ticked with a piiri leaves the piiri nothing, as the alue
  // does. (Break on purpose: drop the country from medalStarts' `above`.)
  const smBody = meetMedalsBody(schedule, everything, DEMO_DISTRICTS, {
    name: 'Nuorten SM-kilpailut ja DemY:n pm-kisat',
    organiser: 'Demon Urheilijat',
  });
  assert.deepEqual(pageTables(smBody, ticks('sm', 'demy')), [
    [
      ['sm', tables(body)[0][2]],
      ['demy', []],
    ],
    [],
  ]);
  // A picked club's lines sum to its rows, and each opens its start. (Break
  // on purpose: ignore the chips, or link the first round.)
  const medalSum = (list) =>
    list.filter((x) => x.counted !== false).reduce((t, x) => t.map((n, i) => n + x.medals[i]), [0, 0, 0]);
  for (const [ticked, cover] of [
    [byCover.defaults, null],
    [[], null],
    [byCover.defaults, { ages: [13], events: null }],
  ]) {
    const t = medalTables(byCover, ticked, DEMO_DISTRICTS, cover);
    const rows = [...t.scopes.flatMap((p) => p.table), ...t.rest];
    for (const [id, name] of byCover.names) {
      const lines = clubMedalStarts(byCover, ticked, DEMO_DISTRICTS, cover, id, schedule);
      assert.deepEqual(
        medalSum(lines),
        medalSum(rows.filter((c) => c.id === id)),
        `${name}: the lines sum to its rows`,
      );
      assert.ok(
        lines.every((l) => l.link),
        `${name}: every line opens its start`,
      );
    }
  }
  // The picked club's medalists are a box per person and one for its relays,
  // summing to its lines. (Break on purpose: drop the key from a body's
  // medal, and the relays and the people share one box.)
  for (const [ticked, cover] of [
    [byCover.defaults, null],
    [[], { ages: [13], events: null }],
  ]) {
    for (const [id, name] of byCover.names) {
      const boxes = clubMedalists(byCover, ticked, DEMO_DISTRICTS, cover, id, schedule);
      const lines = clubMedalStarts(byCover, ticked, DEMO_DISTRICTS, cover, id, schedule);
      assert.deepEqual(medalSum(boxes), medalSum(lines), `${name}: the boxes sum to its lines`);
      assert.ok(
        boxes.every(
          (b) =>
            b.name &&
            b.lines.filter((l) => l.counted).length === b.medals[0] + b.medals[1] + b.medals[2] &&
            b.lines.every((l) => l.link),
        ),
        `${name}: every box named, a counted line a medal`,
      );
      for (const l of lines) {
        assert.deepEqual(
          l.names.toSorted(),
          boxes
            .filter((b) => b.athleteId && b.lines.some((x) => x.event === l.event))
            .map((b) => b.name)
            .toSorted(),
          `${name} ${l.event}: its medalists`,
        );
      }
    }
  }
  const vauhti = clubMedalists(body, [], DEMO_DISTRICTS, null, '4', schedule);
  assert.deepEqual(
    vauhti.filter((b) => !b.athleteId).map((b) => [b.name, ...b.medals, b.lines.map((l) => [l.medal, l.event])]),
    [
      [
        'Näyteniemen Vauhti',
        2,
        1,
        0,
        [
          [1, 'M/N 4x100m aitaviesti'],
          [1, 'Mixed 15 4x400m viesti'],
          [2, 'N15 4x400m viesti'],
        ],
      ],
    ],
    "the relays: the club's one box",
  );
  assert.deepEqual(
    clubMedalStarts(body, [], DEMO_DISTRICTS, null, '1', schedule).find((l) => l.event === 'T11 60m').names,
    ['Lotta Näytteinen', 'Venla Mallinen'],
    "a class's medalists by medal",
  );
  // A relay of 17–22 is filed at 22 (filedStart, 18913). Its line shows under
  // the 17 chip too and counts under 22 alone.
  const relayBody = {
    scopes: [],
    names: [['1', 'Demon Urheilijat']],
    athletes: [['k1', 'Aino Esimerkki']],
    starts: [
      {
        start: { EventName: '6 x 400 m - mixed', Age: '22' },
        medals: [
          ['1', 1],
          ['1', 3],
        ],
        scoped: [],
      },
      { start: { EventName: 'N17 60m', Age: '17' }, medals: [['1', 2, 'k1']], scoped: [] },
      { start: { EventName: 'M22 60m', Age: '22' }, medals: [['2', 1]], scoped: [] },
    ],
  };
  const relayLines = (ages) =>
    clubMedalStarts(relayBody, [], DEMO_DISTRICTS, ages && { ages, events: null }, '1', {}).map((l) => [
      l.event,
      ...l.medals,
      l.counted,
      l.only,
    ]);
  assert.deepEqual(relayLines([17]), [
    ['6 x 400 m - mixed', 1, 0, 1, false, 22],
    ['N17 60m', 0, 1, 0, true, null],
  ]);
  assert.deepEqual(relayLines([22]), [['6 x 400 m - mixed', 1, 0, 1, true, 22]]);
  assert.deepEqual(
    relayLines(null).map((l) => l.slice(-2)),
    [
      [true, null],
      [true, null],
    ],
  );
  assert.deepEqual(
    clubMedalists(relayBody, [], DEMO_DISTRICTS, { ages: [17], events: null }, '1', {}).map((b) => [
      b.name,
      ...b.medals,
      b.lines.length,
    ]),
    [
      ['Aino Esimerkki', 0, 1, 0, 1],
      ['Demon Urheilijat', 0, 0, 0, 2],
    ],
    "the relays' box lists them, counting none under 17",
  );
  // A picked club's year has a line per class, and a meet's counted medals sum
  // to the club's row. (Break on purpose: count an uncounted line.)
  const relayYear = [{ id: 'm1', date: '2026-02-20', cover: null, ...relayBody }];
  assert.deepEqual(
    medalSeasonClubMeets(relayYear, '1', { ages: [17], events: null }).map((m) => [
      m.key,
      ...m.medals,
      m.lines.map((l) => [l.event, l.medals.join(''), l.names.join(), l.only]),
    ]),
    [
      [
        'm1',
        0,
        1,
        0,
        [
          ['6 x 400 m - mixed', '101', '', 22],
          ['N17 60m', '010', 'Aino Esimerkki', null],
        ],
      ],
    ],
  );
  assert.deepEqual(
    medalSeasonClubMeets(relayYear, '2', { ages: [17], events: null }),
    [],
    'a club without a line there: no meet',
  );
  const linkOf = (name) =>
    clubMedalStarts(
      { starts: [{ start: { EventName: name }, medals: [['x', 1]], scoped: [] }], scopes: [] },
      [],
      DEMO_DISTRICTS,
      null,
      'x',
      schedule,
    )[0].link;
  const final200 = Object.values(schedule)
    .flat()
    .find((r) => r.EventName === 'N 200m' && r.Name === 'Loppukilpailu');
  assert.deepEqual(
    linkOf('N 200m'),
    { kind: 'group', key: roundGroupKey(final200) },
    'heats, semis and a final: the final',
  );
  assert.deepEqual(
    linkOf('T9 3-ottelu'),
    { kind: 'combined', key: 'T9 3-ottelu' },
    'a multi-event opens its standings',
  );
  // `scoped` holds a scope's medals per start with it alone ticked, so a year
  // sums them without the meet's defaults.
  const scopedTable = (b, id, keep = () => true) =>
    medalTable(
      b.starts.filter(keep).flatMap((s) => medalRowsOf(s.scoped.find(([sid]) => sid === id)?.[1], new Map(b.names))),
    );
  assert.deepEqual(
    body.scopes.map((p) => [p.id, scopedTable(body, p.id)]),
    body.scopes.map((p) => [p.id, p.table]),
    "no defaults: each scope's starts sum to its own table",
  );
  assert.deepEqual(
    scopedTable(byCover, 'demy', (s) => !coversStart(byCover.defaults[0].cover, s.start)),
    byCover.scopes[1].table,
    "the piiri's starts outside the alue's cover sum to its table",
  );
  assert.deepEqual(byCover.starts, body.starts, 'the defaults change no start');
  const aidat = body.starts.find((s) => s.start.EventName === 'M 400m aidat');
  const pairs = (medals) => medals.map(([club, medal]) => [club, medal]);
  assert.deepEqual(pairs(aidat.medals), [
    ['1', 2],
    ['2', 1],
  ]);
  assert.deepEqual(
    pairs(aidat.scoped.find(([id]) => id === 'demy')[1]),
    [['1', 1]],
    "the meet's silver is the piiri's gold",
  );
  // (Break on purpose: tick the defaults with the scope, or add a scoped
  // medal only to a start the official pass found.)
  const [aidatDay] = Object.entries(schedule).find(([, list]) => list.some((r) => r.Id === 'r7'));
  const guestFinal = JSON.parse(JSON.stringify(DEMO_EVENTS.e7));
  const [leevi, roope] = guestFinal.Rounds[0].Heats[0].Allocations;
  guestFinal.Rounds[0].Heats[0].Allocations = [1, 2, 3]
    .map((rank) => ({ ...roope, Id: `g${rank}`, ResultRank: rank, NotInCompetition: true }))
    .concat({ ...leevi, ResultRank: 4 });
  const guests = meetMedalsBody(
    { [aidatDay]: schedule[aidatDay].filter((r) => r.Id === 'r7') },
    [{ eventId: 'e7', data: guestFinal }],
    DEMO_DISTRICTS,
  );
  assert.deepEqual(
    guests.starts.map((s) => [s.medals, s.scoped.map(([id, m]) => [id, pairs(m)])]),
    [
      [
        [],
        [
          ['demolainen', [['1', 1]]],
          ['demy', [['1', 1]]],
        ],
      ],
    ],
    "guests on the whole podium: no official medal, and the scopes' own",
  );
  assert.deepEqual(guests.table, [], "the meet's table drops the club");
  assert.deepEqual(
    guests.names,
    [
      ['2', 'Mallikylän Vire'],
      ['1', 'Demon Urheilijat'],
    ],
    'and the names still carry it',
  );
  // A year sums each meet's record under one scope per club. The two demo
  // meets stand for two meets of one year.
  const record = medalSeasonRecord(body, 1, '2026-06-06');
  assert.deepEqual(
    [record.closed, medalSeasonRecord(closedBody, 1, '2026-06-06').closed],
    [null, ['demy', 'maly']],
    "the body's closed pair rides on the record",
  );
  assert.deepEqual(Object.keys(record.starts[0]), ['start', 'scoped'], "the record keeps the scopes' medals alone");
  assert.deepEqual(record.athletes, body.athletes, "and its medalists, for a club's year");
  const cupSchedule = demoSchedule(DEMO_CUP_ID);
  const cupRecord = medalSeasonRecord(
    meetMedalsBody(cupSchedule, demoCupEventResults(), DEMO_DISTRICTS),
    1,
    '2026-06-07',
  );
  const year = (
    id,
    chips,
    cover = null,
    recs = [
      [DEMO_ID, record],
      [DEMO_CUP_ID, cupRecord],
    ],
  ) =>
    medalSeasonTable(
      recs.map(([mid, r]) => ({ id: mid, starts: scopeMedalStarts(r, id, cover), names: r.names })),
      chips,
    );
  const yearLines = (t) => t.map((c) => [c.name, ...c.medals, c.total, c.meets.map((m) => [m.id, ...m.medals])]);
  assert.deepEqual(yearLines(year('demy')), [
    [
      'Demon Urheilijat',
      11,
      5,
      2,
      18,
      [
        [DEMO_ID, 7, 3, 1],
        [DEMO_CUP_ID, 4, 2, 1],
      ],
    ],
    [
      'Testilän Kisa',
      9,
      8,
      0,
      17,
      [
        [DEMO_ID, 7, 5, 0],
        [DEMO_CUP_ID, 2, 3, 0],
      ],
    ],
  ]);
  assert.deepEqual(
    year('demy', null, null, [[DEMO_ID, record]]).map(({ meets, ...c }) => c),
    body.scopes[1].table,
    "one meet: the scope's own table",
  );
  // (Break on purpose: drop the chips' filter, or the cover's.)
  assert.deepEqual(
    yearLines(year('demy', { ages: [13], events: null })),
    [
      ['Demon Urheilijat', 2, 0, 0, 2, [[DEMO_CUP_ID, 2, 0, 0]]],
      [
        'Testilän Kisa',
        1,
        3,
        0,
        4,
        [
          [DEMO_ID, 1, 1, 0],
          [DEMO_CUP_ID, 0, 2, 0],
        ],
      ],
    ],
    'the age chips: a meet with no medal in them is no line',
  );
  assert.deepEqual(
    year('demolainen', null, byCover.defaults[0].cover, [[DEMO_ID, medalSeasonRecord(byCover, 1, '2026-06-06')]]).map(
      ({ meets, ...c }) => c,
    ),
    byCover.scopes[0].table,
    "the meet's cover for the scope: its table under the name",
  );
  // A Worker's meet carries its cover unapplied. (Break on purpose: make
  // medalSeasonStarts ignore it.)
  const onMeet = (id, cover, recs) =>
    recs.map(([mid, r]) => ({ id: mid, cover, starts: scopeMedalStarts(r, id), names: r.names, athletes: r.athletes }));
  assert.deepEqual(
    medalSeasonTable(
      onMeet('demolainen', byCover.defaults[0].cover, [[DEMO_ID, medalSeasonRecord(byCover, 1, '2026-06-06')]]),
    ).map(({ meets, ...c }) => c),
    byCover.scopes[0].table,
    'the cover on the meet is the cover passed',
  );
  // (Break on purpose: keep the alue's starts in medalSeasonStarts.)
  const belowAlue = onMeet('demy', null, [[DEMO_ID, medalSeasonRecord(byCover, 1, '2026-06-06')]]).map((m) => ({
    ...m,
    above: byCover.defaults[0].cover,
  }));
  assert.deepEqual(
    medalSeasonTable(belowAlue).map(({ meets, ...c }) => c),
    byCover.scopes[1].table,
    "the piiri under its alue's cover: the medal page's table",
  );
  assert.deepEqual(medalSeasonAges(belowAlue), [11, 13, 0], "and the chips lose the alue's classes");
  const allAges = medalSeasonAges(
    onMeet('demy', null, [
      [DEMO_ID, record],
      [DEMO_CUP_ID, cupRecord],
    ]),
  );
  assert.deepEqual(allAges, [11, 13, 15, 17, 19, 0], 'the ages medalled in, in class order');
  assert.deepEqual(
    medalSeasonAges([
      ...onMeet('demy', { ages: [13], events: null }, [[DEMO_ID, record]]),
      { id: 'x', cover: null, starts: null },
    ]),
    [13],
    "a meet's cover narrows its chips, and an unbuilt meet has none",
  );
  // (Break on purpose: always narrow in medalSeasonMeetAges, or skip the alue.)
  assert.deepEqual(
    medalSeasonMeetAges(belowAlue[0], medalSeasonAges(belowAlue)),
    [11, 13, 0],
    "a row narrows a meet the alue shares to the year's chips",
  );
  assert.deepEqual(
    medalSeasonMeetAges(onMeet('demy', null, [[DEMO_ID, record]])[0], allAges),
    [],
    'and opens one the chips hold whole with none',
  );
  assert.deepEqual(
    [null, { ages: [13], events: null }].map((cover) => medalSeasonMeetAges({ id: 'x', cover, starts: null }, [13])),
    [[], [13]],
    'an unbuilt meet narrows only where its cover may',
  );
  assert.deepEqual(
    medalSeasonMeetAges({ id: 'x', cover: null, above: null, starts: null }, [13]),
    [13],
    "or its alue's",
  );
  // (Break on purpose: let an unbuilt meet always hold, or ignore the chips.)
  const [built] = onMeet('demy', null, [[DEMO_ID, record]]);
  const unbuilt = { id: 'x', cover: { ages: [13], events: null }, starts: null };
  assert.deepEqual(
    [null, [13], [9]].map((ages) => medalSeasonMeetHolds(built, ages && { ages, events: null })),
    [true, true, false],
    'a built meet holds under the chips it took a medal in',
  );
  assert.deepEqual(
    [[13, 9], [9]].map((ages) => medalSeasonMeetHolds(unbuilt, { ages, events: null })),
    [true, false],
    'an unbuilt meet holds unless its cover leaves every chosen age out',
  );
  assert.deepEqual(
    [[13], [9], [13, 9]].map((ages) =>
      medalSeasonMeetHolds({ ...unbuilt, cover: null, above: { ages: [13], events: null } }, { ages, events: null }),
    ),
    [false, true, true],
    'or its alue takes every chosen age whole',
  );
  assert.equal(
    medalSeasonMeetHolds(
      { ...unbuilt, cover: null, above: { ages: [13], events: ['viestit'] } },
      { ages: [13], events: null },
    ),
    true,
    'an alue taking an event alone leaves the age',
  );
  assert.deepEqual(
    medalSeasonTable([
      { id: DEMO_ID, starts: null, names: [] },
      ...[[DEMO_CUP_ID, cupRecord]].map(([mid, r]) => ({
        id: mid,
        starts: scopeMedalStarts(r, 'maly'),
        names: r.names,
      })),
    ]).map((c) => [c.name, ...c.medals]),
    [
      ['Mallikylän Vire', 3, 1, 0],
      ['Näyteniemen Vauhti', 3, 1, 0],
    ],
    'a meet not built yet counts nothing',
  );
  // A club's year of medalists sums to its row. A person is one box by
  // licence, or by name where a row has none. (Break on purpose: box by the
  // meet's own key, or drop the name's fallback.)
  const demyYear = onMeet('demy', null, [
    [DEMO_ID, record],
    [DEMO_CUP_ID, cupRecord],
  ]);
  for (const cover of [null, { ages: [13], events: null }]) {
    for (const c of medalSeasonTable(demyYear, cover)) {
      assert.deepEqual(
        medalSum(medalSeasonMedalists(demyYear, c.id, cover)),
        c.medals,
        `${c.name}: the medalists sum to its row`,
      );
      assert.deepEqual(
        medalSum(medalSeasonClubMeets(demyYear, c.id, cover)),
        c.medals,
        `${c.name}: its meets sum to its row`,
      );
    }
  }
  const yearMeet = (id, date, athletes, medals) => ({
    id,
    date,
    cover: null,
    names: [
      ['1', 'Demon Urheilijat'],
      ['2', 'Mallikylän Vire'],
    ],
    athletes,
    starts: [{ start: { EventName: 'P13 60m', Age: '13' }, medals }],
  });
  const moved = [
    yearMeet(
      'm1',
      '2026-05-01',
      [
        ['k1', 'Aino Esimerkki', '111'],
        ['k2', 'Eero Esimerkki', '222'],
      ],
      [
        ['1', 1, 'k1'],
        ['1', 2, 'k2'],
        ['1', 3, 'o1'],
      ],
    ),
    yearMeet('m2', '2026-06-01', [['k7', 'Aino Esimerkki', null]], [['1', 2, 'k7']]),
    yearMeet(
      'm3',
      '2026-07-01',
      [
        ['k4', 'aino  esimerkki', '111'],
        ['k5', 'Eero Esimerkki', '222'],
      ],
      [
        ['1', 1, 'k4'],
        ['2', 1, 'k5'],
      ],
    ),
  ];
  assert.deepEqual(
    medalSeasonMedalists(moved, '1').map((b) => [
      b.name,
      b.athlete,
      ...b.medals,
      b.lines.map((l) => `${l.medal}:${l.meet}`),
    ]),
    [
      ['Aino Esimerkki', true, 2, 1, 0, ['1:m1', '1:m3', '2:m2']],
      ['Eero Esimerkki', true, 0, 1, 0, ['2:m1']],
      ['Demon Urheilijat', false, 0, 0, 1, ['3:m1']],
    ],
    "one person across meets, a row without a licence by its name; the relays the club's",
  );
  assert.deepEqual(
    medalSeasonMedalists(moved, '2').map((b) => [b.name, ...b.medals]),
    [['Eero Esimerkki', 1, 0, 0]],
    'a club change: each club its own medals',
  );
  // A person is followed across clubs, and a relay names nobody. A followed
  // club gets its own lines and relays. (Break on purpose: keep a followed
  // club's whole box, or drop its unnamed rows.)
  const followedOf = (licences, clubIds) =>
    medalSeasonFollowedMedalists(moved, { licences: new Set(licences), clubIds: new Set(clubIds) }).map((b) => [
      b.name,
      ...b.medals,
      b.lines.map((l) => `${l.medal}:${l.meet}`),
    ]);
  assert.deepEqual(
    followedOf(['222', '111', '1'], []),
    [
      ['Aino Esimerkki', 2, 1, 0, ['1:m1', '1:m3', '2:m2']],
      ['Eero Esimerkki', 1, 1, 0, ['1:m3', '2:m1']],
    ],
    'a club change is still one person',
  );
  assert.deepEqual(followedOf([], ['2']), [['Eero Esimerkki', 1, 0, 0, ['1:m3']]], 'a followed club: its lines alone');
  assert.deepEqual(
    followedOf([], ['1']),
    [
      ['Aino Esimerkki', 2, 1, 0, ['1:m1', '1:m3', '2:m2']],
      ['Eero Esimerkki', 0, 1, 0, ['2:m1']],
      ['Demon Urheilijat', 0, 0, 1, ['3:m1']],
    ],
    'and its relays',
  );
  assert.deepEqual(followedOf([], []), [], 'nothing followed');
  // A medal body is cached five minutes while its meet can move, and a week
  // once it is over. A record settles after a month (docs/backend.md). (Break
  // on purpose: use one TTL for both.)
  const ttls = { live: 300, past: 7 * 24 * 60 * 60 };
  assert.deepEqual(
    [
      ['2026-09-15', '2026-09-16'],
      ['2026-09-16', '2026-09-16'],
      ['2026-09-20', '2026-09-16'],
      [null, '2026-09-16'],
    ].map(([last, today]) => cacheTtlFor(last, today, ttls)),
    [ttls.past, ttls.live, ttls.live, ttls.live],
  );
  assert.deepEqual(
    [
      ['2026-08-16', '2026-09-16'],
      ['2026-08-18', '2026-09-16'],
      ['2026-09-16', '2026-09-16'],
      [null, '2026-09-16'],
    ].map(([last, today]) => recordSettled(last, today)),
    [true, false, false, false],
  );
  // The cron warms each scope's meets of the year once, none still to come.
  // (Break on purpose: warm the whole index.)
  const indexRows = [
    { id: 1, name: 'DemY:n pm-kisat', date: '2026-05-01', organizationName: 'Demon Urheilijat' },
    { id: 2, name: 'Demolaisen aluemestaruus', date: '2026-06-01', organizationName: 'Demon Urheilijat' },
    { id: 3, name: 'Avoimet kisat', date: '2026-06-02', organizationName: 'Demon Urheilijat' },
    { id: 4, name: 'DemY:n pm-viestit', date: '2026-12-01', organizationName: 'Demon Urheilijat' },
    { id: 5, name: 'Seuracup I', date: '2026-05-20', organizationName: 'Demon Urheilijat' },
    { id: 6, name: 'Seuracup III', date: '2026-10-01', organizationName: 'Demon Urheilijat' },
  ];
  assert.deepEqual(
    warmSeasonMeets(indexRows, 2026, DEMO_DISTRICTS, '2026-09-16').map((m) => [m.id, m.kind]),
    [
      ['1', undefined],
      ['5', 'osa'],
      ['2', undefined],
    ],
    'the championships and cup meets that have run, oldest first, each once',
  );
  assert.deepEqual(warmSeasonMeets(indexRows, 2025, DEMO_DISTRICTS, '2026-09-16'), [], 'another year');
  // A build round stops at its count or its time budget, but always makes its
  // first build (docs/backend.md). (Break on purpose: drop the budget, or the
  // first build.)
  assert.deepEqual(
    [
      [0, 0],
      [0, 13_000],
      [3, 100],
      [4, 100],
      [3, 12_000],
    ].map(([n, ms]) => buildRoundGoesOn(n, ms, { limit: 4, budgetMs: 12_000 })),
    [true, true, true, false, false],
  );
  // The medalist rows start open only on a short list.
  assert.deepEqual(
    [0, 12, 13].map((n) => medalistsOpenAll(Array.from({ length: n }, (_, i) => ({ key: `k${i}` })))),
    [true, true, false],
  );
  // A year's meets are the index rows that defaultScopes gives the scope, in
  // date order with their covers. (Break on purpose: drop the year's filter,
  // or read every scope's meet.)
  const alueAges = { ages: [14, 15, 16, 17, 18, 19, 20, 21, 22, 0], events: null };
  const index = [
    { id: '30005', name: 'DemY:n pm-viestit', date: '2026-08-20', organizationName: 'Testilän Kisa' },
    {
      id: '30006',
      name: 'Demolaisen alueen am- ja DemY:n pm-kilpailut',
      date: '2026-07-15',
      organizationName: 'Demon Urheilijat',
    },
    {
      id: '30004',
      name: 'Demolaisen alueen aluemestaruuskilpailut 14-15v',
      date: '2026-07-01',
      organizationName: 'Mallikylän Vire',
    },
    { id: '30003', name: 'Piirinmestaruuskilpailut 9-13v', date: '2026-06-10', organizationName: 'Demon Urheilijat' },
    { id: '30002', name: 'MalY:n pm-kilpailut', date: '2026-06-10', organizationName: 'Mallikylän Vire' },
    { id: '30001', name: 'Kevätkisat', date: '2026-05-01', organizationName: 'Demon Urheilijat' },
    { id: '30000', name: 'DemY:n pm-kilpailut', date: '2025-06-01', organizationName: 'Demon Urheilijat' },
    {
      id: '29999',
      name: 'Piirinmestaruuskilpailut',
      date: '2026-06-01',
      organizationName: 'Harjoituspiirin Urheilijat',
    },
    { id: '30007', name: 'SM-kilpailut M/N 14-15', date: '2026-08-01', organizationName: 'Harjoituspiirin Urheilijat' },
  ];
  // A meet over with no medal has its results elsewhere (18962, 19104). One
  // built on its last day may yet get them. (Break on purpose: drop the day's
  // check, and the second answers true.)
  const at = (day) => Date.parse(`${day}T12:00:00Z`);
  assert.equal(medalSeasonMeetEmpty({ builtAt: at('2026-04-26'), lastDay: '2026-04-25', starts: [] }), true);
  assert.equal(
    medalSeasonMeetEmpty({ builtAt: at('2026-04-25'), lastDay: '2026-04-25', starts: [] }),
    false,
    'built on its last day',
  );
  assert.equal(
    medalSeasonMeetEmpty({ builtAt: at('2026-04-26'), lastDay: '2026-04-25', starts: [{ start: {}, scoped: [] }] }),
    false,
    'a medal outside the scope is a result',
  );
  assert.equal(medalSeasonMeetEmpty(null), false, 'not built');
  assert.deepEqual(
    medalSeasonMeets(index, 'sm', 2026, DEMO_DISTRICTS),
    [{ id: '30007', name: 'SM-kilpailut M/N 14-15', date: '2026-08-01', cover: { ages: [14, 15], events: null } }],
    "the country's year: its SM meets, whoever organises",
  );
  assert.deepEqual(
    medalSeasonMeets(index, 'demy', 2026, DEMO_DISTRICTS),
    [
      {
        id: '30003',
        name: 'Piirinmestaruuskilpailut 9-13v',
        date: '2026-06-10',
        cover: { ages: [9, 10, 11, 12, 13], events: null },
      },
      {
        id: '30006',
        name: 'Demolaisen alueen am- ja DemY:n pm-kilpailut',
        date: '2026-07-15',
        cover: null,
        above: alueAges,
      },
      { id: '30005', name: 'DemY:n pm-viestit', date: '2026-08-20', cover: { ages: null, events: ['viestit'] } },
    ],
    "the organiser's piiri by its names, the named one, no other year, no club outside the file; the alue's cover above a meet of both",
  );
  assert.deepEqual(
    medalSeasonMeets(index, 'demolainen', '2026', DEMO_DISTRICTS).map((m) => [m.id, m.cover, m.above]),
    [
      ['30004', { ages: [14, 15], events: null }, undefined],
      ['30006', alueAges, undefined],
    ],
    'an alue, nothing above it',
  );
  // A meet elsewhere.json lists is on the country's year, and an unlisted
  // one of the same name is not. (Break on purpose: drop `elsewhere` from
  // medalSeasonMeets' defaultScopes call.)
  const mestaruus = [
    { id: '30008', name: 'Mestaruuskisat', date: '2026-08-05' },
    { id: '30009', name: 'Mestaruuskisat', date: '2026-08-06' },
  ];
  const listed = { meets: [{ comp: 30008, t4r: '2026/mestaruuskisat' }] };
  assert.deepEqual(
    medalSeasonMeets([...index, ...mestaruus], 'sm', 2026, DEMO_DISTRICTS, listed).map((m) => [m.id, m.cover]),
    [
      ['30007', { ages: [14, 15], events: null }],
      ['30008', null],
    ],
  );
  assert.deepEqual(
    warmSeasonMeets(mestaruus, 2026, DEMO_DISTRICTS, '2026-09-16', listed).map((m) => m.id),
    ['30008'],
    'the cron warms it',
  );
  assert.deepEqual(warmSeasonMeets(mestaruus, 2026, DEMO_DISTRICTS, '2026-09-16'), []);
  // A row that stands alone is a meet of its year.
  // (Break on purpose: drop `alone` from medalSeasonMeets.)
  const alone = { meets: [DEMO_ROAD_ROW] };
  assert.deepEqual(
    medalSeasonMeets(index, 'sm', 2026, DEMO_DISTRICTS, alone).map((m) => [m.id, m.cover]),
    [
      ['30007', { ages: [14, 15], events: null }],
      ['maraton-2026', null],
    ],
  );
  assert.deepEqual(
    [
      medalSeasonMeets(index, 'demy', 2026, DEMO_DISTRICTS, alone).some((m) => m.id === 'maraton-2026'),
      medalSeasonMeets([], 'sm', 2025, DEMO_DISTRICTS, alone),
    ],
    [false, []],
  );
  assert.deepEqual(
    warmSeasonMeets([], 2026, DEMO_DISTRICTS, '2026-09-16', alone).map((m) => m.id),
    ['maraton-2026'],
  );
  assert.deepEqual(medalSeasonMeets(index, 'maly', 2025, DEMO_DISTRICTS), []);
  assert.deepEqual(medalSeasonMeets(null, 'demy', 2026, DEMO_DISTRICTS), []);
  // A row's closed pair puts the meet on the partner's year too (20828).
  // (Break on purpose: leave the row's pair unread, and maly loses 30005.)
  const pairedIndex = index.map((m) => (m.id === '30005' ? { ...m, closed: ['demy', 'maly'] } : m));
  assert.deepEqual(
    medalSeasonMeets(index, 'maly', 2026, DEMO_DISTRICTS).map((m) => m.id),
    ['30002'],
  );
  assert.deepEqual(
    medalSeasonMeets(pairedIndex, 'maly', 2026, DEMO_DISTRICTS).map((m) => [m.id, m.cover]),
    [
      ['30002', null],
      ['30005', { ages: null, events: ['viestit'] }],
    ],
  );
  assert.deepEqual(
    medalSeasonMeets(pairedIndex, 'demy', 2026, DEMO_DISTRICTS),
    medalSeasonMeets(index, 'demy', 2026, DEMO_DISTRICTS),
  );
  // A year's cup meets are found by name and filed under the organiser's
  // piiri (docs/tuloslista-api.md). (Break on purpose: take the organiser
  // alone, leave a final its piiri, or allow no space in "9 v.")
  const cupIndex = [
    {
      id: '30101',
      name: 'Pohjola Seuracup Piirikisa I - EKY, KYMY, LASY',
      date: '2026-06-02',
      organizationName: 'Koejärven Urheilijat',
    },
    { id: '30102', name: 'Seuracup 2 Ykköslohko 9v lajit', date: '2026-06-10', organizationName: 'Otantalan Jyske' },
    { id: '30103', name: 'Seuracup II Pohjoislohko 9-sarjat', date: '2026-06-10', organizationName: 'Otantalan Jyske' },
    { id: '30108', name: 'Seuracup 1, Ykköslohko 9 v. lajit', date: '2026-06-10', organizationName: 'Otantalan Jyske' },
    {
      id: '30104',
      name: 'Seuracup I Etelälohko 9-vuotiaiden lajit',
      date: '2026-05-20',
      organizationName: 'Otantalan Jyske',
    },
    { id: '30105', name: 'Pohjola Seuracup A-sarjan finaali', date: '2026-08-29', organizationName: 'Mittalan Veikot' },
    { id: '30106', name: 'Föreningscup I', date: '2026-05-20', organizationName: 'IF Prov / IK Mönster' },
    { id: '30107', name: 'Helsy:n pm-kilpailut', date: '2026-06-01', organizationName: 'Mittalan Veikot' },
    { id: '30100', name: 'Pohjola Seuracup 9v lajit', date: '2025-06-01', organizationName: 'Otantalan Jyske' },
  ];
  assert.deepEqual(
    cupSeasonMeets(cupIndex, 2026, inventedDistricts).map((m) => [m.id, m.date, m.kind, m.piirit]),
    [
      ['30104', '2026-05-20', 'nines', ['varsy']],
      ['30106', '2026-05-20', 'osa', ['oid']],
      ['30101', '2026-06-02', 'osa', ['eky', 'kymy', 'lasy']],
      ['30102', '2026-06-10', 'nines', ['varsy']],
      ['30103', '2026-06-10', 'nines', ['varsy']],
      ['30108', '2026-06-10', 'nines', ['varsy']],
      ['30105', '2026-08-29', 'final', []],
    ],
    "the cup's alone, in date order: the organiser's piiri and the named ones, once each; no other year",
  );
  assert.equal(
    cupSeasonMeets(cupIndex, 2026, inventedDistricts)[6].organiser,
    'Mittalan Veikot',
    'a final names its organiser',
  );
  assert.deepEqual(cupSeasonMeets(cupIndex, '2026', inventedDistricts)[1], {
    id: '30106',
    name: 'Föreningscup I',
    date: '2026-05-20',
    kind: 'osa',
    piirit: ['oid'],
  });
  assert.deepEqual(cupSeasonMeets(null, 2026, inventedDistricts), []);
  // A meet links to its year under the organiser's piiri among those named,
  // and a final to its tab. (Break on purpose: take the first piiri named,
  // and the first row opens on EKY.)
  const upOf = (name, organizationName, date = '2026-06-02') =>
    cupSeasonHref({ name, organizationName, date }, inventedDistricts);
  assert.deepEqual(
    [
      upOf('Pohjola Seuracup Piirikisa I - EKY, KYMY, LASY', 'Aihiolan Riento'),
      upOf('Seuracup 2 Ykköslohko 9v lajit', 'Otantalan Jyske', '2025-06-10'),
      upOf('Pohjola Seuracup A-sarjan finaali', 'Mittalan Veikot', '2026-08-29'),
      upOf('Föreningscup I', 'Tuntematon seura'),
      upOf('Helsy:n pm-kilpailut', 'Mittalan Veikot'),
    ],
    ['/seuracup#/lasy/2026', '/seuracup#/varsy/2025', '/seuracup#/finaalit/2026', '/seuracup#/osakilpailut/2026', null],
  );
  assert.equal(cupSeasonHref(null, inventedDistricts), null);
  assert.deepEqual(
    cupSeasonPiirit(cupSeasonMeets(cupIndex, 2026, inventedDistricts), inventedDistricts).map((t) => [
      t.alue.id,
      t.piirit.map((p) => p.id),
    ]),
    [
      ['etelainen', ['eky', 'kymy', 'lasy']],
      ['lounainen', ['varsy']],
      ['lantinen', ['oid']],
    ],
    'each piiri once under its alue, a final adding none, no alue without one',
  );
  assert.deepEqual(cupSeasonPiirit(null, inventedDistricts), []);
  // seuracup.json holds a club once however spelt, trimmed and in a piiri of
  // districts.json.
  const seriesKeys = (f) => Object.values(f.series).flat().map(clubNameKey);
  const distinct = (f) => new Set(seriesKeys(f)).size === seriesKeys(f).length;
  assert.deepEqual(Object.keys(seuracup.series), ['A', 'B', 'C']);
  assert.ok(distinct(seuracup), 'the three lists disjoint, no club twice');
  assert.ok(
    Object.values(seuracup.series)
      .flat()
      .every((n) => typeof n === 'string' && n && n === n.trim()),
    'every name trimmed',
  );
  const piiriNames = new Set(districts.piirit.flatMap((p) => p.names || []).map(clubNameKey));
  assert.deepEqual(
    Object.values(seuracup.series)
      .flat()
      .filter((n) => !piiriNames.has(clubNameKey(n))),
    [],
    'every club in a piiri',
  );
  const seriesOf = cupSeries(seuracup);
  assert.equal(seriesOf(seuracup.series.B[0]), 'B');
  assert.equal(seriesOf(seuracup.series.C[0].toUpperCase()), 'C', 'the name folded');
  assert.equal(seriesOf('Demon Urheilijat'), null);
  assert.equal(cupSeries(null)('Demon Urheilijat'), null);
  {
    // (Break on purpose: a club under a second series, spelt its own way.)
    const f = JSON.parse(JSON.stringify(seuracup));
    f.series.C.push(`${f.series.A[0]} ry`);
    assert.equal(distinct(f), false);
  }
  assert.deepEqual(
    yearLines(year('demy', { ages: null, events: ['400m aidat'] })),
    [['Demon Urheilijat', 1, 0, 0, 1, [[DEMO_ID, 1, 0, 0]]]],
    "an event cover is a chip's filter too",
  );
  // The years are this and last, none before the index's floor.
  assert.deepEqual(seasonYears('2026-09-15'), [2026, 2025]);
  assert.deepEqual(seasonYears('2025-03-01'), [SEASON_FIRST_YEAR]);
  assert.ok(seasonYearOk('2025', '2026-09-15') && seasonYearOk(2026, '2026-09-15'));
  for (const y of ['2024', '2027', '26', '2026x', null]) assert.equal(seasonYearOk(y, '2026-09-15'), false, `${y}`);
  assert.deepEqual(tickedScopes(null, byCover.defaults), byCover.defaults);
  assert.deepEqual(
    tickedScopes(
      [
        { id: 'maly', cover: null },
        { id: 'demolainen', cover: null },
      ],
      byCover.defaults,
    ),
    [{ id: 'maly', cover: null }, byCover.defaults[0]],
    'a chosen default keeps its cover, any other the whole meet',
  );
  const own = { id: 'demolainen', cover: { ages: [17], events: null } };
  assert.deepEqual(tickedScopes([own], byCover.defaults), [own], "a cover chosen by hand wins over the name's");
  // A cover chosen by hand picks from the meet's classes and events, with an
  // ottelu listed once. A list ticked whole is stored as null.
  const choices = meetCoverChoices(schedule);
  assert.deepEqual(
    choices.ages,
    [9, 11, 13, 15, 17, 19, 0, 50, 65],
    'the classes in class order, the adults after the youth',
  );
  // A cover reads a row's class off its event name, as the class filter
  // does, and not off the Age a masters' row is filed at
  // (docs/tuloslista-api.md). (Break on purpose: read startAge in
  // coversStart.)
  const m65 = Object.values(schedule)
    .flat()
    .find((r) => r.EventName === 'M65 60m aidat');
  assert.equal(coversStart({ ages: [65], events: null }, m65), true);
  assert.equal(coversStart({ ages: [50], events: null }, m65), false);
  // Temporary: a cover picked before 2026-09-27 names the row by the Age it
  // is filed at (docs/shims.md). (Break on purpose: drop `filed` in
  // coversStart.)
  assert.equal(coversStart({ ages: [30], events: null }, m65), true);
  assert.ok(
    choices.events.includes('3-ottelu') && !choices.events.some((e) => e.startsWith('3-ottelu ')),
    'an ottelu once, not a leg',
  );
  // So a cover of the ottelu holds its legs too. (Break on purpose: read the
  // leg's own event name in coversStart.)
  const leg = Object.values(schedule)
    .flat()
    .find((r) => / 3-ottelu /.test(r.EventName));
  assert.equal(coversStart({ ages: null, events: ['3-ottelu'] }, leg), true);
  assert.equal(
    new Set(choices.events.map((e) => e.toLowerCase().replace(/\s+/g, ''))).size,
    choices.events.length,
    'an event once',
  );
  assert.deepEqual(coverTicks(null, choices), choices, "the name's whole meet: everything");
  const viestit = coverTicks({ ages: [11, 13, 14], events: ['viestit'] }, choices);
  assert.deepEqual(viestit.ages, [11, 13], 'an age the meet has not is no chip');
  assert.ok(
    viestit.events.length > 1 && viestit.events.every((e) => e.includes('viesti')),
    'a family word ticks its every event',
  );
  assert.deepEqual(coverOfTicks(viestit, choices), { ages: [11, 13], events: viestit.events });
  assert.deepEqual(
    coverOfTicks(choices, choices),
    { ages: null, events: null },
    'ticked whole: every start, the ones to come too',
  );
  assert.deepEqual(
    coverOfTicks({ ages: [13, 9, 99], events: [] }, choices),
    { ages: [9, 13], events: [] },
    "in the meet's order, an age it has not dropped",
  );
  assert.equal(coverWords(null), 'kaikki lajit');
  assert.equal(coverWords({ ages: null, events: null }), 'kaikki lajit');
  assert.equal(coverWords({ ages: [15, 16, 17, 18, 19], events: null }), '15–19 v.');
  assert.equal(coverWords({ ages: [14, 15, 0, 9], events: ['10 000 m'] }), '9, 14–15 v., yleinen · 10 000 m');
  assert.equal(coverWords({ ages: [], events: [] }), 'ei sarjoja · ei lajeja');
  assert.equal(
    coverWords({ ages: null, events: ['100m', '200m', '400m', '800m', '1500m'] }),
    '5 lajia',
    'a long list is a count',
  );
  // Under a chosen piiri a followed club's rows rank within it, and a club
  // outside it draws no disc.
  const demyRows = followedRows(schedule, withRoots(two, roster), two, medalScope(DEMO_DISTRICTS, ticks('demy')));
  assert.deepEqual(
    medalTable(demyRows).map((c) => [c.name, ...c.medals]),
    [['Demon Urheilijat', 7, 3, 1]],
    'Demon Urheilijat under its piiri, and the other followed club, in the other piiri, has no medal line',
  );
  // A line's place is its rank within the piiri, so it agrees with the disc.
  const leeviUnder = demyRows.find((r) => r.name === 'Leevi Mittainen' && r.event === 'M 400m aidat');
  assert.equal(leeviUnder.alloc.ResultRank, 2);
  assert.equal(leeviUnder.medal, 1);
  assert.equal(leeviUnder.place, '1.');
  assert.ok(
    demyRows.filter((r) => r.medal && !r.pending).every((r) => r.place === `${r.medal}.`),
    'every disc and its place agree',
  );
  assert.deepEqual(
    medalTable(
      followedRows(schedule, withRoots(two, roster), two, medalScope(DEMO_DISTRICTS, ticks('demy', 'maly'))),
    ).map((c) => [c.name, ...c.medals]),
    [
      ['Demon Urheilijat', 7, 3, 1],
      ['Mallikylän Vire', 5, 1, 0],
    ],
    'two piiris chosen: each club under its own',
  );

  // The Mitalit view has a table per chosen piiri, ranked within it
  // (displayRank), and the rest unranked (docs/views.md).
  const m100 = DEMO_EVENTS.e1.Rounds[0];
  const m100Start = Object.values(schedule)[0].find((r) => r.Id === 'r1');
  const shape = (tables) =>
    tables.map((t) => [t.scope?.short ?? null, t.allocs.map((a) => [a.Name, a.ResultRank ?? null, displayRank(a)])]);
  assert.deepEqual(shape(scopeResults(m100, m100Start, DEMO_DISTRICTS, ticks('demy'))), [
    [
      'DemY',
      [
        ['Aleksi Testinen', 1, 1],
        ['Ville Mallinen', 2, 2],
      ],
    ],
    [
      null,
      [
        ['Kasperi Kokeinen', 3, null],
        ['Guest Runner', null, null],
      ],
    ],
  ]);
  assert.deepEqual(
    shape(scopeResults(m100, m100Start, DEMO_DISTRICTS, ticks('maly', 'demy'))),
    [
      [
        'DemY',
        [
          ['Aleksi Testinen', 1, 1],
          ['Ville Mallinen', 2, 2],
        ],
      ],
      ['MalY', [['Kasperi Kokeinen', 3, 1]]],
      [null, [['Guest Runner', null, null]]],
    ],
    "the file's order whatever the choice's, and the third of the field its piiri's first",
  );
  assert.deepEqual(
    scopeResults(m100, m100Start, DEMO_DISTRICTS, ticks('maly')).map((t) => t.scope?.id ?? null),
    ['maly', null],
  );
  // The official place shows beside the Sija only where the scope moved it
  // (officialRank).
  assert.deepEqual(
    scopeResults(m100, m100Start, DEMO_DISTRICTS, ticks('maly', 'demy')).map((t) => t.allocs.map(officialRank)),
    [[null, null], [3], [null]],
  );
  assert.deepEqual(
    scopeResults({ Heats: [] }, m100Start, DEMO_DISTRICTS, ticks('demy')),
    [],
    'nothing drawn: no table, not even the rest',
  );
  // Mitalit is offered only where its tables add something to the merged list.
  const kuula = DEMO_EVENTS.e2.Rounds[0];
  const kuulaStart = Object.values(schedule)[0].find((r) => r.Id === 'r2');
  assert.equal(
    scopeTablesAddNothing(scopeResults(kuula, kuulaStart, DEMO_DISTRICTS, ticks('sm'))),
    true,
    'the whole field in SM',
  );
  assert.equal(
    scopeTablesAddNothing(scopeResults(m100, m100Start, DEMO_DISTRICTS, ticks('sm'))),
    false,
    'a guest under Muut',
  );
  assert.equal(
    scopeTablesAddNothing(scopeResults(kuula, kuulaStart, DEMO_DISTRICTS, ticks('demy'))),
    false,
    'a piiri of the field',
  );
  const pituus = DEMO_EVENTS.e3.Rounds.find((r) => r.Id === 'r3');
  const pituusStart = Object.values(schedule)[0].find((r) => r.Id === 'r3');
  assert.equal(
    scopeTablesAddNothing(scopeResults(pituus, pituusStart, DEMO_DISTRICTS, ticks('sm'))),
    false,
    'the whole field under Muut',
  );
  assert.equal(scopeTablesAddNothing([]), true, 'nothing drawn');
  assert.equal(
    scopeTablesAddNothing([{ scope: meetScopes(DEMO_DISTRICTS)[0], allocs: [{ ResultRank: 2, scopeRank: 1 }] }]),
    false,
    'a place the scope moved',
  );
  assert.equal(displayRank({ ResultRank: 4, HeatRank: 2 }), 2, "without a scope rank the heat's own");
  // An ottelu's Mitalit reads the root's one round under its start
  // (combinedRootStart). Each table's gaps count from its own first.
  const t9 = combinedEventStarts(schedule).find((s) => s.label === 'T9 3-ottelu');
  const t9Tables = scopeResults(DEMO_EVENTS.e37.Rounds[0], combinedRootStart(t9), DEMO_DISTRICTS, [
    { id: 'maly', cover: { ages: [9], events: null } },
  ]);
  assert.deepEqual(shape(t9Tables), [
    [
      'MalY',
      [
        ['Minea Mallinen', 3, 1],
        ['Fanni Kokeinen', 4, 2],
        ['Vieno Näytteinen', 5, 3],
      ],
    ],
    [
      null,
      [
        ['Oona Demoinen', 1, null],
        ['Lyyli Testinen', 2, null],
        ['Ilona Vierainen', null, null],
        ['Pihla Harjoitinen', null, null],
      ],
    ],
  ]);
  assert.deepEqual(
    t9Tables.map((t) => combinedLeaderPoints(t.allocs)),
    [316, null],
    "the piiri's first, and no gaps under Muut",
  );
  // A leg's split hands out no medal, so its segment names the scopes.
  const t9Leg = t9.legs[0].round;
  assert.equal(scopeSplitLabel(DEMO_DISTRICTS, ticks('maly'), t9Leg), 'MalY');
  assert.equal(scopeSplitLabel(DEMO_DISTRICTS, ticks('demy', 'maly'), t9Leg), 'Piireittäin');
  assert.equal(
    scopeSplitLabel(
      DEMO_DISTRICTS,
      [
        { id: 'demolainen', cover: { ages: [15], events: null } },
        { id: 'maly', cover: null },
      ],
      t9Leg,
    ),
    'MalY',
    'an alue whose cover leaves the start out is not named',
  );
  const twoAlueet = {
    alueet: [
      { id: 'ala', name: 'Ala' },
      { id: 'yla', name: 'Ylä' },
    ],
    piirit: [
      { id: 'p1', short: 'P1', alue: 'ala', clubs: [] },
      { id: 'p2', short: 'P2', alue: 'yla', clubs: [] },
    ],
  };
  assert.equal(scopeSplitLabel(twoAlueet, ticks('ala', 'yla'), t9Leg), 'Alueittain');
  assert.equal(scopeSplitLabel(twoAlueet, ticks('ala', 'p2'), t9Leg), 'Piireittäin', 'an alue beside a piiri');

  // An alue ranks its piiris' clubs together, and the country ranks every
  // piiri's. A club in no piiri is a guest.
  assert.deepEqual(
    meetScopes(DEMO_DISTRICTS).map((s) => [s.id, s.kind, s.short, s.clubs]),
    [
      ['sm', 'maa', 'SM', ['DemU', 'TeKi', 'MalV', 'NäVa']],
      ['demolainen', 'alue', 'Demolainen alue', ['DemU', 'TeKi', 'MalV', 'NäVa']],
      ['demy', 'piiri', 'DemY', ['DemU', 'TeKi']],
      ['maly', 'piiri', 'MalY', ['MalV', 'NäVa']],
    ],
  );
  assert.deepEqual(
    meetMedals(schedule, everything, medalScope(DEMO_DISTRICTS, ticks('demolainen'))).map((c) => [c.name, ...c.medals]),
    [
      ['Testilän Kisa', 6, 5, 1],
      ['Demon Urheilijat', 5, 5, 1],
      ['Näyteniemen Vauhti', 3, 2, 3],
      ['Mallikylän Vire', 3, 2, 1],
    ],
    "Harjoituspiirin Urheilijat's medals pass to the alue's clubs",
  );
  const inStart = (id, ticked) => {
    const start = Object.values(schedule)[0].find((r) => r.Id === id);
    return shape(
      scopeResults(
        DEMO_EVENTS[start.EventId].Rounds.find((r) => r.Id === id),
        start,
        DEMO_DISTRICTS,
        ticked,
      ),
    );
  };
  assert.deepEqual(inStart('r30', ticks('demolainen')), [
    [
      'Demolainen alue',
      [
        ['Rasmus Demoinen', 1, 1],
        ['Julius Mittainen', 3, 2],
      ],
    ],
    [null, [['Aleksanteri Harjoitinen', 2, null]]],
  ]);
  // A row goes to the first ticked scope whose cover holds its start, so an
  // alue over 15 and up leaves the rest to its piiri (19327).
  const split = [
    { id: 'demolainen', cover: { ages: [15, 17, 19], events: null } },
    { id: 'demy', cover: null },
  ];
  assert.deepEqual(
    inStart('r25', split),
    [
      [
        'Demolainen alue',
        [
          ['Veeti Demoinen', 1, 1],
          ['Lauri Simulainen', 3, 2],
        ],
      ],
      [null, [['Oiva Mallinen', 2, null]]],
    ],
    "M15 inside the alue's cover",
  );
  assert.deepEqual(
    inStart('r30', split),
    [
      [
        'DemY',
        [
          ['Rasmus Demoinen', 1, 1],
          ['Julius Mittainen', 3, 2],
        ],
      ],
      [null, [['Aleksanteri Harjoitinen', 2, null]]],
    ],
    "M outside it, the piiri's",
  );
  assert.deepEqual(
    inStart('r30', [{ id: 'demolainen', cover: { ages: null, events: ['100 m'] } }]).map(([s]) => s),
    [null],
    'an event outside every cover: the rest alone',
  );
  assert.deepEqual(
    inStart('r30', [{ id: 'demolainen', cover: { ages: null, events: ['400m'] } }]).map(([s]) => s),
    ['Demolainen alue', null],
    'the event without its class, folded',
  );
  const covered = (id, events) => inStart(id, [{ id: 'demolainen', cover: { ages: null, events } }]).some(([s]) => s);
  assert.deepEqual(
    [
      covered('r5', ['viestit']),
      covered('r5', ['4x100m viesti']),
      covered('r5', ['4x100m']),
      covered('r1', ['viestit']),
    ],
    [true, true, false, false],
    'a family word holds every relay; a name with a digit is exact',
  );
  const lines = (ticked) =>
    followedRows(schedule, withRoots(two, roster), two, medalScope(DEMO_DISTRICTS, ticked))
      .filter((r) => r.event === 'M 400m')
      .map((r) => [r.name, r.medal]);
  assert.deepEqual(lines(ticks('demolainen')), [['Rasmus Demoinen', 1]]);
  assert.deepEqual(
    lines(split.slice(0, 1)),
    [['Rasmus Demoinen', null]],
    'a followed line outside the cover draws no disc',
  );
});
