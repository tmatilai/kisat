// Tests the club cup over the demo cup meets (docs/seuracup.md).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoCupEventResults, demoCupFinalEventResults } from './fixtures.mjs';
import {
  cupBody,
  cupBreakdown,
  cupDefaultTab,
  cupDetail,
  cupFinalLadder,
  cupFinalMax,
  cupFinalOrganisers,
  cupFinalOver,
  cupFinalRoundScores,
  cupFinalSeries,
  cupFinalStandings,
  cupFinalTables,
  cupFinals,
  cupFollowedClubs,
  cupMeetRound,
  cupMode,
  cupScoringKey,
  cupSeasonAthletes,
  cupSeasonClub,
  cupSeasonRecord,
  cupSeasonRows,
  cupSeasonScope,
  cupSeasonTable,
  cupStandings,
  cupTableHead,
  cupTableShown,
  isCupMeet,
} from '../public/lib/cup.js';
import { heatsAreShared, mergeHeats, positionText } from '../public/lib/results.js';
import { API, roundGroupKey } from '../public/lib/schedule.js';
import {
  DEMO_CUP_EVENTS,
  DEMO_CUP_FINAL_EVENTS,
  DEMO_CUP_FINAL_ID,
  DEMO_CUP_ID,
  DEMO_EVENTS,
  DEMO_ID,
  demoResponse,
  demoSchedule,
} from '../public/demo.js';

