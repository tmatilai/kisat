// Tests the SM results read from another site (docs/elsewhere.md).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { combinedAthleteKey, combinedEventStarts, combinedLegColumns, combinedTotals } from '../public/lib/combined.js';
import {
  aloneEntries,
  athleteLicences,
  elsewhereCandidates,
  elsewhereIsDue,
  elsewhereIsRace,
  elsewhereProblems,
  elsewhereRecheck,
  elsewhereRow,
  elsewhereTag,
  elsewhereUpcoming,
  elsewhereYearlyDue,
  graftApplies,
  graftPhase,
  officialUrl,
  olAloneMeet,
  olGraft,
  olMissingClasses,
  olProperties,
  olSchedule,
  olTime,
  t4rAloneMeet,
  t4rGraft,
  t4rWanted,
} from '../public/lib/elsewhere.js';
import { mergeAthleteIndex } from '../public/lib/indexes.js';
import { medalSeasonAges, medalSeasonRecord, meetMedalsBody, scopeMedalStarts } from '../public/lib/medals.js';
import {
  earlierMarks,
  qualBadge,
  qualificationNote,
  roundAllocated,
  verticalJumpHeights,
} from '../public/lib/results.js';
import { buildRoster } from '../public/lib/roster.js';
import { groupRounds, hasEarlierRound, previousRound } from '../public/lib/schedule.js';
import { t4rDecode, t4rIndex, t4rQualRule, t4rResultPage, t4rSitePages } from '../public/lib/t4r.js';
import {
  DEMO_DISTRICTS,
  DEMO_ROAD_COMP,
  DEMO_ROAD_EVENTS,
  DEMO_ROAD_FILES,
  DEMO_ROAD_ORGS,
  DEMO_ROAD_ROW,
  DEMO_ROAD_SCHEDULE,
  DEMO_ROAD_SPELLINGS,
  DEMO_SM_EVENTS,
  DEMO_SM_PAGES,
  DEMO_SM_SITE,
  DEMO_SM_STARTS,
  demoSchedule,
} from '../public/demo.js';
import districts from '../public/data/districts.json' with { type: 'json' };
import elsewhere from '../public/data/elsewhere.json' with { type: 'json' };