// --- isCupMeet/cupStandings: the club cup's table over democup, each rule
// measured (docs/tuloslista-api.md) ---
test('isCupMeet/cupStandings', () => {
  assert.equal(isCupMeet(demoResponse(`${API}/competition/${DEMO_CUP_ID}/properties`)), true);
  // The Type 3 flag decides and the points do not (docs/tuloslista-api.md).
  // (Break on purpose: return true from isCupMeet, and the demo is a cup.)
  assert.equal(isCupMeet(demoResponse(`${API}/competition/${DEMO_ID}/properties`)), false);
  assert.ok(
    DEMO_EVENTS.e1.Rounds[0].Heats[0].Allocations.every((a) => a.SeuraCUPPoints > 0),
    'and it is not for want of points on the rows',
  );
  assert.equal(
    isCupMeet({ Settings: [{ Type: 1, IntValue: 60, StringValue: 'on' }] }),
    false,
    'Type 1 is the confirmation switch and says nothing about a cup',
  );
  // A final carries Type 0 and is no cup by this gate (cupMode, below).
  // (Break on purpose: gate on `s.Type !== 1`, and a final is a cup.)
  assert.equal(
    isCupMeet({ Settings: [{ Type: 0, IntValue: 17, StringValue: 'KKFIImport' }] }),
    false,
    'another type is not the flag, whatever the meet is called',
  );
  assert.equal(isCupMeet({ Settings: [{ Type: 3, IntValue: 0 }] }), false, 'switched off is not a cup');
  assert.equal(isCupMeet({ Settings: [] }), false);
  assert.equal(isCupMeet({}), false);
  assert.equal(isCupMeet(null), false);

  const standings = cupStandings(demoCupEventResults());
  assert.deepEqual(
    standings.clubs.map((c) => [c.rank, c.name, c.points]),
    [
      [1, 'Demon Urheilijat', 3820],
      [2, 'Testilän Kisa', 2960],
      [3, 'Mallikylän Vire', 2470],
      [4, 'Näyteniemen Vauhti', 2370],
      [5, 'Harjoituspiirin Urheilijat', 1760],
    ],
  );
  assert.ok(
    standings.clubs.every((c) => c.nameShort),
    'the short name a table column is built out of',
  );

  // A guest scores for no club. (Break on purpose: drop the NotInCompetition
  // test from cupStandings, and the guest's club joins the table.)
  const guest = DEMO_CUP_EVENTS.c1.Rounds[0].Heats[0].Allocations.find((a) => a.Name === 'Guest Sprinter');
  assert.equal(guest.NotInCompetition, true);
  assert.ok(guest.SeuraCUPPoints > 0, 'a guest with 0 points would prove nothing');
  assert.ok(!standings.clubs.some((c) => c.name === 'Ulkomaalainen Vieras'));

  // Only a Final round scores, and c5 is heats alone (docs/tuloslista-api.md).
  // (Break on purpose: drop the RoundTypeCategory test, and three clubs gain
  // 800, 720 and 640.)
  assert.equal(DEMO_CUP_EVENTS.c5.Rounds[0].RoundTypeCategory, 'Qualify');
  const withQualifying = cupStandings([
    ...demoCupEventResults(),
    {
      eventId: 'c5f',
      data: { ...DEMO_CUP_EVENTS.c5, Rounds: [{ ...DEMO_CUP_EVENTS.c5.Rounds[0], RoundTypeCategory: 'Final' }] },
    },
  ]);
  assert.deepEqual(
    withQualifying.clubs.map((c) => c.points),
    [4620, 3680, 3010, 2470, 1760],
    'the same rows counted as a final are 800, 720 and 640 nobody actually scored',
  );

  // The two walks are one cup event, so a club scores its better walker.
  // (Break on purpose: drop the Walk branch from cupEventKey.)
  const unmerged = cupStandings(
    demoCupEventResults().map((e) =>
      e.eventId === 'c4' ? { ...e, data: { ...e.data, EventType: { ...e.data.EventType, SubCategory: 'Sprint' } } } : e,
    ),
  );
  assert.equal(unmerged.clubs.find((c) => c.name === 'Demon Urheilijat').points, 3820 + 500);
  assert.equal(unmerged.clubs.find((c) => c.name === 'Mallikylän Vire').points, 2470 + 380);

  // The 60m pair agrees on the group's digits and does not merge. (Break on
  // purpose: merge on the digits alone.)
  assert.ok(
    cupStandings(demoCupEventResults()).clubs.find((c) => c.name === 'Testilän Kisa').points >
      cupStandings(demoCupEventResults().filter((e) => e.eventId !== 'c1')).clubs.find(
        (c) => c.name === 'Testilän Kisa',
      ).points,
    'T11 60m scores TeKi something P11 60m does not already cover',
  );
  // The pair is one physical start with one set of lanes a heat, so its
  // merged heat table carries points (dev/probe-cup.js). (Break on purpose:
  // give the classes their own lanes, and heatsAreShared is false.)
  {
    const heats = mergeHeats([
      { label: 'T11', data: DEMO_CUP_EVENTS.c1, round: DEMO_CUP_EVENTS.c1.Rounds[0] },
      { label: 'P11', data: DEMO_CUP_EVENTS.c2, round: DEMO_CUP_EVENTS.c2.Rounds[0] },
    ]);
    assert.equal(
      heatsAreShared(heats),
      true,
      'the cup meet needs one shared start, or the merged table has no fixture',
    );
    assert.deepEqual(
      heats.map((h) => h.rows.length),
      [6, 5],
    );
    for (const h of heats)
      assert.equal(
        new Set(h.rows.map((r) => r.lane)).size,
        h.rows.length,
        'one drawn set of lanes per heat, used once across both classes',
      );
  }

  // One best row per club per event scores, and c1 holds two of one club.
  // (Break on purpose: keep the first row seen, and the slower one scores. Add
  // where it replaces, and the club gains 680.)
  const scoringIds = new Set(standings.scoring);
  const demu = DEMO_CUP_EVENTS.c1.Rounds[0].Heats.flatMap((h) => h.Allocations).filter(
    (a) => a.Organization.NameShort === 'DemU',
  );
  assert.equal(demu.length, 2, 'the fixture needs two of one club in one event, or this proves nothing');
  assert.deepEqual(
    demu.filter((a) => scoringIds.has(cupScoringKey('c1', a))).map((a) => a.Name),
    ['Iiris Seurainen'],
    "the club's best row in that event, and only it",
  );

  // Level on points the better result scores, then the better place, across
  // the walks' two races too (docs/tuloslista-api.md).
  // (Break on purpose: compare on points alone, and all three name the worse
  // row. Put the place first, and the walk names the boys' winner.)
  {
    const row = (Id, Result, ResultRank, SeuraCUPPoints) => ({
      Id,
      Result,
      ResultRank,
      SeuraCUPPoints,
      Organization: { Id: 1, Name: 'Demon Urheilijat' },
    });
    const event = (eventId, Group, Category, SubCategory, rows) => ({
      eventId,
      data: {
        Group,
        EventType: { Category, SubCategory },
        Rounds: [{ RoundTypeCategory: 'Final', Heats: [{ Allocations: rows }] }],
      },
    });
    const level = cupStandings([
      event('k', 'T11', 'Field', 'Throw', [row('k1', '6.95', 5, 301), row('k2', '6.96', 4, 301)]),
      event('h', 'T11', 'Field', 'VerticalJump', [row('h1', '120', 5, 234), row('h2', '120', 3, 234)]),
      event('wp', 'P11', 'Track', 'Walk', [row('w1', '6.54,31', 1, 125)]),
      event('wt', 'T11', 'Track', 'Walk', [row('w2', '6.54,23', 4, 125)]),
    ]);
    assert.deepEqual([...level.scoring].sort(), ['h:h2', 'k:k2', 'wt:w2']);
    assert.equal(level.clubs[0].points, 301 + 234 + 125, 'and no total moves');
  }

  // A relay scores as the team's own row under its club.
  const teams = DEMO_CUP_EVENTS.c6.Rounds[0].Heats[0].Allocations;
  assert.ok(
    teams.every((t) => scoringIds.has(cupScoringKey('c6', t))),
    "four teams, four clubs, and every one of them its club's best row in the event",
  );

  // A scoring row appears once, and a guest's row never does.
  assert.equal(standings.scoring.length, new Set(standings.scoring).size, 'no row counted twice');
  assert.ok(!scoringIds.has(cupScoringKey('c1', guest)));
  // The walks' scoring row is keyed by the event it ran in, since a page asks
  // with the event id it fetched (dev/probe-cup.js).
  assert.ok(
    scoringIds.has('c4:sc4') && !scoringIds.has('c3:sc2'),
    "DemU's walker in the boys' race counted, and the one in the girls' race did not",
  );

  // A row worth 0 is no scoring row, even as its club's only one in the event.
  // The club stays in the table. (Break on purpose: push every best row, and
  // 'c4:sc10' is here.)
  const dns = DEMO_CUP_EVENTS.c4.Rounds[0].Heats[0].Allocations.find((a) => a.Id === 'sc10');
  assert.equal(dns.SeuraCUPPoints, 0, 'a DNS scores 0, which is what makes this the case');
  assert.ok(
    !DEMO_CUP_EVENTS.c3.Rounds[0].Heats.flatMap((h) => h.Allocations).some((a) => a.Organization.NameShort === 'HarjU'),
    "and it is the club's only row in the merged event",
  );
  assert.ok(!scoringIds.has(cupScoringKey('c4', dns)));
  assert.ok(
    standings.clubs.some((c) => c.nameShort === 'HarjU' && c.points > 0),
    'not scoring here is not being dropped from the table',
  );
  // An NM on a field row is worth 0 too.
  const nm = DEMO_CUP_EVENTS.c7.Rounds[0].Heats[0].Allocations.find((a) => a.Result === 'NM');
  assert.equal(nm.SeuraCUPPoints, 0);
  assert.ok(!scoringIds.has(cupScoringKey('c7', nm)));

  // Organization.Id 0 is no club (isFollowableOrgId).
  const noClub = cupStandings([
    {
      eventId: 'x',
      data: {
        Rounds: [
          {
            RoundTypeCategory: 'Final',
            Heats: [
              {
                Allocations: [
                  { Id: 'x1', SeuraCUPPoints: 900, Organization: { Id: 0, Name: 'Seuraton' } },
                  { Id: 'x2', SeuraCUPPoints: 100, Organization: { Id: 7, Name: 'Oikea Seura' } },
                ],
              },
            ],
          },
        ],
      },
    },
  ]);
  assert.deepEqual(
    noClub.clubs.map((c) => c.name),
    ['Oikea Seura'],
  );

  // A tie shares its place and orders by name.
  const tied = cupStandings([
    {
      eventId: 'x',
      data: {
        Rounds: [
          {
            RoundTypeCategory: 'Final',
            Heats: [
              {
                Allocations: [
                  { Id: 'y1', SeuraCUPPoints: 500, Organization: { Id: 1, Name: 'Äimän Into' } },
                  { Id: 'y2', SeuraCUPPoints: 500, Organization: { Id: 2, Name: 'Aapon Aura' } },
                  { Id: 'y3', SeuraCUPPoints: 100, Organization: { Id: 3, Name: 'Kolmas Kisa' } },
                ],
              },
            ],
          },
        ],
      },
    },
  ]);
  assert.deepEqual(
    tied.clubs.map((c) => [c.rank, c.name]),
    [
      [1, 'Aapon Aura'],
      [1, 'Äimän Into'],
      [3, 'Kolmas Kisa'],
    ],
    'two on 500 are both first, and the next is third',
  );

  assert.deepEqual(cupStandings([]), { clubs: [], scoring: [] });
  assert.deepEqual(cupStandings(null), { clubs: [], scoring: [] });
  assert.deepEqual(cupStandings([{ eventId: 'e', data: null }]), { clubs: [], scoring: [] });
});