// --- t4rGraft: an SM meet's results from another site on its entries ---
test("t4rGraft: an SM meet's results from another site on its entries", async () => {
  const schedule = demoSchedule(null, DEMO_SM_STARTS);
  const entries = Object.entries(DEMO_SM_EVENTS).map(([eventId, data]) => ({ eventId, data }));
  const medalsOf = (pages) => {
    const graft = t4rGraft(schedule, entries, pages);
    const body = meetMedalsBody(graft.schedule, graft.events, DEMO_DISTRICTS);
    const names = new Map([
      ...body.names.map(([id, name]) => [`o${id}`, name]),
      ...body.athletes.map(([key, name]) => [key, name]),
    ]);
    return Object.fromEntries(
      body.starts.map((s) => [s.start.EventName, s.medals.map(([, medal, key]) => `${medal} ${names.get(key)}`)]),
    );
  };
  // (Break on purpose: drop eventNameKey's aj/ej, and the hurdles and the
  // steeplechase lose their medals. Match a row by place, not name, and an
  // entered runner takes the steeplechase gold. Take clubs from the event's
  // own entries, and that gold is lost. Take the first final page, or trust
  // a two-heat final's own places. Drop eventNameKey's "viesti" or clubOf's
  // `people`, and the relay loses medals.)
  assert.deepEqual(
    medalsOf(DEMO_SM_PAGES),
    {
      'M 400m': ['1 Aarne Demoinen', '2 Ilmo Kisanen', '3 Eino Mallinen'],
      'M Pituus': ['1 Ilmo Kisanen', '2 Aarne Demoinen', '3 Oiva Näyteinen'],
      'N 100m aidat': ['1 Elli Mallinen', '2 Aili Demoinen', '3 Oona Näyteinen'],
      'M 3000m esteet': ['1 Veli Vierailija', '2 Yrjö Kokeilu', '3 Oiva Näyteinen'],
      'N 200m': ['1 Ulla Esimerkki', '2 Inka Kisanen', '3 Elli Mallinen'],
      'M 4x200m viesti': ['2 Testilän Kisa', '1 Demon Urheilijat', '3 Näyteniemen Vauhti'],
      'N 7-ottelu': ['1 Inka Kisanen', '2 Oona Näyteinen', '3 Ulla Esimerkki'],
    },
    'each final page lands on its start, and a row with no entry still gets its medal',
  );
  const clubless = DEMO_SM_PAGES.map((p) => ({
    ...p,
    heats: p.heats.map((h) => ({
      ...h,
      rows: h.rows.map((r) => (r.name === 'Veli Vierailija' ? { ...r, club: 'Tuntematon Seura' } : r)),
    })),
  }));
  // (Break on purpose: give t4rMadeEntry another club when the name finds
  // none, and the row gets the gold.)
  assert.deepEqual(
    medalsOf(clubless)['M 3000m esteet'],
    ['2 Yrjö Kokeilu', '3 Oiva Näyteinen'],
    'a row whose club no entry in the meet has is dropped without moving the others up',
  );
  const without = (event, round) => medalsOf(DEMO_SM_PAGES.filter((p) => !(p.event === event && p.round === round)));
  assert.equal(without('M 400 m', 'Loppukilpailu')['M 400m'], undefined, "a qualifying round's page gives no medals");
  assert.equal(
    without('N  7-ottelu Keihäs', '')['N 7-ottelu'],
    undefined,
    'a multi-event gets no medals until every one of its events has a page',
  );
  const graft = t4rGraft(schedule, entries, DEMO_SM_PAGES);
  // A listed meet's record has the country's medals. (Break on purpose: drop
  // `meet?.listed` from meetMedalsBody's defaultScopes call.)
  const smStarts = (meet) =>
    scopeMedalStarts(
      medalSeasonRecord(meetMedalsBody(graft.schedule, graft.events, DEMO_DISTRICTS, meet), 0, '2026-08-02'),
      'sm',
    );
  assert.deepEqual(
    [smStarts({ name: 'Mestaruuskisat', listed: true }).length, smStarts({ name: 'Mestaruuskisat' }).length],
    [7, 0],
  );
  // (Break on purpose: drop T4R_NOT_SM_RE's test from t4rGraft, and the
  // wheelchair race gets medals.)
  assert.deepEqual(
    Object.values(graft.schedule)
      .flat()
      .filter((r) => r.Status !== 'Official')
      .map((r) => r.EventName),
    ['M 100m kelaus'],
    'a wheelchair race is left as it was',
  );
  assert.deepEqual(
    t4rGraft(schedule, entries, [{ event: 'M Pituus', round: '', heats: [] }]),
    { schedule, events: entries },
    'a page with no rows leaves its start as it was',
  );
  assert.ok(
    Object.values(schedule)
      .flat()
      .every((r) => r.Status === 'Unallocated') && entries.every((e) => !roundAllocated(e.data.Rounds[0])),
    'the inputs are not modified',
  );
  const heatsOf = (eventId) => graft.events.find((e) => e.eventId === eventId).data.Rounds[0].Heats;
  const rowsOf = (eventId) => heatsOf(eventId).flatMap((h) => h.Allocations);
  // (Break on purpose: make personNameKey plain looseKey, and a name whose
  // accent only the page has becomes a made entry. Or drop the first-name
  // test from `renamed`, and the last row becomes one too.)
  assert.deepEqual(
    rowsOf('s2').map((a) => [a.Id, a.Result, a.ResultRank]),
    [
      ['m3', '7.84', 1],
      ['m1', '7.82', 2],
      ['m4', '7.76', 3],
      ['m2', '7.40', 4],
      ['m7', '7.10', 5],
    ],
    "each row keeps its entry's ids and takes the page's place, a field result gets a dot, and a new surname is still its entry",
  );
  // A youth class is P or T here and M or N on the other site
  // (docs/elsewhere.md). (Break on purpose: drop eventNameKey's P and T.)
  const youth = (name) =>
    t4rGraft(
      schedule,
      entries.map((e) => (e.eventId === 's2' ? { eventId: e.eventId, data: { ...e.data, Name: name } } : e)),
      DEMO_SM_PAGES.map((p) => (p.event === 'M Pituus' ? { ...p, event: 'M15 Pituus' } : p)),
    );
  assert.deepEqual(
    ['P15 Pituus', 'T15 Pituus', 'M Pituus'].map(
      (name) => youth(name).events.find((e) => e.eventId === 's2').data.Rounds[0].Heats.length,
    ),
    [1, 0, 0],
    'a P class takes the page the site calls M, and a T class of the same number does not',
  );
  assert.deepEqual(
    rowsOf('s3')
      .map((a) => [a.Result, a.ResultRank])
      .pop(),
    ['DNF', null],
  );
  // (Break on purpose: drop the club or the `onPage` test from `renamed`,
  // and the fourth hurdler takes another runner's entry.)
  assert.match(
    rowsOf('s3')[3].Id,
    /^t4r-/,
    'a row is no renamed entry of another club, or of an entry that has its own row',
  );
  const made = rowsOf('s4')[0];
  assert.deepEqual(
    [made.Name, made.Organization, made.Athletes],
    [
      'Veli Vierailija',
      DEMO_SM_EVENTS.s1.Enrollments[0].Organization,
      [{ Id: made.Id, LicenseId: null, Firstname: 'Veli', Surname: 'Vierailija' }],
    ],
    "a made entry has the club of another event's entry, a name in two fields and no licence",
  );
  // (Break on purpose: give a relay's made entry one athlete, and the team's
  // medal is filed as a person's.)
  const team = rowsOf('s7').find((a) => a.ResultRank === 1);
  assert.deepEqual(
    [
      team.Name,
      team.Organization,
      team.Athletes,
      team.AthleteOrders.map((o) => `${o.Index} ${o.Athlete.Firstname} ${o.Athlete.Surname}`),
    ],
    [
      'DU-yleisurheilu',
      made.Organization,
      [],
      ['1 Arvo Demoinen', '2 Aarne Demoinen', '3 Aatu Demoinen', '4 Aki Demoinen'],
    ],
    "a relay team is made of the page's row, and a club the page spells its own way is an entered runner's",
  );
  assert.deepEqual(
    t4rGraft(schedule, [{ eventId: 's1', data: null }], DEMO_SM_PAGES).events,
    [{ eventId: 's1', data: null }],
    'an event that failed to load',
  );
  // Each heat on a page becomes a heat of the round, and a row carries its
  // heat's wind (docs/elsewhere.md). (Break on purpose: put t4rHeats' rows in
  // one heat.)
  assert.deepEqual(
    heatsOf('s5').map((h) => [h.Index, h.Wind, h.Allocations.map((a) => [a.HeatRank, a.ResultRank, a.Wind])]),
    [
      [
        1,
        '+1,2',
        [
          [1, 1, '+1,2'],
          [2, 4, '+1,2'],
          [3, 6, '+1,2'],
        ],
      ],
      [
        2,
        '-0,4',
        [
          [1, 2, '-0,4'],
          [2, 3, '-0,4'],
          [3, 5, '-0,4'],
        ],
      ],
    ],
    'a final of two heats is two heats, ranked by result over both',
  );
  // A throw's attempts keep a pass and a foul, and a mark takes the API's dot.
  // (Break on purpose: drop t4rMark's replace.)
  assert.deepEqual(
    rowsOf('s12').map((a) => a.Attempts.map((t) => `${t.Line1}${t.Line2 ?? ''}`)),
    [
      ['12.80', 'x', '12.64'],
      ['11.98', '12.41', '-'],
      ['11.76', 'x', 'x'],
      ['10.94', '11.20', '11.05'],
    ],
  );
  // A long jump attempt carries its wind, and the row carries the best one's.
  // (Break on purpose: give t4rAttempts' Line2 a null for every subcategory,
  // or keep an empty cell as an attempt.)
  assert.deepEqual(
    rowsOf('s2').map((a) => [a.Wind, (a.Attempts[1] || {}).Line1, (a.Attempts[1] || {}).Line2]),
    [
      ['+0,3', '7.84', '+0,3'],
      ['0,0', 'x', '+0,4'],
      ['+1,2', '7.76', '+1,2'],
      ['+0,6', '7.38', '+0,2'],
      ['+0,4', undefined, undefined],
    ],
  );
  // A vertical jump's attempts are its bars in the order raised, without a
  // passed bar, from a page that wraps them (docs/elsewhere.md). (Break on
  // purpose: read the columns column by column, or keep a passed bar.)
  assert.deepEqual(
    rowsOf('s11').map((a) => a.Attempts.map((t) => `${t.Line1}:${t.Line2}`)),
    [
      ['165:o', '168:xo', '170:xo', '173:o', '176:xxx'],
      ['155:o', '160:xo', '165:o', '168:o', '170:xxx'],
      ['155:o', '160:xxo', '165:xxo', '168:xxx'],
      ['155:xo', '160:o', '165:xxx'],
    ],
  );
  // The graft fills the root's SubEvents, which the standings read and the
  // meet leaves empty (docs/tuloslista-api.md, "An adults' SM whose results are
  // on another site"), and a leg cell's points come off the page
  // (docs/elsewhere.md). (Break on purpose: leave SubEvents as they were, and
  // every leg column is empty.)
  const ottelu = graft.events.find((e) => e.eventId === 's20').data;
  const legs = combinedLegColumns(ottelu, combinedEventStarts(graft.schedule).find((m) => m.key === 'N 7-ottelu').legs);
  const standings = combinedTotals(ottelu);
  const cellsOf = (row) => legs.map((l) => l.results.get(combinedAthleteKey(row)) || {});
  // (Break on purpose: take the points off the first unheaded cell, or drop
  // the digits-only test, and the legs with no attempt columns score nothing.)
  assert.deepEqual(
    legs.map((l, i) => [l.label, cellsOf(standings[0])[i].Result, cellsOf(standings[0])[i].CEPoints]),
    [
      ['100m aidat', '14,10', 800],
      ['Korkeus', '168', 830],
      ['Kuula', '12.80', 715],
      ['200m', '14,11', 800],
      ['Pituus', '9.12', 800],
      ['Keihäs', '9.13', 800],
      ['800m', '14,14', 800],
    ],
    "the columns are the legs in contest order, each cell the leader's own mark and points",
  );
  // (Break on purpose: drop t4rHeats' CEPoints, and the cells lose points.)
  assert.deepEqual(
    standings.map((row) => [row.Name, row.Result, cellsOf(row).reduce((sum, a) => sum + a.CEPoints, 0)]),
    [
      ['Inka Kisanen', '5545', 5545],
      ['Oona Näyteinen', '5081', 5081],
      ['Ulla Esimerkki', '4384', 4384],
      ['Ylva Kokeilu', '3908', 3908],
    ],
    "every athlete's seven legs add up to the total the standings page gives",
  );
  // (Break on purpose: give a track row Attempts of its own.)
  assert.deepEqual(
    [rowsOf('s5')[0].Attempts, verticalJumpHeights(rowsOf('s11'))],
    [undefined, [155, 160, 165, 168, 170, 173, 176]],
    'a track row has no attempts, and the bars of the grid are the grafted ones',
  );
  // Each of the site's rounds with no row here is a start of its own, timed
  // by its index row and dated by its directory (docs/elsewhere.md). (Break
  // on purpose: anchor t4rEventGraft on the last page, or leave the front
  // page out of t4rDays.)
  const heats400 = graft.events.find((e) => e.eventId === 's1').data.Rounds;
  assert.deepEqual(
    heats400.map((r) => [r.Name, r.RoundTypeCategory, r.BeginDateTimeWithTZ, r.Heats.length]),
    [
      ['Alkuerät', 'Qualify', DEMO_SM_STARTS[0].ts, 2],
      ['Loppukilpailu', 'Final', '2026-08-09T08:00:00+00:00', 1],
    ],
    'the final is a round of its own, at the clock and on the day the site gives it',
  );
  // (Break on purpose: append the made rows to the day unsorted.)
  assert.deepEqual(
    graft.schedule['9.8.2026'].map((r) => r.EventName),
    ['M 400m', 'N 200m', 'M 100m kelaus', 'M 4x200m viesti'],
    "it is a start of that day, in its place among the day's others",
  );
  // A round takes its page's name, since a meet can file the heats' time
  // under the final's name. (Break on purpose: keep the meet's own name.)
  assert.deepEqual(
    graft.schedule['8.8.2026'].filter((r) => r.EventId === 's3').map((r) => [r.Name, r.BeginDateTimeWithTZ]),
    [['Loppukilpailu', DEMO_SM_STARTS[2].ts]],
    'a round the site has no page for leaves its name and its time to the one it has',
  );
  // (Break on purpose: drop t4rHeats' QRank and QResult.)
  assert.deepEqual(
    heats400[0].Heats.flatMap((h) => h.Allocations).map((a) => qualBadge(a, heats400[0])),
    ['Q', 'q', '', 'Q', 'q', ''],
    "the page's Q and q are the flags the API carries instead",
  );
  // The final reads the heats as its earlier round. (Break
  // on purpose: give every grafted round Index 0.)
  assert.deepEqual(
    [
      hasEarlierRound(heats400, heats400[1]),
      previousRound(heats400, heats400[1])?.Name,
      earlierMarks(heats400, heats400[1]).size,
    ],
    [true, 'Alkuerät', 6],
  );
  console.log('t4rGraft ok');

  // These tests read the same pages from the other site's HTML.
  const front = t4rIndex(DEMO_SM_SITE['']);
  // (Break on purpose: read t4rIndex's day links off the markup with a regex,
  // and a third day appears.)
  assert.deepEqual(front.days, ['la/'], 'a day that is linked only inside a comment is not a day');
  // (Break on purpose: make the slash in t4rIndex's day link required.)
  assert.deepEqual(
    t4rIndex(DEMO_SM_SITE[''].replace('"./la/"', '"./la"')).days,
    ['la/'],
    "a day's link without its last slash",
  );
  const indexRows = ['la/', ''].flatMap((day) => t4rIndex(DEMO_SM_SITE[day], day).rows);
  // A run of spaces in a name reads as one. The clock and the directory are
  // the index row's.
  const parsed = DEMO_SM_PAGES.map(({ time, dir, ...p }) => ({ ...p, event: p.event.replace(/ +/g, ' ') }));
  assert.deepEqual(
    indexRows.map((r) => [r.event, r.round, r.time, r.dir]),
    DEMO_SM_PAGES.map((p) => [p.event.replace(/ +/g, ' '), p.round, p.time, p.dir]),
    "an index row is a result page, not a start list or a PDF, and it carries the start's clock",
  );
  // (Break on purpose, in t4rResultPage: drop the club test, and a split time
  // is a row. Drop the `runners` line, and the teams have no runners. Drop
  // either half of t4rRunners' split, and a long relay's runner keeps a leg
  // time or its fraction is a runner. Read the wind off the heat's rows. Keep
  // an empty header as an attempt column, or drop t4rLines' empty lines, and
  // a bar takes another's line. Drop `qual`, or take the first cell as it.)
  assert.deepEqual(
    indexRows.map((r) => t4rResultPage(DEMO_SM_SITE[r.href])),
    parsed,
    "a page's rows heat by heat, each heat its wind and its attempt columns, and no split time among them",
  );
  const wanted = t4rWanted(indexRows, entries);
  // (Break on purpose: keep every final row in t4rWanted, and both standings
  // pages are read. Keep only final rows, and the qualifying round is not.)
  assert.deepEqual(
    parsed.filter((p, i) => !wanted.includes(indexRows[i])).map((p) => `${p.event}|${p.round}`),
    ['N masters 100 m|', 'Esiurheilija M Pituus|', 'N 7-ottelu|', 'M 100 m kelaus|'],
    "not read: an earlier day's standings, an event the meet does not have and a wheelchair race",
  );
  assert.deepEqual(
    medalsOf(wanted.map((r) => t4rResultPage(DEMO_SM_SITE[r.href]))),
    medalsOf(DEMO_SM_PAGES),
    'the pages that are read give every medal',
  );
  assert.deepEqual(
    [t4rIndex(null), t4rResultPage(''), t4rWanted(null, null)],
    [{ days: [], rows: [] }, { event: '', round: '', heats: [] }, []],
  );
  // A start list words its rule two ways, and each mark stays as written
  // (docs/elsewhere.md).
  const rule = (text) =>
    t4rQualRule(`<tr><td width="250px">Ryhmä 1/2<br>Jatkoonpääsy: ${text}</td></td><td>13.27</td></tr>`);
  assert.deepEqual(
    [
      'Karsintaraja 12,50 (Q) tai 10 parasta (q)',
      'Karsintaraja 175 (Q) tai 12 parasta (q)',
      '2 parasta (Q) + 2 ajalla (q)',
    ].map(rule),
    [
      { QRank: '12.50', QResult: '10' },
      { QRank: '175', QResult: '12' },
      { QRank: '2', QResult: '2' },
    ],
  );
  assert.equal(t4rQualRule(DEMO_SM_SITE['la/']), null, 'a page with no rule gives none');
  console.log('t4rResultPage ok');

  // t4rSitePages walks the site as the Worker does.
  const paths = [];
  const read = (broken) => async (path, parse) => {
    paths.push(path);
    return path === broken ? null : parse(DEMO_SM_SITE[path]);
  };
  // (Break on purpose: put the front page's rows first in t4rSitePages, and
  // the heptathlon takes the first day's standings.)
  assert.deepEqual(
    medalsOf(await t4rSitePages(read(), entries)),
    medalsOf(DEMO_SM_PAGES),
    'the walk gives every medal',
  );
  // (Break on purpose: read every wanted row's start list, or none.)
  assert.deepEqual(
    paths,
    ['', 'la/', ...wanted.flatMap((r) => (r.round === 'Alkuerät' ? [r.href, r.startList] : [r.href]))],
    "it reads the indexes, the wanted pages and an earlier round's start list, and nothing else",
  );
  // The rule on the heats' start list is set on the round, and
  // qualificationNote prints it. (Break on purpose: drop page.qualRule from
  // t4rEventGraft's `named`.)
  const walked = t4rGraft(schedule, entries, await t4rSitePages(read(), entries)).events.find((e) => e.eventId === 's1')
    .data.Rounds;
  assert.deepEqual(
    walked.map((r) => qualificationNote(r, false)),
    ['Jatkoonpääsy: 1 parasta/erä (Q) ja 2 nopeinta aikaa (q)', null],
  );
  // A bar is centimetres on the start list and metres on the round, by the
  // event's kind (docs/elsewhere.md). (Break on purpose: drop
  // t4rRoundQualRule's VerticalJump test, and a count of 1 becomes 0.01. Or
  // spread page.qualRule as it is, and the bar stays 175.)
  const qualifying = (subCategory) => {
    const kind = entries.map((e) =>
      e.eventId === 's2'
        ? { eventId: e.eventId, data: { ...e.data, EventType: { ...e.data.EventType, SubCategory: subCategory } } }
        : e,
    );
    const pages = DEMO_SM_PAGES.flatMap((p) =>
      p.event === 'M Pituus'
        ? [{ ...p, round: 'Karsinta', time: '10:00', qualRule: { QRank: '175', QResult: '12' } }, p]
        : [p],
    );
    return t4rGraft(schedule, kind, pages)
      .events.find((e) => e.eventId === 's2')
      .data.Rounds.map((r) => [r.Name, r.QRank]);
  };
  assert.deepEqual(
    [qualifying('VerticalJump'), qualifying('Throw')],
    [
      [
        ['Karsinta', '1.75'],
        ['Loppukilpailu', ''],
      ],
      [
        ['Karsinta', '175'],
        ['Loppukilpailu', ''],
      ],
    ],
  );
  const lost = wanted.find((r) => r.event === 'M Pituus').href;
  assert.deepEqual(
    Object.keys(medalsOf(await t4rSitePages(read(lost), entries))),
    Object.keys(medalsOf(DEMO_SM_PAGES)).filter((name) => name !== 'M Pituus'),
    'a page that cannot be read costs its own event alone',
  );
  assert.deepEqual(await t4rSitePages(read(''), entries), [], 'no front page, no pages');
  // A page decodes as windows-1252, as a browser reads it (docs/elsewhere.md).
  // (Break on purpose: decode one byte per character, and the š is dropped.)
  assert.equal(t4rDecode(Uint8Array.from([0x4e, 0xe4, 0x79, 0x74, 0xf6, 0x9a]).buffer), 'Näytöš');
  console.log('t4rSitePages ok');

  // A championship with no meet here is the site alone (docs/elsewhere.md).
  // (Break on purpose: give t4rWanted an empty `own` with no eventResults.)
  const alone = {
    id: 'viestit-2026',
    name: 'SM-viestit',
    date: '2026-08-01',
    last: '2026-08-02',
    start: '11:00:00+03:00',
    t4r: '2026/demoviestit',
  };
  const site = t4rAloneMeet(
    alone,
    await t4rSitePages(read(), null),
    DEMO_ROAD_ORGS,
    { clubs: DEMO_ROAD_SPELLINGS },
    DEMO_DISTRICTS,
  );
  // (Break on purpose: anchor t4rAloneDays on the row's `date`, or give every
  // page that day. Both days are the first.)
  assert.deepEqual(
    Object.keys(site.schedule),
    ['1.8.2026', '2.8.2026'],
    "the front page is the row's last day and a directory names its weekday",
  );
  // (Break on purpose: count back from indexOf's -1, and the pages land on the
  // Saturday.)
  const odd = t4rAloneMeet(
    alone,
    (await t4rSitePages(read(), null)).map((p) => (p.dir ? { ...p, dir: 'xx/' } : p)),
    DEMO_ROAD_ORGS,
    { clubs: DEMO_ROAD_SPELLINGS },
    DEMO_DISTRICTS,
  );
  assert.deepEqual(Object.keys(odd.schedule), ['2.8.2026'], 'a directory that names no weekday is the last day');
  const relay = site.events.find((e) => e.data.Name.includes(' x '));
  // (Break on purpose: give every event TeamSize 1, and the relay's medal is
  // one person's.)
  assert.deepEqual(
    [
      relay.data.EventType,
      relay.data.Rounds[0].Status,
      relay.data.Rounds[0].Heats.flatMap((h) => h.Allocations).every((a) => a.TeamName),
    ],
    [{ Category: 'Relay', TeamSize: 4 }, 'Official', true],
    'an event whose name carries the leg count is a relay of made teams',
  );
  // (Break on purpose: drop elsewhereClubIndex, and no club has its own id.)
  const won = meetMedalsBody(site.schedule, site.events, DEMO_DISTRICTS, {
    name: alone.name,
    organiser: '',
    listed: true,
  }).table;
  assert.deepEqual(
    won.filter((c) => c.id === '3'),
    [{ id: '3', name: 'Testilän Kisa', medals: [8, 4, 0], total: 12 }],
    "a club the index knows takes its own id, and the medals are counted as any meet's",
  );
  // A made person takes a licence from the athlete index by name and club,
  // since a follow-list holds licences (watchTargets). (Break on purpose:
  // drop madeLicence, and neither row has a licence.)
  const malv = DEMO_ROAD_ORGS.find((o) => o.name === 'Mallikylän Vire').id;
  const licences = athleteLicences(
    mergeAthleteIndex(null, [{ licenseId: '77', organizationId: malv, name: 'Eino Mallinen' }], {
      year: 2026,
      todayIso: alone.date,
    }).index,
  );
  const known = t4rAloneMeet(
    alone,
    await t4rSitePages(read(), null),
    DEMO_ROAD_ORGS,
    { clubs: DEMO_ROAD_SPELLINGS },
    DEMO_DISTRICTS,
    licences,
  );
  const rows = (name) =>
    known.events
      .find((e) => e.data.Name === name)
      .data.Rounds.at(-1)
      .Heats.flatMap((h) => h.Allocations);
  assert.deepEqual(
    [
      rows('M 4 x 200 m')
        .flatMap((a) => a.AthleteOrders)
        .filter((o) => o.Athlete.LicenseId)
        .map((o) => o.Athlete.Id),
      rows('M 400 m')
        .filter((a) => a.Athletes[0].LicenseId)
        .map((a) => a.Name),
    ],
    [[`t4r-${malv}-einomallinen`], ['Eino Mallinen']],
    'a relay\u2019s leg and an individual row both take the index\u2019s licence',
  );
  // The leg count comes from the event's name (relayLineup). (Break on
  // purpose: give every relay of t4rAloneMeet four legs.)
  const pages = await t4rSitePages(read(), null);
  const teamSize = (name) =>
    t4rAloneMeet(
      alone,
      pages.map((p) => (/ x /.test(p.event) ? { ...p, event: name } : p)),
      DEMO_ROAD_ORGS,
      { clubs: DEMO_ROAD_SPELLINGS },
      DEMO_DISTRICTS,
    ).events.find((e) => e.data.Name === name).data.EventType.TeamSize;
  assert.deepEqual([teamSize('M 3 x 800 m'), teamSize('M 4 x 200 m')], [3, 4]);
  // With no entries the field is the people of the rounds, and a runner of
  // two rounds counts once. (Break on purpose: key aloneEntries by anything
  // but the id.)
  const quarter = known.events.find((e) => e.data.Name === 'M 400 m').data;
  assert.deepEqual(
    [quarter.Rounds.flatMap((r) => r.Heats.flatMap((h) => h.Allocations)).length, aloneEntries(quarter).length],
    [10, 6],
  );
  // That field is the roster a follow-list matches through. (Break on
  // purpose: drop madeName, and the rows have no name.)
  const roster = buildRoster(
    known.events.map(({ eventId, data }) => ({ eventId, data: { ...data, Enrollments: aloneEntries(data) } })),
  );
  assert.deepEqual(
    [
      roster.athletes.filter((a) => a.licenseId).map((a) => [a.name, a.licenseId]),
      roster.athletes.filter((a) => !a.name).length,
      new Set(roster.athletes.map((a) => a.id)).size === roster.athletes.length,
    ],
    [[['Eino Mallinen', '77']], 0, true],
    'the found licence is on the roster row, every row is named, and nobody is there twice',
  );
  console.log('t4rAloneMeet ok');
});

// --- olAloneMeet: a road championship off a mass race's files --------------
test("olAloneMeet: a road championship off a mass race's files", () => {
  const spellings = { clubs: DEMO_ROAD_SPELLINGS };
  const graft = olAloneMeet(DEMO_ROAD_ROW, DEMO_ROAD_FILES, DEMO_ROAD_ORGS, spellings, DEMO_DISTRICTS);
  const body = meetMedalsBody(graft.schedule, graft.events, DEMO_DISTRICTS, { name: DEMO_ROAD_ROW.name, listed: true });
  const sm = Object.fromEntries(
    scopeMedalStarts(medalSeasonRecord(body, 0, DEMO_ROAD_ROW.date), 'sm').map((s) => [
      s.start.EventName,
      s.medals.map(([id, medal]) => [medal, id]).sort(),
    ]),
  );
  // A finisher ranks by time. A club is its `clubs` spelling's abbreviation,
  // else its name, and of records with one name the one districts.json lists
  // wins, then the lowest id (elsewhereClubIndex).
  // (Break on purpose: rank by the file's order, compare the club names as
  // written, sort the index rows by id the other way, drop `spellings`, or
  // give the event's round an id the schedule row lacks.)
  assert.deepEqual(sm, {
    'M Maraton': [
      [1, '2'],
      [2, '1'],
      [3, '3'],
    ],
    'N Maraton': [
      [1, '1'],
      [2, '2'],
    ],
    'M40 Maraton': [[1, '3']],
  });
  // The record whose abbreviation a piiri lists beats a lower id. (Break on
  // purpose: sort by id alone.)
  const byHand = [{ id: '1', name: 'Testilän Kisa', nameShort: 'TK' }, ...DEMO_ROAD_ORGS.filter((o) => o.id !== '1')];
  assert.deepEqual(
    olAloneMeet(
      DEMO_ROAD_ROW,
      DEMO_ROAD_FILES,
      byHand,
      spellings,
      DEMO_DISTRICTS,
    ).events[2].data.Rounds[0].Heats[0].Allocations.map((a) => a.Organization.Id),
    ['3'],
  );
  // A club the index lacks keeps its medal in the race, under an id made of
  // its name.
  assert.deepEqual(
    [body.table.find((c) => c.id === 'ol-tuntemattomanjuoksijat')?.medals, body.unknown],
    [[0, 1, 0], ['Tuntemattoman Juoksijat']],
  );
  assert.deepEqual(
    body.athletes.find(([, name]) => name === 'Eino Mallinen'),
    ['aol-2-einomallinen', 'Eino Mallinen', null],
  );
  // The schedule is keyed by the day as a meet's page reads it, not by ISO.
  // (Break on purpose: key olSchedule by row.date.)
  assert.deepEqual(Object.keys(olSchedule(DEMO_ROAD_ROW)), ['8.8.2026']);
  // The classes share the race's mass start, so they group into one start.
  // (Break on purpose: leave BeginDateTimeWithTZ null.)
  const road = groupRounds(olSchedule(DEMO_ROAD_ROW)['8.8.2026']);
  assert.deepEqual(
    [road.length, road[0].key, road[0].entries.length],
    [1, '2026-08-08T09:00:00.0000000+00:00|Maraton', 3],
  );
  // A masters' class carries its age. (Break on purpose: give every class
  // age 0.)
  assert.deepEqual(
    graft.schedule['8.8.2026'].map((r) => [r.EventName, r.Age, r.Status]),
    [
      ['M Maraton', '0', 'Official'],
      ['N Maraton', '0', 'Official'],
      ['M40 Maraton', '40', 'Official'],
    ],
  );
  // A finish is written as a long run, with no tenths over the hour.
  // (Break on purpose: drop olTime's hour branch, or round the tenths up.)
  assert.deepEqual(
    [olTime(90149), olTime(36000), olTime(28805), olTime(35999), olTime(0)],
    ['2.30.14', '1.00.00', '48.00,5', '59.59,9', '0.00,0'],
  );
  // A finisher carries a place and a time, or the start shows a start list.
  // (Break on purpose: drop Result from olAloneMeet's allocation.)
  assert.deepEqual(
    graft.events[1].data.Rounds[0].Heats[0].Allocations.map((a) => [a.ResultRank, a.Result]),
    [
      [2, '2.40.00'],
      [1, '2.38.20'],
    ],
  );
  // The row's /properties names the championship and no organiser.
  assert.deepEqual(olProperties(DEMO_ROAD_ROW).Competition, {
    Name: 'SM-maraton',
    Organization: '',
    BeginDate: '2026-08-08',
  });
  assert.deepEqual(
    medalSeasonAges([{ cover: null, starts: scopeMedalStarts(medalSeasonRecord(body, 0, DEMO_ROAD_ROW.date), 'sm') }]),
    [0, 40],
  );
  assert.deepEqual(
    olAloneMeet(DEMO_ROAD_ROW, { event: null, competitors: null, results: {} }, []).events.map(
      (e) => e.data.Rounds[0].Heats[0].Allocations,
    ),
    [[], [], []],
    'files that did not load',
  );
  // olGraft puts the same race onto the meet that carries the entries. (Break
  // on purpose: take the class off `row.classes[data.Name]`, and the event
  // spelled with a second space keeps its empty round.)
  const onEntries = olGraft(
    DEMO_ROAD_SCHEDULE,
    DEMO_ROAD_EVENTS,
    DEMO_ROAD_COMP,
    DEMO_ROAD_FILES,
    DEMO_ROAD_ORGS,
    spellings,
    DEMO_DISTRICTS,
  );
  const grafted = (i) => onEntries.events[i].data.Rounds[0].Heats.flatMap((h) => h.Allocations);
  // (Break on purpose: give every finisher race.made(person), and each row
  // loses its licence and its club's id.)
  assert.deepEqual(
    grafted(0).map((a) => [a.Name, a.ResultRank, a.Result, a.Organization.Id, Boolean(a.Athletes[0].LicenseId)]),
    [
      ['Ilmo Kisanen', 4, '2.25.00', 3, true],
      ['Aarne Demoinen', 3, '2.23.20', 1, true],
      ['Onni Outonen', 2, '2.21.40', 'ol-tuntemattomanjuoksijat', false],
      ['Eino Mallinen', 1, '2.20.27', 2, true],
    ],
    "a finisher is the event's entry, with its club and its licence, and one entered nowhere is made",
  );
  assert.deepEqual(
    [
      grafted(2).length,
      ...Object.values(onEntries.schedule)
        .flat()
        .map((r) => r.Status),
    ],
    [1, 'Official', 'Official', 'Official'],
  );
  // On the meet's day the same classes are in progress. (Break on purpose:
  // ignore `official`.)
  const onTheDay = olGraft(
    DEMO_ROAD_SCHEDULE,
    DEMO_ROAD_EVENTS,
    DEMO_ROAD_COMP,
    DEMO_ROAD_FILES,
    DEMO_ROAD_ORGS,
    spellings,
    DEMO_DISTRICTS,
    null,
    false,
  );
  assert.deepEqual(
    [
      ...onTheDay.events.map((e) => e.data.Rounds[0].Status),
      ...Object.values(onTheDay.schedule)
        .flat()
        .map((r) => r.Status),
    ],
    Array(6).fill('Progress'),
  );
  // (Break on purpose: mark the round Official whether or not the class has
  // a finisher.)
  for (const classes of [{}, { 'N Maraton': 9 }]) {
    assert.deepEqual(
      olGraft(
        DEMO_ROAD_SCHEDULE,
        DEMO_ROAD_EVENTS,
        { ...DEMO_ROAD_COMP, classes },
        DEMO_ROAD_FILES,
        DEMO_ROAD_ORGS,
        spellings,
        DEMO_DISTRICTS,
      ),
      { schedule: DEMO_ROAD_SCHEDULE, events: DEMO_ROAD_EVENTS },
      'an event with no class of the race, and a class with no finisher, are left as they were',
    );
  }
  // A made person takes the licence the athlete index gives its name and club
  // (docs/elsewhere.md). (Break on purpose: drop madeLicence from olRace's
  // `made`.)
  const malv = DEMO_ROAD_ORGS.find((o) => o.name === 'Mallikylän Vire').id;
  const licences = athleteLicences(
    mergeAthleteIndex(null, [{ licenseId: '77', organizationId: malv, name: 'Eino Mallinen' }], {
      year: 2026,
      todayIso: DEMO_ROAD_ROW.date,
    }).index,
  );
  const known = olAloneMeet(DEMO_ROAD_ROW, DEMO_ROAD_FILES, DEMO_ROAD_ORGS, spellings, DEMO_DISTRICTS, licences);
  assert.deepEqual(
    meetMedalsBody(known.schedule, known.events, DEMO_DISTRICTS, {
      name: DEMO_ROAD_ROW.name,
      listed: true,
    }).athletes.find(([, name]) => name === 'Eino Mallinen'),
    [`aol-${malv}-einomallinen`, 'Eino Mallinen', '77'],
  );
  console.log('olAloneMeet ok');
});