// --- cupMode/cupFinalStandings: the finals, which score by place off a Type 0
// setting (docs/tuloslista-api.md) ---
const FINAL = { Settings: [{ Type: 0, Index: 0, StringValue: 'KKFIImport', IntValue: 17 }] };
test('cupMode/cupFinalStandings', () => {
  const OSA = { Settings: [{ Type: 3, Index: 0, StringValue: 'KKFIImport', IntValue: 1 }] };

  assert.equal(cupFinalMax(FINAL), 17);
  assert.equal(cupFinalMax(OSA), 0, "an osakilpailu's own flag is not a finals ladder");
  assert.equal(cupFinalMax({ Settings: [{ Type: 0, IntValue: 0 }] }), 0, 'switched off is no ladder');
  assert.equal(cupFinalMax({ Settings: [{ Type: 1, IntValue: 60 }] }), 0);
  assert.equal(cupFinalMax(null), 0);

  // cupMode tells an osakilpailu and a final from a meet that scores nothing.
  assert.deepEqual(cupMode(OSA), { final: false });
  assert.deepEqual(cupMode(FINAL), { final: true, max: 17 });
  assert.equal(cupMode({ Settings: [{ Type: 1, IntValue: 60 }] }), null);
  assert.equal(cupMode(null), null);

  // The second place scores two below the winner. (Break on purpose: step down
  // by one from max, and a measured final's winner reads 379 against the
  // official 354.)
  assert.deepEqual(cupFinalLadder(17), [17, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  assert.equal(cupFinalLadder(17).length, 17, 'seventeen places deep, last of them worth nothing');
  assert.deepEqual(cupFinalLadder(2), [2, 0]);
  assert.deepEqual(cupFinalLadder(1), [1]);
  assert.deepEqual(cupFinalLadder(0), []);

  const alloc = (Id, ResultRank, org, extra = {}) => ({
    Id,
    ResultRank,
    Name: Id,
    Organization: { Id: org, Name: `Seura ${org}`, NameShort: `S${org}` },
    ...extra,
  });
  const finalRound = (allocs) => ({ RoundTypeCategory: 'Final', Heats: [{ Allocations: allocs }] });
  const scoresOf = (allocs, max = 17) => cupFinalRoundScores(finalRound(allocs), max);

  // With one row a place, each row scores straight off the ladder.
  assert.deepEqual(
    [...scoresOf([alloc('a', 1, 1), alloc('b', 2, 2), alloc('c', 3, 3)])],
    [
      ['a', 17],
      ['b', 15],
      ['c', 14],
    ],
  );

  // A shared place shares the places' points, and the next row is third.
  // (Break on purpose: give each tied row its own place's value, and a measured
  // final's 313,5 reads 314.)
  assert.deepEqual(
    [...scoresOf([alloc('a', 1, 1), alloc('b', 1, 2), alloc('c', 3, 3)])],
    [
      ['a', 16],
      ['b', 16],
      ['c', 14],
    ],
  );

  // A row with no ResultRank scores nothing and takes no place from the rows
  // after it (docs/tuloslista-api.md).
  assert.deepEqual(
    [...scoresOf([alloc('a', 1, 1), alloc('dns', null, 2), alloc('c', 2, 3)])],
    [
      ['a', 17],
      ['c', 15],
    ],
  );

  // Neither a guest nor the API's "no club" scores.
  // (Break on purpose: drop the NotInCompetition test, and 'g' scores 15.)
  assert.deepEqual(
    [...scoresOf([alloc('a', 1, 1), alloc('g', 2, 2, { NotInCompetition: true }), alloc('none', 3, 0)])],
    [['a', 17]],
  );

  // Two rows per club score in a round. A third clubmate is absent and still
  // holds its place. (Break on purpose: drop the cap, and this reads four.)
  assert.deepEqual(
    [...scoresOf([alloc('a1', 1, 1), alloc('a2', 2, 1), alloc('a3', 3, 1), alloc('b', 4, 2)])],
    [
      ['a1', 17],
      ['a2', 15],
      ['b', 13],
    ],
  );

  // A last place worth 0 is in the table.
  assert.deepEqual(
    [...scoresOf([alloc('a', 1, 1), alloc('b', 2, 2), alloc('c', 3, 3)], 3)],
    [
      ['a', 3],
      ['b', 1],
      ['c', 0],
    ],
  );

  // Only a Final round scores, as in an osakilpailu.
  assert.equal(cupFinalRoundScores({ ...finalRound([alloc('a', 1, 1)]), RoundTypeCategory: 'Qualify' }, 17).size, 0);
  assert.equal(cupFinalRoundScores(null, 17).size, 0);
  assert.equal(scoresOf([alloc('a', 1, 1)], 0).size, 0, 'no ladder, no points');

  // The relay breaks a tie, and a club that did not run it ranks behind.
  const twoEvents = [
    {
      eventId: 'e1',
      data: { EventCategory: 'Track', Rounds: [finalRound([alloc('a', 1, 1), alloc('b', 2, 2), alloc('c', 3, 3)])] },
    },
    { eventId: 'e2', data: { EventCategory: 'Relay', Rounds: [finalRound([alloc('rb', 1, 2), alloc('ra', 2, 1)])] } },
  ];
  // A place the relay decides is not shared. (Break on purpose: sort and share
  // on points alone, and a measured final's two clubs level on 304 share the
  // 4th the official page splits.)
  const table = cupFinalStandings(twoEvents, 17).clubs;
  assert.deepEqual(
    table.map((c) => [c.nameShort, c.points, c.relayRank, c.rank]),
    [
      ['S2', 32, 1, 1],
      ['S1', 32, 2, 2],
      ['S3', 14, 999999, 3],
    ],
  );

  // Clubs level on points and on the relay share a place.
  const tied = cupFinalStandings(
    [
      {
        eventId: 'e',
        data: { EventCategory: 'Track', Rounds: [finalRound([alloc('a', 1, 1), alloc('b', 1, 2), alloc('c', 3, 3)])] },
      },
    ],
    17,
  ).clubs;
  assert.deepEqual(
    tied.map((c) => [c.points, c.rank]),
    [
      [16, 1],
      [16, 1],
      [14, 3],
    ],
  );

  // The relay scores like any event, and its place only breaks a tie.
  const relayTie = cupFinalStandings(
    [
      { eventId: 'e1', data: { EventCategory: 'Track', Rounds: [finalRound([alloc('a', 1, 1), alloc('b', 1, 2)])] } },
      { eventId: 'e2', data: { EventCategory: 'Relay', Rounds: [finalRound([alloc('rb', 1, 2), alloc('ra', 2, 1)])] } },
    ],
    17,
  ).clubs;
  assert.deepEqual(
    relayTie.map((c) => [c.nameShort, c.points, c.relayRank, c.rank]),
    [
      ['S2', 33, 1, 1],
      ['S1', 31, 2, 2],
    ],
  );

  assert.deepEqual(cupFinalStandings([], 17), { clubs: [] });
  assert.deepEqual(cupFinalStandings(null, 17), { clubs: [] });
  assert.deepEqual(cupFinalStandings([{ eventId: 'e', data: null }], 17), { clubs: [] });

  // cupBody answers both kinds, here over the same fixture.
  const cupEvents = demoCupEventResults();
  const osa = cupBody(
    demoResponse(`${API}/competition/${DEMO_CUP_ID}/properties`),
    demoSchedule(DEMO_CUP_ID),
    cupEvents,
  );
  assert.equal(osa.cup, true);
  assert.equal(osa.final, undefined);
  assert.ok(osa.scoring.length > 0 && osa.clubs.length > 0);
  assert.ok(osa.phase);
  const fin = cupBody(FINAL, demoSchedule(DEMO_CUP_ID), cupEvents);
  assert.equal(fin.final, true);
  assert.equal(fin.max, 17);
  assert.equal(fin.scoring, undefined, "a final's rail is the round's own, so the body carries no list");
  assert.ok(fin.clubs.length > 0 && fin.clubs.every((c) => c.rank && c.name));
  assert.equal(fin.phase, osa.phase, "the phase is the meet's, not the scoring's");
  // The demo is neither kind. (Break on purpose: let cupFinalMax take the
  // demo's Type 1 setting, and this meet is a final.)
  const none = cupBody(demoResponse(`${API}/competition/${DEMO_ID}/properties`), demoSchedule(DEMO_ID), []);
  assert.deepEqual(none, { cup: false, confirm: none.confirm });
});

// --- cupBreakdown: where a club's points came from, against democup
// (docs/backend.md) ---
test('cupBreakdown', () => {
  const events = demoCupEventResults();
  const schedule = demoSchedule(DEMO_CUP_ID);
  const osa = { final: false };
  const { clubs } = cupBreakdown(events, osa, schedule);

  // A club's rows add up to the standings' total. (Break on purpose: read the
  // points off the allocation and not `scoring`, and a club's rows add up to
  // more.)
  for (const club of cupStandings(events).clubs) {
    const rows = (clubs[club.id] || []).flatMap((b) => b.entries);
    assert.equal(
      rows.reduce((n, r) => n + r.points, 0),
      club.points,
      `${club.name}'s rows have to add up to its total`,
    );
  }

  const demu = clubs['1'];
  assert.deepEqual(
    demu.map((b) => [b.event, ...b.entries.flatMap((e) => [e.name, e.result, e.points])]),
    [
      ['P11 60m', 'Niilo Seurainen', '9,15', 750],
      ['T11 60m', 'Iiris Seurainen', '9,12', 820],
      ['T13 4x100m viesti', 'Demon Urheilijat', '55,12', 820],
      ['P13 Kuula', 'Miska Seurainen', '10.44', 820],
      ['P11 1000m kävely', 'Onni Demoinen', '6.02,45', 610],
    ],
  );
  assert.ok(
    demu.every((b) => b.entries.length === 1),
    'one entry a club an event in an osakilpailu, so a box is a line',
  );
  // A box carries the place and the field it was set in (positionText).
  assert.deepEqual(
    demu.map((b) => positionText(b.entries[0].place, b.field)),
    ['2/5', '1/6', '1/4', '1/5', '1/4'],
  );

  // Boxes run in programme order, and a shared instant sorts by the event's
  // name. (Break on purpose: leave the boxes in fan-out order, and the walk
  // comes before the relay.)
  const ts = demu.map((b) => b.group.split('|')[0]);
  assert.deepEqual([...ts].sort(), ts, 'in the order the day ran');

  // A box links to its start by the schedule's key, found by round id
  // (groupRounds). (Break on purpose: build the key from the payload's own
  // round, and no box links to a start the schedule has.)
  const keys = new Set(
    Object.values(demoSchedule(DEMO_CUP_ID))
      .flat()
      .map((r) => roundGroupKey(r)),
  );
  assert.ok(
    Object.values(clubs)
      .flat()
      .every((b) => keys.has(b.group)),
    'a box links to a start this app can open',
  );
  assert.equal(clubs['1'][0].group, clubs['1'][1].group, 'a shared start is one link from either class');

  // The breakdown holds no guest, no clubmate behind the scorer and no
  // qualifying round.
  const entries = Object.values(clubs)
    .flat()
    .flatMap((b) => b.entries);
  assert.ok(!entries.some((e) => e.name === 'Guest Sprinter'));
  assert.ok(
    !entries.some((e) => e.name === 'Peppi Loikkanen'),
    "a club's second-best row scored nothing and so says nothing here",
  );
  assert.ok(
    !Object.values(clubs)
      .flat()
      .some((b) => b.event === DEMO_CUP_EVENTS.c5.Name),
    'a qualifying round alone is worth nothing to anybody',
  );
  // A club is here once across the two walks, in its best walker's race
  // (cupEventKey). (Break on purpose: score the two starts apart, and the two
  // clubs with a walker in each race are here twice.)
  const walks = Object.entries(clubs).flatMap(([club, boxes]) =>
    boxes.filter((b) => /kävely/.test(b.event)).flatMap((b) => b.entries.map((e) => [club, b.event, e.name])),
  );
  assert.deepEqual(
    walks.sort(),
    [
      ['1', 'P11 1000m kävely', 'Onni Demoinen'],
      ['2', 'P11 1000m kävely', 'Väinö Mallinen'],
      ['3', 'T11 1000m kävely', 'Aino Kävelinen'],
      ['4', 'P11 1000m kävely', 'Elias Näyteinen'],
    ].sort(),
    'one row a club across the two races, in the race it was set in',
  );
  assert.equal(new Set(walks.map(([club]) => club)).size, walks.length, 'and never a club twice');

  // A final's last place is a row worth 0 (cupFinalRoundScores).
  const final = cupBreakdown(events, { final: true, max: 5 }, schedule);
  const rows = Object.values(final.clubs)
    .flat()
    .flatMap((b) => b.entries);
  assert.ok(
    rows.every((r) => r.place > 0),
    'a final scores by the place',
  );
  assert.ok(
    rows.some((r) => r.points === 0),
    'and the place at the end of the ladder is worth nothing',
  );
  assert.deepEqual(
    rows
      .filter((r) => r.place === 1)
      .map((r) => r.points)
      .slice(0, 1),
    [5],
    "the ladder's own top, off the settings' IntValue",
  );
  // The bigger score leads inside a box, whatever the heat order. A heat can
  // hold a club's 12th before its first (2026-08). (Break on purpose:
  // undo both the place-order walk and the box's sort, since either alone
  // lands them right.)
  const putter = (Name, ResultRank, org) => ({
    Id: `${Name}`,
    Name,
    ResultRank,
    Result: `${20 - ResultRank}.00`,
    Organization: { Id: org, Name: `Seura ${org}`, NameShort: `S${org}` },
  });
  // A field of twelve holds the club's worse row first. cupFinalRoundRows
  // scans as many places as there are rows.
  const kuula = [putter('Milja Mittainen', 12, 1), putter('Pihla Vauhtinen', 1, 1)];
  for (let place = 2; place <= 11; place++) kuula.push(putter(`Toinen ${place}`, place, place + 10));
  const jumbled = cupBreakdown(
    [
      {
        eventId: 'k1',
        data: {
          EventCategory: 'Field',
          Name: 'N15 Kuula',
          Rounds: [{ Id: 1, RoundTypeCategory: 'Final', Heats: [{ Allocations: kuula }] }],
        },
      },
    ],
    { final: true, max: 17 },
    null,
  );
  assert.deepEqual(
    jumbled.clubs['1'][0].entries.map((e) => [e.name, e.place, e.points]),
    [
      ['Pihla Vauhtinen', 1, 17],
      ['Milja Mittainen', 12, 5],
    ],
    'biggest first inside the box',
  );
  assert.equal(jumbled.clubs['1'][0].field, 12, 'and the field the places were set in');
  assert.equal(jumbled.clubs['1'].length, 1, 'and both of them in one box, named once');
  assert.equal(jumbled.clubs['1'][0].group, null, 'a round the schedule does not carry links nowhere');

  assert.deepEqual(cupBreakdown(events, null, schedule), { clubs: {} }, 'no cup, nothing to break down');
  assert.deepEqual(cupBreakdown([], osa, schedule), { clubs: {} });
  assert.deepEqual(cupBreakdown(null, osa, null), { clubs: {} });

  // cupDetail is the call every path makes beside cupBody.
  const detail = cupDetail(demoResponse(`${API}/competition/${DEMO_CUP_ID}/properties`), schedule, events);
  assert.deepEqual(Object.keys(detail.clubs).sort(), Object.keys(clubs).sort());
  assert.deepEqual(
    cupDetail(demoResponse(`${API}/competition/${DEMO_ID}/properties`), demoSchedule(DEMO_ID), []),
    { clubs: {} },
    'a meet that is no kind of cup breaks down into nothing',
  );
});

// --- democupfinal: a final end to end, three of a measured final's starts (demo.js) ---
test('democupfinal', () => {
  const props = demoResponse(`${API}/competition/${DEMO_CUP_FINAL_ID}/properties`);
  const schedule = demoSchedule(DEMO_CUP_FINAL_ID);
  const events = demoCupFinalEventResults();
  assert.deepEqual(cupMode(props), { final: true, max: 17 });
  const round = (eventId) => DEMO_CUP_FINAL_EVENTS[eventId].Rounds[0];
  const scores = (eventId) => cupFinalRoundScores(round(eventId), 17);
  // A shared place splits the places' points.
  // (Break on purpose: give a tie the first place's points, and both take 12.)
  assert.deepEqual(
    ['sf2', 'sf8', 'sf1', 'sf6', 'sf9', 'sf13'].map((id) => scores('f1').get(id)),
    [11.5, 11.5, 8.5, 8.5, 2.5, 2.5],
  );
  // The DNF scores nothing and takes no place from the rows after it.
  // (Break on purpose: rank a row with no place last, and the DNF scores 2.)
  assert.deepEqual([scores('f2').has('sf21'), scores('f2').get('sf29'), scores('f2').size], [false, 3, 14]);
  assert.equal(scores('f3').size, 16, 'two teams a club, both counting');
  const body = cupBody(props, schedule, events);
  // The shared heights give halves, and the relay splits the level top two.
  // (Break on purpose: drop relayRank from the sort, and the names decide.)
  assert.deepEqual(
    body.clubs.map((c) => [c.name, c.points, c.rank]),
    [
      ['Testilän Kisa', 76, 1],
      ['Demon Urheilijat', 76, 2],
      ['Näyteniemen Vauhti', 65.5, 3],
      ['Mallikylän Vire', 57.5, 4],
      ['Harjoituspiirin Urheilijat', 36.5, 5],
      ['Esimerkkilän Ponnistus', 36, 6],
      ['Kokeilulan Kiri', 30, 7],
      ['Pistelän Pyrintö', 29.5, 8],
    ],
  );
  const { clubs } = cupDetail(props, schedule, events);
  for (const club of body.clubs) {
    assert.equal(
      clubs[club.id].flatMap((b) => b.entries).reduce((n, e) => n + e.points, 0),
      club.points,
      `${club.name}'s rows`,
    );
  }
  assert.equal(demoResponse(`${API}/results/${DEMO_CUP_FINAL_ID}/f3`).EventType.TeamSize, 16);
  assert.deepEqual(
    DEMO_CUP_FINAL_EVENTS.f3.Rounds[0].Heats.flatMap((h) => h.Allocations).map((a) => a.AthleteOrders.length),
    Array(16).fill(16),
    'sixteen legs a team',
  );
});

// --- cupSeasonRecord/cupSeasonRows: a cup meet's record for its year, and the
// rows a page asks of it, over democup ---
test('cupSeasonRecord/cupSeasonRows', () => {
  const events = demoCupEventResults();
  const schedule = demoSchedule(DEMO_CUP_ID);
  const props = demoResponse(`${API}/competition/${DEMO_CUP_ID}/properties`);
  const body = cupBody(props, schedule, events);
  const record = cupSeasonRecord(body, cupDetail(props, schedule, events), 5, '2026-06-07');
  assert.deepEqual([record.builtAt, record.lastDay, record.final], [5, '2026-06-07', false]);
  assert.deepEqual(
    record.clubs.map(({ rows, ...c }) => c),
    body.clubs.map((c) => ({ id: c.id, name: c.name, rank: c.rank, points: c.points })),
    "the standings' clubs in their order",
  );
  // A club's rows still add up to its total once flattened.
  // (Break on purpose: give every club one club's boxes.)
  for (const c of record.clubs)
    assert.equal(
      c.rows.reduce((n, r) => n + r.points, 0),
      c.points,
      `${c.name}'s rows`,
    );
  const demu = record.clubs.find((c) => c.id === '1');
  const walk = demu.rows.find((r) => r.event === 'P11 1000m kävely');
  assert.deepEqual(Object.keys(walk), [
    'club',
    'licence',
    'name',
    'event',
    'group',
    'place',
    'field',
    'result',
    'points',
  ]);
  assert.deepEqual([walk.club, walk.name, walk.field, walk.points], ['1', 'Onni Demoinen', 4, 610]);
  assert.match(walk.licence, /\S/, "a person's row carries the licence");
  // (Break on purpose: take the first runner's licence, and a team has one.)
  assert.equal(demu.rows.find((r) => r.event === 'T13 4x100m viesti').licence, null, 'a relay is its team');
  assert.deepEqual(
    cupSeasonRecord({ cup: false }, { clubs: {} }, 5, null),
    { builtAt: 5, lastDay: null, final: false, clubs: [] },
    'a meet scoring nothing is a record with no clubs',
  );
  assert.equal(cupSeasonRecord({ cup: true, final: true, clubs: [] }, { clubs: {} }, 5, null).final, true);

  // (Break on purpose: match a licence on a relay's null.)
  assert.deepEqual(cupSeasonRows(record, { clubIds: new Set(['1']) }), demu.rows, "a club's rows");
  assert.deepEqual(
    cupSeasonRows(record, { licences: new Set([walk.licence]) }),
    [walk],
    "a person's, whatever the club",
  );
  assert.deepEqual(
    cupSeasonRows(record, { clubIds: new Set(['1']), licences: new Set([walk.licence]) }),
    demu.rows,
    'each row once',
  );
  assert.deepEqual(cupSeasonRows(record, { licences: new Set([null]) }), []);
  assert.deepEqual(cupSeasonRows(record), [], 'nothing asked');
  assert.deepEqual(cupSeasonRows(null, { clubIds: new Set(['1']) }), []);
});

// --- cupSeasonTable/cupSeasonClub/cupSeasonAthletes: a piiri's cup year, with
// democup served as an osakilpailu, a 9-year-olds' meet and a final ---
test('cupSeasonTable/cupSeasonClub/cupSeasonAthletes', () => {
  const events = demoCupEventResults();
  const schedule = demoSchedule(DEMO_CUP_ID);
  const props = demoResponse(`${API}/competition/${DEMO_CUP_ID}/properties`);
  const recordOf = (p) =>
    cupSeasonRecord(cupBody(p, schedule, events), cupDetail(p, schedule, events), 5, '2026-06-07');
  const osa = recordOf(props);
  const fin = recordOf(FINAL);
  const served = (record, id, date, kind, targets) => ({
    id,
    name: `Seuracup ${id}`,
    date,
    kind,
    piirit: [],
    clubs: record.clubs.map(({ rows, ...c }) => c),
    stale: false,
    rows: cupSeasonRows(record, targets),
  });
  const year = (targets) => [
    served(osa, 'c1', '2026-05-20', 'osa', targets),
    served(osa, 'c2', '2026-06-10', 'nines', targets),
    served(fin, 'c3', '2026-08-29', 'final', targets),
  ];
  const demu = { clubIds: new Set(['1']) };

  // (Break on purpose: sum every kind, and the nines and the final join in.)
  assert.deepEqual(
    cupSeasonTable(year(demu)).map((c) => [c.id, c.name, c.meets, c.points]),
    osa.clubs.map((c) => [c.id, c.name, 1, c.points]),
    'the osakilpailu alone',
  );
  const twice = [...year(demu), served(osa, 'c4', '2026-09-01', 'osa', demu)];
  assert.deepEqual(
    cupSeasonTable(twice).map((c) => [c.id, c.meets, c.points]),
    osa.clubs.map((c) => [c.id, 2, 2 * c.points]),
    'a season is the sum of its osakilpailut',
  );
  // A tie shares its rank and sorts by name. A club at 0 is in no table.
  // (Break on purpose: round each meet's points, or keep a club at 0.)
  assert.deepEqual(
    cupSeasonTable([
      {
        id: 'h1',
        kind: 'osa',
        clubs: [
          { id: '2', name: 'B', rank: 1, points: 10 },
          { id: '1', name: 'A', rank: 2, points: 10.5 },
          { id: '3', name: 'C', rank: 3, points: 0 },
        ],
      },
      { id: 'h2', kind: 'osa', clubs: [{ id: '2', name: 'B', rank: 1, points: 0.5 }] },
      { id: 'h3', kind: 'osa', clubs: null },
    ]).map((c) => [c.id, c.name, c.rank, c.meets, c.points]),
    [
      ['1', 'A', 1, 1, 10.5],
      ['2', 'B', 1, 2, 10.5],
    ],
  );
  assert.deepEqual(cupSeasonTable(null), []);

  // A final's series is in its name. (Break on purpose: require "sarjan", and
  // 2025's A, B and C read no series.)
  assert.deepEqual(
    [
      'Pohjola Seuracup A-sarjan finaali',
      'Pohjola Seuracup B-sarjan finaali',
      'Pohjola Seuracup C-sarjan finaali',
      'Pohjola Seuracup Superfinaali',
      'Pohjola Seuracup A-finaali',
      'Pohjola Seuracup B-finaali',
      'Pohjola Seuracup C-finaali',
      'Seuracup Superfinaali',
    ].map(cupFinalSeries),
    ['A', 'B', 'C', 'super', 'A', 'B', 'C', 'super'],
  );
  assert.equal(cupFinalSeries('seuracup c-sarjan finaali'), 'C');
  // (Break on purpose: drop the lookbehind, and ABC's last letter is a series.)
  assert.equal(cupFinalSeries('Seuracup ABC-sarjan finaali'), null);
  assert.equal(cupFinalSeries('Seuracup 9v lajit'), null);
  assert.equal(cupFinalSeries(null), null);
  // An invented year has a dozen clubs, one with no series and two level at
  // sixth (docs/tuloslista-api.md, "/finals/ is the qualification").
  const dozen = [
    ['A', 1000],
    ['B', 900],
    ['C', 800],
    ['A', 700],
    [null, 650],
    ['B', 600],
    ['C', 600],
    ['A', 500],
    ['B', 400],
    ['C', 300],
    ['A', 200],
    ['B', 100],
  ].map(([series, points], i) => ({
    id: String(i + 1),
    name: `Seura ${String(i + 1).padStart(2, '0')}`,
    series,
    points,
  }));
  const seriesOf = (name) => dozen.find((c) => c.name === name)?.series ?? null;
  const cupYear = (clubs, finals = []) => [
    { id: 'o1', kind: 'osa', clubs: clubs.map(({ id, name, points }, i) => ({ id, name, rank: i + 1, points })) },
    ...finals,
  ];
  const finalsOf = (rows) => rows.map((c) => [c.name.slice(-2), c.rank, c.final, c.organiser]);
  const heldFinals = [
    {
      id: 'f1',
      kind: 'final',
      name: 'Seuracup Superfinaali',
      clubs: [
        { id: '3', name: 'Seura 03', rank: 1, points: 17 },
        { id: '1', name: 'Seura 01', rank: 2, points: 15 },
      ],
    },
    {
      id: 'f2',
      kind: 'final',
      name: 'Seuracup B-sarjan finaali',
      clubs: [
        { id: '12', name: 'Seura 12', rank: 1, points: 17 },
        { id: '2', name: 'Seura 02', rank: 2, points: 15 },
      ],
    },
  ];
  // The Superfinaali's organiser is inside the top, B's in the Superfinaali
  // and A's outside the top. (Break on purpose: rank i + 1 through a tie, let
  // a club with no series in, or fill B before taking the Superfinaali's out.)
  const dozenFinals = cupSeasonTable(cupYear(dozen, heldFinals), seriesOf, {
    super: 'Seura 03',
    A: 'seura 11',
    B: 'Seura 02',
  });
  assert.deepEqual(
    finalsOf(dozenFinals),
    [
      ['01', 1, 'super', false],
      ['02', 2, 'super', false],
      ['03', 3, 'super', true],
      ['04', 4, 'super', false],
      ['05', 5, null, false],
      ['06', 6, 'super', false],
      ['07', 6, 'super', false],
      ['08', 8, 'super', false],
      ['09', 9, 'super', false],
      ['10', 10, 'C', false],
      ['11', 11, 'A', true],
      ['12', 12, 'B', false],
    ],
    "the finals off a year: the tie shared, the organiser by its folded name, no final's points",
  );
  assert.deepEqual(Object.keys(cupSeasonTable(cupYear(dozen), seriesOf)[0]), [
    'id',
    'name',
    'rank',
    'series',
    'points',
    'meets',
    'final',
    'organiser',
    'finalPlace',
  ]);
  // The Superfinaali's organiser outside the top takes the eighth place.
  // (Break on purpose: add the organiser last, and it falls out.)
  assert.deepEqual(
    finalsOf(cupSeasonTable(cupYear(dozen), seriesOf, { super: 'Seura 12' })).map((r) => r.slice(0, 4)),
    [
      ['01', 1, 'super', false],
      ['02', 2, 'super', false],
      ['03', 3, 'super', false],
      ['04', 4, 'super', false],
      ['05', 5, null, false],
      ['06', 6, 'super', false],
      ['07', 6, 'super', false],
      ['08', 8, 'super', false],
      ['09', 9, 'B', false],
      ['10', 10, 'C', false],
      ['11', 11, 'A', false],
      ['12', 12, 'super', true],
    ],
  );
  assert.deepEqual(
    cupSeasonTable(cupYear(dozen)).map((c) => c.final),
    dozen.map(() => null),
    'no series file, no final',
  );
  const thirty = Array.from({ length: 30 }, (_, i) => ({
    id: `a${i}`,
    name: `A-seura ${String(i).padStart(2, '0')}`,
    points: 300 - i,
  }));
  const onlyA = (rows, organisers) => cupSeasonTable(cupYear(rows), () => 'A', organisers).map((c) => c.final);
  // finalPlace counts down each final's list, with the organiser by points.
  // (Break on purpose: count the Superfinaali's clubs in their series' list.)
  const placesA = cupSeasonTable(cupYear(thirty), () => 'A', { A: 'A-seura 29' }).map((c) => c.finalPlace);
  assert.deepEqual([placesA[0], placesA[7], placesA[8], placesA[22], placesA[23], placesA[29]], [1, 8, 1, 15, 16, 22]);
  assert.deepEqual(
    dozenFinals.map((c) => c.finalPlace),
    [1, 2, 3, 4, null, 5, 6, 7, 8, 1, 1, 1],
  );
  // A series' final takes 16, an organiser outside them first. (Break on
  // purpose: take 17, or the organiser last, and the 16 grow or it falls out.)
  const byRank = onlyA(thirty, {});
  assert.deepEqual(
    [byRank.filter((f) => f === 'super').length, byRank.filter((f) => f === 'A').length, byRank[23], byRank[24]],
    [8, 16, 'A', null],
  );
  const hosted = onlyA(thirty, { A: 'A-seura 29' });
  assert.deepEqual([hosted.filter((f) => f === 'A').length, hosted[22], hosted[23], hosted[29]], [16, 'A', null, 'A']);

  // A final with no organiser or no series in its name gives none. (Break on
  // purpose: key by the whole name, and cupSeasonTable finds no organiser.)
  assert.deepEqual(
    cupFinalOrganisers([
      ...heldFinals.map((m) => ({ ...m, organiser: `${m.name} järjestäjä` })),
      { id: 'f3', kind: 'final', name: 'Seuracup A-sarjan finaali', organiser: null },
      { id: 'f4', kind: 'final', name: 'Seuracup finaali', organiser: 'Seura 01' },
      { id: 'f5', kind: 'final', name: 'Seuracup C-finaali', organiser: 'Seura 10' },
      { id: 'o2', kind: 'osa', name: 'Seuracup A-sarjan finaali', organiser: 'Seura 02' },
    ]),
    { super: 'Seuracup Superfinaali järjestäjä', B: 'Seuracup B-sarjan finaali järjestäjä', C: 'Seura 10' },
  );
  assert.deepEqual(cupFinalOrganisers(null), {});
  // (Break on purpose: keep the date order, and the Superfinaali leads.)
  assert.deepEqual(
    cupFinals([
      { id: 's', kind: 'final', name: 'Seuracup Superfinaali' },
      { id: 'x', kind: 'final', name: 'Seuracup finaali' },
      { id: 'c', kind: 'final', name: 'Seuracup C-sarjan finaali' },
      { id: 'o', kind: 'osa', name: 'Seuracup I' },
      { id: 'a', kind: 'final', name: 'Seuracup A-sarjan finaali' },
      { id: 'b', kind: 'final', name: 'Seuracup B-sarjan finaali' },
    ]).map((m) => m.id),
    ['a', 'b', 'c', 's', 'x'],
  );
  assert.deepEqual(cupFinals(null), []);
  // The Superfinaali and B have run, A has no results and C is not in the
  // index. (Break on purpose: take a final's standings while every club is at
  // 0, list the index's finals alone, or keep their date order.)
  const unrunA = {
    id: 'f3',
    kind: 'final',
    name: 'Seuracup A-sarjan finaali',
    date: '2026-09-05',
    clubs: [{ id: '11', name: 'Seura 11', rank: 1, points: 0 }],
  };
  const sections = cupFinalTables([...heldFinals, unrunA], dozenFinals);
  assert.deepEqual(
    sections.map((t) => [t.final, t.meet?.id ?? null]),
    [
      ['A', 'f3'],
      ['B', 'f2'],
      ['C', null],
      ['super', 'f1'],
    ],
  );
  assert.deepEqual(
    sections.map((t) => t.clubs.map((c) => [c.id, c.rank, c.points])),
    [
      [['11', null, null]],
      [
        ['12', 1, 17],
        ['2', 2, 15],
      ],
      [['10', null, null]],
      [
        ['3', 1, 17],
        ['1', 2, 15],
      ],
    ],
    "a run final's standings, else its field in rank order",
  );
  assert.deepEqual(
    cupFinalTables([{ id: 'x', kind: 'final', name: 'Seuracup finaali', clubs: null }], dozenFinals).map((t) => [
      t.final,
      t.clubs.length,
    ]),
    [
      ['A', 1],
      ['B', 1],
      ['C', 1],
      ['super', 8],
      [null, 0],
    ],
    'a final reading no series last, with no field',
  );
  assert.deepEqual(
    cupFinalTables(null, null).map((t) => [t.final, t.meet, t.clubs]),
    [
      ['A', null, []],
      ['B', null, []],
      ['C', null, []],
      ['super', null, []],
    ],
  );
  // (Break on purpose: compare with <=, and a final is over on its own day.)
  assert.deepEqual(
    ['2026-09-04', '2026-09-05', '2026-09-06'].map((d) => cupFinalOver(unrunA, d)),
    [false, false, true],
  );
  assert.equal(cupFinalOver(null, '2026-09-06'), false);
  // The tab a year opens on turns on the first final's day.
  // (Break on purpose: compare with <, and that day opens on the osakilpailut.)
  const finalsDay = [
    { id: 'o', kind: 'osa', date: '2026-06-10' },
    { id: 'b', kind: 'final', date: '2026-09-05' },
    { id: 'a', kind: 'final', date: '2026-08-29' },
  ];
  assert.deepEqual(
    ['2026-08-28', '2026-08-29', '2026-09-20'].map((d) => cupDefaultTab(finalsDay, d)),
    ['osakilpailut', 'finaalit', 'finaalit'],
  );
  assert.equal(cupDefaultTab(finalsDay.slice(0, 1), '2026-12-31'), 'osakilpailut', 'no final in the index');
  assert.equal(cupDefaultTab(null, '2026-12-31'), 'osakilpailut');
  // A meet's round is its month (docs/tuloslista-api.md). (Break on purpose:
  // split at August, and a meet on 1.7. reads as round 1.)
  assert.deepEqual(['2026-06-16', '2026-06-30', '2026-07-01', '2026-08-12'].map(cupMeetRound), [1, 1, 2, 2]);
  // A piiri keeps the finals, and its clubs keep their national rank. (Break
  // on purpose: keep every pending id, count the nines, or ignore the series.)
  const spread = {
    year: 2026,
    pending: ['p1', 'p2', 'f1'],
    meets: [
      { id: 'o1', kind: 'osa', piirit: ['eky'], clubs: [{ id: '2' }, { id: '5' }] },
      { id: 'p1', kind: 'osa', piirit: ['eky', 'lasy'], clubs: null },
      { id: 'p2', kind: 'osa', piirit: ['varsy'], clubs: null },
      { id: 'n1', kind: 'nines', piirit: ['eky'], clubs: [{ id: '1' }] },
      { id: 'f1', kind: 'final', piirit: [], clubs: null },
    ],
  };
  const eky = cupSeasonScope(spread, 'eky');
  assert.deepEqual([eky.meets.map((m) => m.id), eky.pending, eky.year], [['o1', 'p1', 'n1', 'f1'], ['p1', 'f1'], 2026]);
  assert.equal(cupSeasonScope(spread, null), spread);
  const dozenRows = cupSeasonTable(cupYear(dozen), seriesOf);
  assert.deepEqual(
    cupTableShown(dozenRows, eky.meets).map((r) => [r.id, r.rank]),
    [
      ['2', 2],
      ['5', 5],
    ],
    "the osakilpailut's clubs, not the nines'",
  );
  assert.deepEqual(
    cupTableShown(dozenRows, cupYear(dozen), ['C', 'A']).map((r) => r.id),
    ['1', '3', '4', '7', '8', '10', '11'],
  );
  assert.equal(cupTableShown(dozenRows, cupYear(dozen)).length, 12, 'no series chosen is all, a club with none too');
  // (Break on purpose: tint the followed clubs alone, and a person's is plain.)
  const scored = [
    {
      rows: [
        { club: '7', licence: 'L1' },
        { club: '8', licence: 'L2' },
        { club: '9', licence: null },
      ],
    },
    { rows: null },
  ];
  assert.deepEqual([...cupFollowedClubs(scored, { licences: new Set(['L1']), clubIds: new Set(['3']) })], ['3', '7']);
  assert.deepEqual([...cupFollowedClubs(null)], []);
  // (Break on purpose: cut at `limit` alone, and followed club 9 is gone.)
  assert.deepEqual(
    [
      cupTableHead(dozenRows, 3, new Set(['2', '9'])).rows.map((r) => r.id),
      cupTableHead(dozenRows, 3, new Set(['2', '9'])).more,
    ],
    [['1', '2', '3', '9'], 8],
  );
  assert.deepEqual(cupTableHead(dozenRows, 12), { rows: dozenRows, more: 0 });
  assert.deepEqual(cupTableHead(null, 3), { rows: [], more: 0 });

  const lines = cupSeasonClub(year(demu), '1');
  assert.deepEqual(
    lines.map((l) => [l.id, l.kind, l.rank, l.clubs, l.points]),
    [
      ['c1', 'osa', 1, 5, 3820],
      ['c2', 'nines', 1, 5, 3820],
      ['c3', 'final', 1, 5, 112],
    ],
    'every kind',
  );
  assert.deepEqual(Object.keys(lines[0]), ['id', 'name', 'date', 'kind', 'rank', 'clubs', 'points', 'boxes']);
  // (Break on purpose: take all rows, and the followed person's row joins.)
  const watched = { clubIds: new Set(['1']), licences: new Set([osa.clubs.find((c) => c.id === '3').rows[0].licence]) };
  assert.deepEqual(
    cupSeasonClub(year(watched), '1').map((l) => l.boxes),
    [props, props, FINAL].map((p) => cupDetail(p, schedule, events).clubs['1']),
    "the club's boxes, as its meet page has them",
  );
  assert.deepEqual(cupSeasonClub(year(demu), 9), [], 'a club in no standings');
  assert.deepEqual(cupSeasonClub([{ id: 'u', kind: 'osa', clubs: null, rows: [] }], '1'), [], 'an unbuilt meet');

  // An athlete's osakilpailu and final lines are summed apart. (Break on
  // purpose: read every kind, or keep the nines' lines, and the sums mix.)
  const boxes = cupSeasonAthletes(year(demu), demu, 'osa');
  const finalBoxes = cupSeasonAthletes(year(demu), demu, 'final');
  assert.deepEqual(
    [boxes, finalBoxes].map((bs) => bs.reduce((n, b) => n + b.points, 0)),
    [3820, 112],
    "the osakilpailu's scorers, the final's",
  );
  const onni = boxes.find((b) => b.name === 'Onni Demoinen');
  const onniFinal = finalBoxes.find((b) => b.key === onni.key);
  assert.deepEqual(
    [onni.key, onni.club, onni.points],
    [osa.clubs[0].rows.find((r) => r.name === 'Onni Demoinen').licence, 'Demon Urheilijat', 610],
  );
  assert.deepEqual(
    [onni, onniFinal].map((b) => b.lines.map((l) => [l.id, l.date, l.points])),
    [[['c1', '2026-05-20', 610]], [['c3', '2026-08-29', 17]]],
  );
  assert.deepEqual(Object.keys(onni.lines[0]), [
    'id',
    'name',
    'date',
    'event',
    'group',
    'place',
    'field',
    'result',
    'points',
  ]);
  // A relay's rows go in a box of their own, keyed by the club and the
  // team's name, and boxes level on points sort by name. (Break on purpose:
  // key a row with no licence on null, and every club's team shares a box.)
  assert.deepEqual(
    boxes.slice(0, 3).map((b) => [b.key, b.name, b.points]),
    [
      ['1|Demon Urheilijat', 'Demon Urheilijat', 820],
      [osa.clubs[0].rows.find((r) => r.name === 'Iiris Seurainen').licence, 'Iiris Seurainen', 820],
      [osa.clubs[0].rows.find((r) => r.name === 'Miska Seurainen').licence, 'Miska Seurainen', 820],
    ],
  );
  // A followed person's boxes hold only their rows. (Break on purpose: take
  // every row served, and the picked club's scorers come along.)
  const aatu = cupSeasonAthletes(year(watched), { licences: watched.licences }, 'osa');
  assert.deepEqual(
    aatu.map((b) => [b.name, b.club, b.points, b.lines.length]),
    [['Aatu Kisanen', 'Testilän Kisa', 820, 1]],
  );
  assert.deepEqual(cupSeasonAthletes(year(watched), undefined, 'osa'), [], 'nothing asked');
  assert.deepEqual(cupSeasonAthletes(null, demu, 'osa'), []);
});