// --- elsewhere.json: the championships whose results are on another site ---
test('elsewhere.json: the championships whose results are on another site', () => {
  assert.deepEqual(
    elsewhereProblems(elsewhere, districts),
    [],
    `elsewhere.json: ${elsewhereProblems(elsewhere, districts).join('; ')}`,
  );
  const row = elsewhere.meets[0];
  assert.deepEqual(elsewhereProblems({ meets: [row, { ...row, t4r: '../x' }, { comp: '7', t4r: row.t4r }] }), [
    `row 2: ${row.comp} is listed twice`,
    'row 2: t4r is not "<year>/<directory>"',
    'row 3: comp is not a meet id',
  ]);
  assert.deepEqual(elsewhereProblems({}), ['meets: not a list']);
  // (Break on purpose: drop a test from elsewhereProblems' standalone half.)
  const road = { ...DEMO_ROAD_ROW };
  assert.deepEqual(
    elsewhereProblems({
      meets: [
        road,
        road,
        {
          ...road,
          id: 'Maraton',
          name: ' ',
          location: '',
          date: '2025-08-08',
          start: '11.00',
          ol: '../x',
          classes: { Maraton: 5 },
        },
        { ...road, id: 'kavely-2026', last: road.date, classes: { 'M Maraton': '5' } },
      ],
    }),
    [
      'row 2: maraton-2026 is listed twice',
      'row 3: id is not "<word>-<year>"',
      'row 3: no name',
      'row 3: no location',
      "row 3: date is not a day of the id's year",
      'row 3: start is not a time of day and its offset',
      'row 3: ol is not an event id',
      'row 3: classes is not {"<class> <event>": <class id>}',
      "row 4: last is not a later day of date's year",
      'row 4: classes is not {"<class> <event>": <class id>}',
    ],
  );
  // (Break on purpose: drop the test of the abbreviation.)
  assert.deepEqual(
    elsewhereProblems(
      {
        meets: [road],
        clubs: {
          'Demon Urheilijat Demola': 'DemU',
          'demon urheilijat demola ry': 'DemU',
          ' ': 'DemU',
          'Testilän Kisa Testilä': 'TK',
        },
      },
      DEMO_DISTRICTS,
    ),
    [
      'clubs: "demon urheilijat demola ry" is spelled twice',
      'clubs: " " is no name',
      'clubs: "TK" is no club of districts.json',
    ],
  );
  assert.deepEqual(elsewhereRow({ meets: [road] }, 'maraton-2026'), road);
  // officialUrl is where a meet's results are published, for its title menu.
  // (Break on purpose: answer the mass race's url for a {comp, t4r} row, or
  // Tuloslista's for a demo.)
  assert.deepEqual(
    [
      officialUrl(road, road.id),
      officialUrl(row, row.comp),
      officialUrl(null, 20354),
      officialUrl(null, 'demo'),
      officialUrl({}, null),
    ],
    [
      'https://online.tulospalvelu.fi/tulokset-new/fi/2026_demomaraton/',
      `https://live.time4results.com/yu/${row.t4r}/`,
      'https://live.tuloslista.com/20354',
      null,
      null,
    ],
  );
  // The tag hashes the row and `clubs`. (Break on purpose: leave either out.)
  const tags = [
    { meets: [road] },
    { meets: [{ ...road, classes: { 'M Maraton': 5 } }] },
    { meets: [road], clubs: DEMO_ROAD_SPELLINGS },
  ].map((f) => elsewhereTag(f, road.id));
  assert.deepEqual(
    [
      new Set(tags).size,
      tags.every((t) => /^:elsewhere:[a-z0-9]+$/.test(t)),
      elsewhereTag(elsewhere, row.comp),
      elsewhereTag(elsewhere, 'demo'),
    ],
    [3, true, ':elsewhere:10', ''],
  );
  assert.deepEqual(
    [elsewhereRow(elsewhere, String(row.comp)), elsewhereRow(elsewhere, 'demo'), elsewhereRow(null, row.comp)],
    [row, null, null],
  );
  // A start view reads the graft once the meet's last day is past. (Break on
  // purpose: drop the day test, and a meet still running reads an empty graft.)
  const sched = { '8.8.2026': [{ Id: 1 }], '9.8.2026': [{ Id: 2 }] };
  assert.deepEqual(
    [
      graftApplies(elsewhere, row.comp, sched, '2026-08-10'),
      graftApplies(elsewhere, row.comp, sched, '2026-08-09'),
      graftApplies(elsewhere, 'demo', sched, '2026-08-10'),
      graftApplies(elsewhere, row.comp, {}, '2026-08-10'),
    ],
    [true, false, false, false],
  );
  // A race is read on its days too, from its first day on, and anything else
  // only once it is over. (Break on purpose: drop the `ol` test, or the first
  // day's.)
  assert.deepEqual(
    [
      graftPhase(DEMO_ROAD_COMP, sched, '2026-08-07'),
      graftPhase(DEMO_ROAD_COMP, sched, '2026-08-08'),
      graftPhase(DEMO_ROAD_COMP, sched, '2026-08-09'),
      graftPhase(DEMO_ROAD_COMP, sched, '2026-08-10'),
      graftPhase(row, sched, '2026-08-09'),
      graftPhase(null, sched, '2026-08-10'),
      graftApplies({ meets: [DEMO_ROAD_COMP] }, DEMO_ROAD_COMP.comp, sched, '2026-08-09'),
    ],
    [null, 'day', 'day', 'over', null, null, true],
  );
  // (Break on purpose: drop the name test, the row test or an end of the
  // window.)
  const file = { meets: [{ comp: 90001, t4r: '2026/smhallit' }, { id: 'viestit-2026' }] };
  const index = [
    { id: '90001', name: 'SM-hallit', date: '2026-09-01' },
    { id: '90002', name: 'SM-maastot', date: '2026-09-18' },
    { id: '90003', name: 'Kalevan kisat', date: '2026-08-01' },
    { id: '90004', name: 'Demolan kenttäkisat', date: '2026-09-01' },
    { id: '90005', name: 'TUL:n SM-kilpailut', date: '2026-09-01' },
    { id: '90006', name: 'SM-maastot', date: '2026-09-20' },
    { id: '90007', name: 'SM-hallit', date: '2026-07-01' },
  ];
  assert.deepEqual(
    elsewhereCandidates(index, file, '2026-09-21').map((m) => m.id),
    ['90002', '90003'],
  );
  // (Break on purpose: let a Progress round through, or drop the last day's
  // grace.)
  const entries = { '19.9.2026': [{ Status: 'Unallocated' }], '20.9.2026': [{ Status: 'Allocated' }] };
  assert.deepEqual(
    [
      elsewhereIsDue(entries, '2026-09-22'),
      elsewhereIsDue(entries, '2026-09-21'),
      elsewhereIsDue({ ...entries, '20.9.2026': [{ Status: 'Progress' }] }, '2026-09-22'),
      elsewhereIsDue({}, '2026-09-22'),
    ],
    [true, false, false, false],
  );
  // A yearly championship is due past its day with no row and no meet.
  // (Break on purpose: drop the SAUL test.)
  const saul = [
    { id: '90008', name: 'SAUL SM-maraton', date: '2026-10-03' },
    { id: '90009', name: 'PSM-viestit', date: '2026-08-26' },
  ];
  assert.deepEqual(
    [
      elsewhereYearlyDue(saul, file, '2026-11-02').map((c) => `${c.word}-${c.year}`),
      elsewhereYearlyDue(saul, { meets: [] }, '2026-10-02').map((c) => c.word),
      elsewhereYearlyDue([...saul, { id: '90010', name: 'SM-maraton', date: '2026-10-03' }], file, '2026-11-02'),
    ],
    [['maraton-2026'], ['viestit'], []],
  );
  console.log('elsewhere.json ok');
});

// --- elsewhereUpcoming: a championship run in a race, asked for its row before
// it runs ---
test('elsewhereUpcoming/elsewhereIsRace', () => {
  // (Break on purpose: drop the row test or an end of the window.)
  const file = { meets: [{ comp: 90011, ol: 'x', classes: {} }] };
  const index = [
    { id: '90011', name: 'SM-maastot', date: '2026-10-24' },
    { id: '90012', name: 'SAUL:n SM-maastot', date: '2026-10-25' },
    { id: '90013', name: 'Junnumaastot', date: '2026-10-25' },
    { id: '90014', name: 'SM-maantiejuoksut', date: '2026-11-08' },
    { id: '90015', name: 'SM-maastot', date: '2026-10-20' },
  ];
  assert.deepEqual(
    elsewhereUpcoming(index, file, '2026-10-21').map((m) => m.id),
    ['90012'],
  );
  // A `comp` row is checked again while its meet is in the same window.
  // (Break on purpose: drop an end of the window.)
  const rows = { meets: [...file.meets, { comp: 90015, t4r: '2026/x' }, { comp: 90016, t4r: '2026/y' }] };
  assert.deepEqual(
    [
      elsewhereRecheck(index, rows, '2026-10-21').map(({ row, meet }) => `${row.comp} ${meet.name}`),
      elsewhereRecheck(index, rows, '2027-01-01'),
    ],
    [['90011 SM-maastot', '90015 SM-maastot'], []],
  );
  // A half marathon entered under Track still counts by its name (2026-10).
  // (Break on purpose: read Category alone.)
  const day = (rows) => ({ '25.10.2026': rows });
  assert.deepEqual(
    [
      elsewhereIsRace(day([{ Category: 'Street', EventName: 'N30 Maantiejuoksu 6km' }])),
      elsewhereIsRace(DEMO_ROAD_SCHEDULE),
      elsewhereIsRace(day([{ Category: 'Track', EventName: 'N 100m' }])),
      elsewhereIsRace({}),
    ],
    [true, true, false, false],
  );
});

// --- olMissingClasses: an `ol` row against its meet ---
test('olMissingClasses', () => {
  // The demo meet names an event with a second space, which eventNameKey
  // reads as the row's name.
  // (Break on purpose: compare the names as written.)
  assert.deepEqual(olMissingClasses(DEMO_ROAD_COMP, DEMO_ROAD_SCHEDULE), []);
  const renamed = { ...DEMO_ROAD_COMP, classes: { ...DEMO_ROAD_COMP.classes, 'M40 Maastojuoksu': 7 } };
  assert.deepEqual(olMissingClasses(renamed, DEMO_ROAD_SCHEDULE), ['M40 Maastojuoksu']);
});
