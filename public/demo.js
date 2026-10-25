import { demoApiBody } from './lib/demo-api.js';
import { DEMO_CUP_FINAL_ID, DEMO_CUP_ID, DEMO_ID } from './lib/routes.js';

// The demo competitions (DEMO_MEETS) are invented, dated today and served
// with no network (demoResponse). They are also the offline test fixture, so
// each start's comment names the case it covers.

const DEMO_COMP_NAME = 'Testikilpailu';
const DEMO_CUP_COMP_NAME = 'Seuracup-testikilpailu';
const DEMO_CUP_FINAL_COMP_NAME = 'Seuracup-testifinaali';

// Returns today at h:m local time in the API's timestamp format, so the demo
// always runs today.
function demoTs(h, m) {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  const off = -d.getTimezoneOffset();
  const abs = Math.abs(off);
  const p2 = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` +
    `T${p2(h)}:${p2(m)}:00.0000000${off < 0 ? '-' : '+'}${p2(Math.floor(abs / 60))}:${p2(abs % 60)}`
  );
}

// Returns demoTs' instant under another offset than demoTs', as one class of a
// start can carry it (docs/tuloslista-api.md): +00:00, or +03:00 where the
// local zone is UTC.
function demoOtherTs(h, m) {
  const t = Date.parse(demoTs(h, m).replace(/\.\d+/, ''));
  const off = new Date(t).getTimezoneOffset() === 0 ? 3 : 0;
  const iso = new Date(t + off * 3_600_000).toISOString().slice(0, 19);
  return `${iso}.0000000+0${off}:00`;
}

// Derives a stable 8-digit licence from the athlete id, the shape of a real
// one. A follow-list stores the licence, because Athletes[].Id identifies an
// entry and not a person (docs/tuloslista-api.md, "Categories, names and
// identity").
function demoLicense(athleteId) {
  let n = 0;
  for (const ch of String(athleteId)) n = (n * 31 + ch.charCodeAt(0)) % 10000000;
  return String(60000000 + n);
}

// Every allocation of every meet carries SeuraCUPPoints
// (docs/tuloslista-api.md), and a row with no mark scores 0. The demo derives
// them from the rank. opts.cup sets them where a case needs an exact number.
const DEMO_CUP_NO_MARK = /^(DNS|DNF|DQ|NM|NH)$/i;

function demoCupPoints(opts = {}) {
  if (opts.cup != null) return opts.cup;
  if (!opts.result || DEMO_CUP_NO_MARK.test(opts.result) || opts.rank == null) return 0;
  return Math.max(140, 820 - (opts.rank - 1) * 70);
}

// Builds one athlete's track allocation. opts.rank is ResultRank, ranked over
// the whole round, and opts.heatRank is the placing in the heat, which defaults
// to it, as in a single-heat round (docs/tuloslista-api.md). opts.ku marks a
// guest.
function demoRunner(id, lane, bib, name, club, short, opts = {}) {
  return {
    Id: id,
    Position: lane,
    Number: bib,
    Name: name,
    Athletes: [
      {
        Id: `${id}-a`,
        LicenseId: demoLicense(`${id}-a`),
        Index: 0,
        Firstname: name.split(' ')[0],
        Surname: name.split(' ').slice(1).join(' '),
      },
    ],
    Organization: demoOrg(club, short),
    Result: opts.result || null,
    ResultRank: opts.rank ?? null,
    HeatRank: opts.heatRank ?? opts.rank ?? null,
    NotInCompetition: opts.ku || false,
    QRank: opts.QRank || false,
    QResult: opts.QResult || false,
    // Every allocation carries CEPoints, 0 outside a multi-event, so only the
    // event's IsCombinedEvent says to show it (docs/tuloslista-api.md).
    CEPoints: opts.ce ?? 0,
    SeuraCUPPoints: demoCupPoints(opts),
    SB: opts.sb || '',
    PB: opts.pb || '',
  };
}

// Builds one athlete's field allocation from attempts [[mark, wind?]], where a
// mark is a distance or height, "x" a foul and "-" a pass. opts.wind is the
// Result's own reading (docs/tuloslista-api.md). Other opts are demoRunner's.
function demoFieldAlloc(id, draw, bib, name, club, short, attempts, opts = {}) {
  return {
    Id: id,
    Position: draw,
    Number: bib,
    Name: name,
    Athletes: [
      {
        Id: `${id}-a`,
        LicenseId: demoLicense(`${id}-a`),
        Index: 0,
        Firstname: name.split(' ')[0],
        Surname: name.split(' ').slice(1).join(' '),
      },
    ],
    Organization: demoOrg(club, short),
    Attempts: attempts.map(([mark, wind]) => ({ Line1: mark, Line2: wind ?? null })),
    Result: opts.result || null,
    ResultRank: opts.rank ?? null,
    HeatRank: opts.heatRank ?? opts.rank ?? null,
    NotInCompetition: opts.ku || false,
    Wind: opts.wind ?? null,
    QRank: opts.QRank || false,
    QResult: opts.QResult || false,
    CEPoints: opts.ce ?? 0,
    SeuraCUPPoints: demoCupPoints(opts),
    // A drawn field start with no attempts yet shows the bests
    // (startListTable, app/event.js).
    SB: opts.sb || '',
    PB: opts.pb || '',
  };
}

// Builds one entered name of a relay team. org is the athlete's own club, which
// may not be the team's (docs/tuloslista-api.md). `licence` joins a runner to
// their individual entry, since a relay entry has its own Id.
function demoTeamAthlete({ id, name: [Firstname, Surname], licence }, index, org) {
  return {
    Id: id,
    LicenseId: licence || demoLicense(id),
    Index: index,
    Firstname,
    Surname,
    Organization: { Name: org.name, NameShort: org.short, Id: org.id },
  };
}

// Builds a relay team's allocation with its runners in leg order. The first
// `legs` of t.names run (relayLineup, lib/results.js), and the rest are a pool
// the club may still swap in.
function demoTeam(t, lane, bib, legs, opts = {}) {
  return {
    Id: t.id,
    Position: lane,
    Number: bib,
    Name: t.name,
    TeamName: t.name,
    Organization: { Name: t.org.name, NameShort: t.org.short, Id: t.org.id },
    AthleteOrders: t.names.slice(0, legs).map((n, i) => ({
      Index: i + 1,
      Athlete: demoTeamAthlete(n, i + 1, n.org || t.org),
    })),
    Result: opts.result || null,
    ResultRank: opts.rank ?? null,
    NotInCompetition: false,
    // A team carries CEPoints 0, and its own row scores the club in the cup
    // (docs/tuloslista-api.md).
    CEPoints: 0,
    SeuraCUPPoints: demoCupPoints(opts),
    SB: '',
    PB: '',
  };
}

// Builds the team's Enrollment with every entered name, the pool included,
// and no AthleteOrders, which an enrollment never carries
// (docs/tuloslista-api.md).
function demoTeamEnrollment(t) {
  return {
    // The enrollment shares the allocation's Id, as an individual's two halves
    // do. A drawn row's confirmation is a join on it (docs/tuloslista-api.md),
    // and test/home.test.mjs checks the join.
    Id: t.id,
    TeamId: t.id,
    Name: t.name,
    Firstname: t.name,
    Surname: t.name,
    Organization: { Name: t.org.name, NameShort: t.org.short, Id: t.org.id },
    Athletes: t.names.map((n, i) => demoTeamAthlete(n, i + 1, n.org || t.org)),
    // A relay confirms once as a team (docs/tuloslista-api.md).
    // t.unconfirmed clears the team's flag.
    Confirmed: t.unconfirmed !== true,
    SB: '',
    PB: '',
  };
}

// Holds the fixture's clubs. An allocation carries its enrollment's club id
// (demoOrg), as in the live API (docs/tuloslista-api.md). A club followed off a
// row's link (clubNameLink, app/follow.js) would otherwise cover nobody in the
// roster.
const DEMO_ORG_DEMU = { id: 1, name: 'Demon Urheilijat', short: 'DemU' };
const DEMO_ORG_MALV = { id: 2, name: 'Mallikylän Vire', short: 'MalV' };
const DEMO_ORG_TEKI = { id: 3, name: 'Testilän Kisa', short: 'TeKi' };
const DEMO_ORG_NAVA = { id: 4, name: 'Näyteniemen Vauhti', short: 'NäVa' };
const DEMO_ORG_ULKV = { id: 5, name: 'Ulkomaalainen Vieras', short: 'UlkV' };
const DEMO_ORG_HARJ = { id: 6, name: 'Harjoituspiirin Urheilijat', short: 'HarjU' };
const DEMO_ORG_ESPO = { id: 7, name: 'Esimerkkilän Ponnistus', short: 'EsPo' };
const DEMO_ORG_KOKI = { id: 8, name: 'Kokeilulan Kiri', short: 'KoKi' };
const DEMO_ORG_PIPY = { id: 9, name: 'Pistelän Pyrintö', short: 'PiPy' };
const DEMO_ORGS = [
  DEMO_ORG_DEMU,
  DEMO_ORG_MALV,
  DEMO_ORG_TEKI,
  DEMO_ORG_NAVA,
  DEMO_ORG_ULKV,
  DEMO_ORG_HARJ,
  DEMO_ORG_ESPO,
  DEMO_ORG_KOKI,
  DEMO_ORG_PIPY,
];

// Groups the demo's clubs into two invented piiris in districts.json's shape,
// for the medal tables per piiri (meetMedalsBody, lib/medals.js). A club left
// out of both fills the "Ei piiritietoa" line.
const DEMO_DISTRICTS = {
  alueet: [{ id: 'demolainen', name: 'Demolainen' }],
  piirit: [
    {
      id: 'demy',
      name: 'Demolan Yleisurheilu',
      short: 'DemY',
      alue: 'demolainen',
      clubs: ['DemU', 'TeKi'],
      names: ['Demon Urheilijat', 'Testilän Kisa'],
    },
    {
      id: 'maly',
      name: 'Mallimaan Yleisurheilu',
      short: 'MalY',
      alue: 'demolainen',
      clubs: ['MalV', 'NäVa'],
      names: ['Mallikylän Vire', 'Näyteniemen Vauhti'],
    },
  ],
};

// Builds an allocation's Organization from the row's club name and short name.
// A club missing from DEMO_ORGS gets id 0, which is the API's "no club"
// (docs/tuloslista-api.md).
function demoOrg(club, short) {
  const o = DEMO_ORGS.find((x) => x.short === short || x.name === club);
  return { Name: club, NameShort: short, Id: o ? o.id : 0 };
}

// Builds one entry of Enrollments. buildRoster reads only this half, so each
// athlete needs one to be in the picker. Before the meet a multi-event's
// standings are the entries (combinedTotals, lib/combined.js), so opts.ku is
// here too.
function demoEnrollment(id, bib, name, org, opts = {}) {
  return {
    Id: id,
    Number: bib,
    Name: name,
    Athletes: [
      {
        Id: `${id}-a`,
        LicenseId: demoLicense(`${id}-a`),
        Index: 0,
        Firstname: name.split(' ')[0],
        Surname: name.split(' ').slice(1).join(' '),
      },
    ],
    Organization: { Name: org.name, NameShort: org.short, Id: org.id },
    NotInCompetition: opts.ku || false,
    // Only an entry carries a confirmation, per entry and not per athlete, and
    // a drawn row's is a join on Id (docs/tuloslista-api.md). An entry confirms
    // unless opts.unconfirmed is set. The cup meets clear the flag afterwards.
    Confirmed: !opts.unconfirmed,
    SB: opts.sb || '',
    PB: opts.pb || '',
  };
}

// Builds one Rounds[] entry. qual is its Q/q rule (qualificationNote,
// lib/results.js), and status is its own copy, which may lag the schedule's
// (reconcileStatuses). previousRound walks by index, and without beginTs
// roundGroupKey links nowhere.
function demoRound(id, name, index, beginTs, heats, qual = {}, status = 'Official') {
  return {
    Id: id,
    Name: name,
    Index: index,
    BeginDateTimeWithTZ: beginTs,
    Heats: heats,
    Status: status,
    QRank: qual.QRank ?? '',
    QResult: qual.QResult ?? '',
    // Only a Final round scores in the cup (cupStandings, lib/cup.js). The
    // fixture sets it from the round's name. App code picks a round by Id, since
    // a round's name is no guide to which round it is (docs/tuloslista-api.md).
    RoundTypeCategory: name === 'Loppukilpailu' ? 'Final' : 'Qualify',
  };
}

// Builds a heat and copies its wind onto each allocation with none, since a
// track row's Wind equals its heat's (docs/tuloslista-api.md). resultWind
// (lib/results.js) reads that copy on a row the merged list took out of its heat.
function demoHeat(index, allocations, wind = null) {
  return {
    Index: index,
    Wind: wind,
    Allocations: allocations.map((a) => (a.Wind == null ? { ...a, Wind: wind } : a)),
  };
}

// --- The schedule: eventId -> round, all on today ---

const DEMO_STARTS = [
  // A track final with a guest in it has results, ranks and a wind.
  {
    eventId: 'e1',
    roundId: 'r1',
    event: 'M 100m',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Official',
    ts: demoTs(12, 0),
  },
  // A throw has six attempts a row, and its round's Status lags at Progress.
  {
    eventId: 'e2',
    roundId: 'r2',
    event: 'M Kuula',
    round: 'Loppukilpailu',
    category: 'Field',
    status: 'Official',
    ts: demoTs(12, 30),
  },
  // The Pituus Karsinta shares e3 with its final, and each round is a schedule
  // row of its own (docs/tuloslista-api.md). Its two heats are 3 and 2 attempts
  // wide, and it carries a Q and a q rule.
  {
    eventId: 'e3',
    roundId: 'r3q',
    event: 'N Pituus',
    round: 'Karsinta',
    category: 'Field',
    status: 'Official',
    ts: demoTs(11, 0),
  },
  // A vertical jump in progress has athletes who opened at different heights,
  // so the grid's columns are the union of every row's.
  {
    eventId: 'e4',
    roundId: 'r4',
    event: 'M Korkeus',
    round: 'Loppukilpailu',
    category: 'Field',
    status: 'Progress',
    ts: demoTs(13, 30),
  },
  // A relay names its legs. DEMO_RELAY_TEAMS holds the entries that trip a
  // follow-list, such as a runner from another club, and a team that ran
  // unconfirmed.
  {
    eventId: 'e5',
    roundId: 'r5',
    event: 'M 4x100m viesti',
    round: 'Loppukilpailu',
    category: 'Relay',
    status: 'Official',
    ts: demoTs(14, 0),
  },
  // No round exists, so Enrollments is the start list, one of two confirmed.
  {
    eventId: 'e6',
    roundId: 'r6',
    event: 'N Keihäs',
    round: 'Loppukilpailu',
    category: 'Field',
    status: 'Unallocated',
    ts: demoTs(15, 0),
  },
  // The horizontal jump's final has rows of 6 and 3 attempts under the WA
  // top-8 rule, and a Result carries the wind of its own attempt.
  {
    eventId: 'e3',
    roundId: 'r3',
    event: 'N Pituus',
    round: 'Loppukilpailu',
    category: 'Field',
    status: 'Official',
    ts: demoTs(13, 0),
  },
  // M is run and Official beside two classes nobody entered, so the status
  // splits by category (groupStatuses, lib/schedule.js). The hurdle setups
  // share their positions over two heights, and P13 has no setting at 400 m
  // (hurdleStartSetups).
  {
    eventId: 'e7',
    roundId: 'r7',
    event: 'M 400m aidat',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Official',
    ts: demoTs(15, 30),
  },
  {
    eventId: 'e8',
    roundId: 'r8',
    event: 'N 400m aidat',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Unallocated',
    ts: demoTs(15, 30),
  },
  // P13 sorts first by class and last by entrants, so the start renders M,
  // P13, N (compareCategories in lib/schedule.js, renderGroup in
  // app/event.js), since class labels do not sort as text
  // (docs/tuloslista-api.md).
  {
    eventId: 'e11',
    roundId: 'r11',
    event: 'P13 400m aidat',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Unallocated',
    ts: demoTs(15, 30),
  },
  // N 200m's three rounds share e9. Välierät is half run, so its q is still
  // pending (qualPending, lib/results.js). The undrawn final falls back to
  // Välierät's whole field (previousRoundField, lib/schedule.js).
  {
    eventId: 'e9',
    roundId: 'r9a',
    event: 'N 200m',
    round: 'Alkuerät',
    category: 'Track',
    status: 'Official',
    ts: demoTs(8, 30),
  },
  {
    eventId: 'e9',
    roundId: 'r9v',
    event: 'N 200m',
    round: 'Välierät',
    category: 'Track',
    status: 'Progress',
    ts: demoTs(9, 30),
  },
  {
    eventId: 'e9',
    roundId: 'r9f',
    event: 'N 200m',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Unallocated',
    ts: demoTs(10, 15),
  },
  // M 800m's two rounds share e10. Alkuerät is Official, so its q is settled
  // and the undrawn final narrows to its qualifiers (previousRoundField).
  {
    eventId: 'e10',
    roundId: 'r10a',
    event: 'M 800m',
    round: 'Alkuerät',
    category: 'Track',
    status: 'Official',
    ts: demoTs(9, 0),
  },
  {
    eventId: 'e10',
    roundId: 'r10f',
    event: 'M 800m',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Unallocated',
    ts: demoTs(10, 0),
  },
  // The counting relays (docs/lap-counter.md) are drawn and not yet run, the
  // state a race is in when the counter is opened on it. A 4x800 m is eight
  // crossings on a 400 m track and sixteen in a hall.
  {
    eventId: 'e12',
    roundId: 'r12',
    event: 'M15 4x800m viesti',
    round: 'Loppukilpailu',
    category: 'Relay',
    status: 'Allocated',
    ts: demoTs(16, 0),
  },
  // A shuttle hurdle relay's 240 m would be two crossings in a hall, but the
  // team passes the line once (docs/tuloslista-api.md).
  {
    eventId: 'e13',
    roundId: 'r13',
    event: 'P11 4x60m aitaviesti',
    round: 'Loppukilpailu',
    category: 'Relay',
    status: 'Allocated',
    ts: demoTs(16, 30),
  },
  // A 3x400 m is filed under the 4x400 m EventType, as a race can be
  // (docs/tuloslista-api.md). The name's three legs are the ones that match the
  // teams.
  {
    eventId: 'e14',
    roundId: 'r14',
    event: 'P9 3x400m viesti',
    round: 'Loppukilpailu',
    category: 'Relay',
    status: 'Allocated',
    ts: demoTs(17, 0),
  },
  // The changeover case is sized like a real 3x600m heat (DEMO_600_TEAMS).
  {
    eventId: 'e15',
    roundId: 'r15',
    event: 'T13 3x600m viesti',
    round: 'Loppukilpailu',
    category: 'Relay',
    status: 'Allocated',
    ts: demoTs(17, 30),
  },
  // The counter's individual race is being run, so no row has a result. Its
  // first crossing comes 300 m in on a 400 m track (firstSegment,
  // lib/lap-counter.js).
  {
    eventId: 'e16',
    roundId: 'r16',
    event: 'N 1500m',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Progress',
    ts: demoTs(11, 30),
  },
  // Two classes run the 3000m in the same two heats with their lanes
  // interleaved. The third class nobody entered holds the start's status at
  // Unallocated.
  {
    eventId: 'e17',
    roundId: 'r17',
    event: 'M 3000m',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Progress',
    ts: demoTs(14, 30),
  },
  {
    eventId: 'e18',
    roundId: 'r18',
    event: 'M19 3000m',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Progress',
    ts: demoTs(14, 30),
  },
  {
    eventId: 'e19',
    roundId: 'r19',
    event: 'M65 3000m',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Unallocated',
    ts: demoTs(14, 30),
  },
  // Two classes share one heat with results, placed as one race (heatPlaces,
  // lib/results.js). It holds a para class, a DNS, a guest and a wind that
  // prints.
  {
    eventId: 'e20',
    roundId: 'r20',
    event: 'M 200m kelaus T54',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Official',
    ts: demoTs(15, 45),
  },
  {
    eventId: 'e21',
    roundId: 'r21',
    event: 'M19 200m kelaus T54',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Official',
    ts: demoTs(15, 45),
  },
  // Two relay classes share one heat, and one team did not finish.
  {
    eventId: 'e22',
    roundId: 'r22',
    event: 'N15 4x400m viesti',
    round: 'Loppukilpailu',
    category: 'Relay',
    status: 'Official',
    ts: demoTs(18, 0),
  },
  {
    eventId: 'e23',
    roundId: 'r23',
    event: 'Mixed 15 4x400m viesti',
    round: 'Loppukilpailu',
    category: 'Relay',
    status: 'Official',
    ts: demoTs(18, 0),
  },
  // Two field classes in one start do not share a heat. Each draws its own
  // order from 1, as a field event always does (laneDrawn in lib/results.js,
  // docs/tuloslista-api.md). M15's row writes the start's time under another
  // offset, and the start is still one (roundGroupKey).
  {
    eventId: 'e24',
    roundId: 'r24',
    event: 'N15 Kolmiloikka',
    round: 'Loppukilpailu',
    category: 'Field',
    status: 'Official',
    ts: demoTs(13, 30),
  },
  {
    eventId: 'e25',
    roundId: 'r25',
    event: 'M15 Kolmiloikka',
    round: 'Loppukilpailu',
    category: 'Field',
    status: 'Official',
    ts: demoOtherTs(13, 30),
  },
  // Four classes share two heats down one draw. P13 is in heat 1, P11 in heat
  // 2, and T11 and T13 in both, so a class's own heat count can differ from
  // the start's. Real starts do both (docs/tuloslista-api.md, "Heats and
  // allocations").
  {
    eventId: 'e26',
    roundId: 'r26',
    event: 'T11 60m',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Official',
    ts: demoTs(10, 45),
  },
  {
    eventId: 'e27',
    roundId: 'r27',
    event: 'P11 60m',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Official',
    ts: demoTs(10, 45),
  },
  {
    eventId: 'e28',
    roundId: 'r28',
    event: 'T13 60m',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Official',
    ts: demoTs(10, 45),
  },
  {
    eventId: 'e29',
    roundId: 'r29',
    event: 'P13 60m',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Official',
    ts: demoTs(10, 45),
  },
  // Two track classes do not share their heat 1. Each drew its own lanes, so
  // the numbers collide (lanesAreOneDraw, lib/results.js), as a shared track
  // heat often does (docs/tuloslista-api.md).
  {
    eventId: 'e30',
    roundId: 'r30',
    event: 'M 400m',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Official',
    ts: demoTs(13, 45),
  },
  {
    eventId: 'e31',
    roundId: 'r31',
    event: 'M17 400m',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Official',
    ts: demoTs(13, 45),
  },
  // A round caught half-run has results in three of five heats. Each heat's
  // chip says which (heatChip, app/event.js).
  {
    eventId: 'e32',
    roundId: 'r32',
    event: 'N 100m',
    round: 'Alkuerät',
    category: 'Track',
    status: 'Progress',
    ts: demoTs(9, 45),
  },
  // A field start is drawn and not yet thrown, a throwing order with no
  // attempts in it (startListTable, app/event.js).
  {
    eventId: 'e33',
    roundId: 'r33',
    event: 'N Kiekko',
    round: 'Loppukilpailu',
    category: 'Field',
    status: 'Allocated',
    ts: demoTs(16, 15),
  },
  // A T9 3-ottelu's legs are tied by their names alone, and its root is on no
  // schedule (combinedEventStarts in lib/combined.js, docs/tuloslista-api.md).
  // The 40m is run, the Pituus half jumped and the Kuula drawn.
  {
    eventId: 'e34',
    roundId: 'r34',
    event: 'T9 3-ottelu  40m',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Official',
    ts: demoTs(8, 45),
  },
  {
    eventId: 'e35',
    roundId: 'r35',
    event: 'T9 3-ottelu  Pituus',
    round: 'Loppukilpailu',
    category: 'Field',
    status: 'Progress',
    ts: demoTs(10, 30),
  },
  {
    eventId: 'e36',
    roundId: 'r36',
    event: 'T9 3-ottelu  Kuula',
    round: 'Loppukilpailu',
    category: 'Field',
    status: 'Allocated',
    ts: demoTs(12, 45),
  },
  // A P9 3-ottelu's legs are drawn and not run. Its root is a heat shell, so
  // the standings are the entry list (combinedTotals, lib/combined.js).
  {
    eventId: 'e38',
    roundId: 'r38',
    event: 'P9 3-ottelu  40m',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Allocated',
    ts: demoTs(14, 30),
  },
  {
    eventId: 'e39',
    roundId: 'r39',
    event: 'P9 3-ottelu  Pituus',
    round: 'Loppukilpailu',
    category: 'Field',
    status: 'Allocated',
    ts: demoTs(15, 15),
  },
  {
    eventId: 'e40',
    roundId: 'r40',
    event: 'P9 3-ottelu  Kuula',
    round: 'Loppukilpailu',
    category: 'Field',
    status: 'Allocated',
    ts: demoTs(16, 0),
  },
  // This undrawn start comes half an hour before e6, so the day's confirmation
  // list counts two starts under two deadlines.
  {
    eventId: 'e45',
    roundId: 'r45',
    event: 'T13 Korkeus',
    round: 'Loppukilpailu',
    category: 'Field',
    status: 'Unallocated',
    ts: demoTs(14, 30),
  },
  // Nobody has confirmed in this undrawn start yet. A gate reading its own
  // data goes silent on it (docs/tuloslista-api.md).
  {
    eventId: 'e46',
    roundId: 'r46',
    event: 'T13 Kuula',
    round: 'Loppukilpailu',
    category: 'Field',
    status: 'Unallocated',
    ts: demoTs(15, 0),
  },
  // Three hurdle classes run one 60 m race on settings in different places,
  // as a measured start does (2026-01, docs/hurdles.md, "What the meets do"),
  // drawn here and not run. M65 is filed at its group's Age
  // (docs/tuloslista-api.md).
  {
    eventId: 'e47',
    roundId: 'r47',
    event: 'M17 60m aidat',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Allocated',
    ts: demoTs(10, 10),
  },
  {
    eventId: 'e48',
    roundId: 'r48',
    event: 'M50 60m aidat',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Allocated',
    ts: demoTs(10, 10),
  },
  {
    eventId: 'e49',
    roundId: 'r49',
    event: 'M65 60m aidat',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Allocated',
    ts: demoTs(10, 10),
    gender: 'Male',
    age: '30',
  },
  // The sekaviesti's class token is "M/N", and its round is filed under one
  // gender (docs/tuloslista-api.md), so gender and age carry the filing the
  // name cannot give.
  {
    eventId: 'e50',
    roundId: 'r50',
    event: 'M/N 4x100m aitaviesti',
    round: 'Loppukilpailu',
    category: 'Relay',
    status: 'Official',
    ts: demoTs(16, 45),
    gender: 'Male',
    age: '0',
  },
  // Two steeple classes share one bar, off a measured meet (2026-09), so the
  // box is one row naming both (steepleStartRows).
  {
    eventId: 'e51',
    roundId: 'r51',
    event: 'N 1500m esteet',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Allocated',
    ts: demoTs(14, 40),
  },
  {
    eventId: 'e52',
    roundId: 'r52',
    event: 'M15 1500m esteet',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Allocated',
    ts: demoTs(14, 40),
  },
  // T11 runs ten minutes after P11 on one setting, as at a measured meet
  // (docs/hurdles.md, "What the meets do"). The day sheet folds the two
  // (hurdleSheetBlocks, lib/hurdles.js).
  {
    eventId: 'e53',
    roundId: 'r53',
    event: 'T11 4x60m aitaviesti',
    round: 'Loppukilpailu',
    category: 'Relay',
    status: 'Allocated',
    ts: demoTs(16, 40),
  },
  // One M65 runs 100 m hurdles on a measured setting that is painted nowhere.
  // Only the undrawn phase is invented, and it leaves the taping figure on the
  // schedule row alone (hurdleTapes, lib/hurdles.js).
  {
    eventId: 'e54',
    roundId: 'r54',
    event: 'M65 100m aidat',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Unallocated',
    ts: demoTs(10, 0),
  },
  // A class nobody entered sits beside an entered one in a start still to
  // come, so its counts show where startFinished (lib/schedule.js) hides the
  // 400m aidat start's. A class nobody entered never advances
  // (docs/tuloslista-api.md, "Schedule and rounds").
  {
    eventId: 'e55',
    roundId: 'r55',
    event: 'P13 Kuula',
    round: 'Loppukilpailu',
    category: 'Field',
    status: 'Unallocated',
    ts: demoTs(15, 0),
  },
  // A T11 3-ottelu's legs are entered and undrawn, as a multi-event's legs can
  // be undrawn the day before it runs.
  {
    eventId: 'e56',
    roundId: 'r56',
    event: 'T11 3-ottelu  40m',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Unallocated',
    ts: demoTs(11, 15),
  },
  {
    eventId: 'e57',
    roundId: 'r57',
    event: 'T11 3-ottelu  Korkeus',
    round: 'Loppukilpailu',
    category: 'Field',
    status: 'Unallocated',
    ts: demoTs(12, 30),
  },
  {
    eventId: 'e58',
    roundId: 'r58',
    event: 'T11 3-ottelu  Kuula',
    round: 'Loppukilpailu',
    category: 'Field',
    status: 'Unallocated',
    ts: demoTs(16, 15),
  },
];

// Every event carries Enrollments unless nobody entered it, as the API keeps
// them event-wide, so buildRoster reaches every competitor. No two people may
// share a name and a club, relay pools included, or two picker rows look alike.
const DEMO_EVENTS = {};

DEMO_EVENTS.e1 = {
  Name: 'M 100m',
  EventCategory: 'Track',
  EventSubCategory: 'Sprint',
  EventType: { Length: 100, Category: 'Track', TeamSize: 1, Name: '100m' },
  // The four rows carry four shapes of bests (bestsParts, beatsMark,
  // lib/results.js). a1's agree and print as "PB&SB", and a2's differ. a3's
  // 11,55 passes his SB and not his PB, and the guest carries none.
  Enrollments: [
    demoEnrollment('a1', 11, 'Ville Mallinen', DEMO_ORG_DEMU, { sb: '11,20', pb: '11,20' }),
    demoEnrollment('a2', 12, 'Aleksi Testinen', DEMO_ORG_TEKI, { sb: '11,05', pb: '10,98' }),
    demoEnrollment('a3', 13, 'Kasperi Kokeinen', DEMO_ORG_NAVA, { sb: '11,62', pb: '11,30' }),
    demoEnrollment('a4', 14, 'Guest Runner', DEMO_ORG_ULKV),
  ],
  Rounds: [
    demoRound('r1', 'Loppukilpailu', 0, demoTs(12, 0), [
      demoHeat(
        1,
        [
          demoRunner('a1', 1, 11, 'Ville Mallinen', 'Demon Urheilijat', 'DemU', {
            result: '11,42',
            rank: 2,
            sb: '11,20',
            pb: '11,20',
          }),
          demoRunner('a2', 2, 12, 'Aleksi Testinen', 'Testilän Kisa', 'TeKi', {
            result: '11,18',
            rank: 1,
            sb: '11,05',
            pb: '10,98',
          }),
          demoRunner('a3', 3, 13, 'Kasperi Kokeinen', 'Näyteniemen Vauhti', 'NäVa', {
            result: '11,55',
            rank: 3,
            sb: '11,62',
            pb: '11,30',
          }),
          demoRunner('a4', 4, 14, 'Guest Runner', 'Ulkomaalainen Vieras', 'UlkV', {
            result: '10,95',
            ku: true,
            cup: 860,
          }),
        ],
        '−0,3',
      ),
    ]),
  ],
};

DEMO_EVENTS.e2 = {
  Name: 'M Kuula',
  EventCategory: 'Field',
  EventSubCategory: 'Throw',
  EventType: { Category: 'Field', SubCategory: 'Throw', Name: 'Kuula' },
  Enrollments: [
    demoEnrollment('b1', 21, 'Onni Harjoitinen', DEMO_ORG_DEMU),
    demoEnrollment('b2', 22, 'Eetu Näytteinen', DEMO_ORG_TEKI),
    demoEnrollment('b3', 23, 'Akseli Esimerkkinen', DEMO_ORG_NAVA),
  ],
  // The schedule says Official and this copy says Progress, as a finished
  // round's stale results copy does (docs/tuloslista-api.md). Without
  // reconcileStatuses the placings stay muted beside "Tulokset valmiit".
  Rounds: [
    demoRound(
      'r2',
      'Loppukilpailu',
      0,
      demoTs(12, 30),
      [
        demoHeat(1, [
          demoFieldAlloc(
            'b1',
            1,
            21,
            'Onni Harjoitinen',
            'Demon Urheilijat',
            'DemU',
            [['14.20'], ['x'], ['14.55'], ['x'], ['14.61'], ['-']],
            { result: '14.61', rank: 1 },
          ),
          demoFieldAlloc(
            'b2',
            2,
            22,
            'Eetu Näytteinen',
            'Testilän Kisa',
            'TeKi',
            [['x'], ['13.90'], ['x'], ['13.75'], ['x'], ['14.02']],
            { result: '14.02', rank: 2 },
          ),
          demoFieldAlloc(
            'b3',
            3,
            23,
            'Akseli Esimerkkinen',
            'Näyteniemen Vauhti',
            'NäVa',
            [['x'], ['x'], ['x'], ['x'], ['x'], ['x']],
            { result: null, rank: null },
          ),
        ]),
      ],
      {},
      'Progress',
    ),
  ],
};

DEMO_EVENTS.e3 = {
  Name: 'N Pituus',
  EventCategory: 'Field',
  EventSubCategory: 'HorizontalJump',
  EventType: { Category: 'Field', SubCategory: 'HorizontalJump', Name: 'Pituus' },
  // One row per person over both rounds. c1 and c2 jump in the final only.
  Enrollments: [
    demoEnrollment('c1', 31, 'Silvia Kokeinen', DEMO_ORG_HARJ, { sb: '5.55', pb: '5.55' }),
    demoEnrollment('c2', 32, 'Katri Testinen', DEMO_ORG_HARJ, { sb: '4.88', pb: '4.95' }),
    demoEnrollment('c3', 33, 'Ronja Merkkinen', DEMO_ORG_DEMU),
    demoEnrollment('c4', 34, 'Iina Demoinen', DEMO_ORG_TEKI),
    demoEnrollment('c5', 35, 'Sofia Mittainen', DEMO_ORG_NAVA),
    demoEnrollment('c6', 36, 'Venla Simulainen', DEMO_ORG_HARJ),
  ],
  Rounds: [
    // QRank is the automatic mark and QResult the field size after fill-ins,
    // as a field event's rule has them (docs/tuloslista-api.md). Heat 2 takes
    // heat 1's three attempt columns, or its rows would not line up.
    demoRound(
      'r3q',
      'Karsinta',
      0,
      demoTs(11, 0),
      [
        demoHeat(1, [
          // In the top 12 without reaching 5.25, so she gets the "q".
          demoFieldAlloc(
            'c5',
            1,
            35,
            'Sofia Mittainen',
            'Näyteniemen Vauhti',
            'NäVa',
            [
              ['4.40', '+0,1'],
              ['4.55', '−0,2'],
              ['4.60', '+0,4'],
            ],
            { result: '4.60', rank: 8, heatRank: 1, wind: '+0,4', QResult: true },
          ),
          // She misses both cuts and gets no badge.
          demoFieldAlloc(
            'c6',
            2,
            36,
            'Venla Simulainen',
            'Harjoituspiirin Urheilijat',
            'HarjU',
            [
              ['4.10', '+0,1'],
              ['4.05', '−0,2'],
              ['4.15', '+0,3'],
            ],
            { result: '4.15', rank: 13, heatRank: 2, wind: '+0,3' },
          ),
        ]),
        // Both passed 5.25 and stopped early, as an athlete with the automatic
        // mark may. A short Attempts here is not the top-8 rule
        // (docs/tuloslista-api.md).
        demoHeat(2, [
          demoFieldAlloc(
            'c4',
            1,
            34,
            'Iina Demoinen',
            'Testilän Kisa',
            'TeKi',
            [
              ['5.10', '+0,1'],
              ['5.40', '+0,2'],
            ],
            { result: '5.40', rank: 1, heatRank: 1, wind: '+0,2', QRank: true },
          ),
          demoFieldAlloc('c3', 2, 33, 'Ronja Merkkinen', 'Demon Urheilijat', 'DemU', [['5.35', '+0,2']], {
            result: '5.35',
            rank: 2,
            heatRank: 2,
            wind: '+0,2',
            QRank: true,
          }),
        ]),
      ],
      { QRank: '5.25', QResult: '12' },
    ),
    demoRound('r3', 'Loppukilpailu', 1, demoTs(13, 0), [
      // The 3-attempt row comes first, so a table sized off the first row
      // would cut c1's last three. A jump's heat has no wind, so a row takes
      // the wind of its Result's attempt (resultWind, beatsMark, lib/results.js).
      demoHeat(1, [
        // Outside the top 8, so she stops at three. Her 4.90 in +0,1 passes
        // her 4.88 SB legally.
        demoFieldAlloc(
          'c2',
          2,
          32,
          'Katri Testinen',
          'Harjoituspiirin Urheilijat',
          'HarjU',
          [
            ['4.85', '+0,2'],
            ['4.72', '−0,4'],
            ['4.90', '+0,1'],
          ],
          { result: '4.90', rank: 9, wind: '+0,1', sb: '4.88', pb: '4.95' },
        ),
        // She makes the top 8 and jumps six times. Her 5.61 and its +2,3 come
        // from attempt 4 and not the last. It passes her 5.55 PB&SB wind-aided,
        // so both stay muted.
        demoFieldAlloc(
          'c1',
          1,
          31,
          'Silvia Kokeinen',
          'Harjoituspiirin Urheilijat',
          'HarjU',
          [
            ['5.42', '+0,3'],
            ['x', null],
            ['5.55', '−0,1'],
            ['5.61', '+2,3'],
            ['x', null],
            ['5.48', '+1,1'],
          ],
          { result: '5.61', rank: 1, wind: '+2,3', sb: '5.55', pb: '5.55' },
        ),
      ]),
    ]),
  ],
};

DEMO_EVENTS.e4 = {
  Name: 'M Korkeus',
  EventCategory: 'Field',
  EventSubCategory: 'VerticalJump',
  EventType: { Category: 'Field', SubCategory: 'VerticalJump', Name: 'Korkeus' },
  Enrollments: [
    demoEnrollment('d1', 41, 'Joel Esimerkkinen', DEMO_ORG_DEMU),
    demoEnrollment('d2', 43, 'Veikko Mittainen', DEMO_ORG_NAVA),
    demoEnrollment('d3', 42, 'Aada Harjoitinen', DEMO_ORG_TEKI),
    demoEnrollment('d4', 44, 'Iiro Vierainen', DEMO_ORG_ULKV),
    demoEnrollment('d5', 45, 'Aatu Vierainen', DEMO_ORG_ULKV),
  ],
  // The bests are in metres and the Results in centimetres, as a vertical
  // jump's can be (docs/tuloslista-api.md). d2's 190 passes its 1.88 and d1's
  // 195 passes neither best. A wrong unit lights both or neither.
  Rounds: [
    demoRound(
      'r4',
      'Loppukilpailu',
      0,
      demoTs(13, 30),
      [
        demoHeat(1, [
          // d2 opens at 190, so the row has no 180 or 185. It comes first, so a
          // grid built off the first row's heights would lose those two columns.
          demoFieldAlloc(
            'd2',
            3,
            43,
            'Veikko Mittainen',
            'Näyteniemen Vauhti',
            'NäVa',
            [
              ['190', 'o'],
              ['195', 'xxx'],
            ],
            { result: '190', rank: 2, pb: '1.88', sb: '1.88' },
          ),
          demoFieldAlloc(
            'd1',
            1,
            41,
            'Joel Esimerkkinen',
            'Demon Urheilijat',
            'DemU',
            [
              ['180', 'o'],
              ['185', 'o'],
              ['190', 'xo'],
              ['195', 'xxo'],
            ],
            { result: '195', rank: 1, pb: '1.98', sb: '1.95' },
          ),
          // d3 cleared nothing, so the Result is the code "NH".
          // Number("NH")/100 is NaN and not a missing result.
          demoFieldAlloc('d3', 2, 42, 'Aada Harjoitinen', 'Testilän Kisa', 'TeKi', [['180', 'xxx']], {
            result: 'NH',
            rank: null,
          }),
          // A guest has no rank (docs/tuloslista-api.md), so sortResults orders
          // these two by their jumps. Both clear 190 and d5 does it at the first
          // try, so d5 leads although drawn after d4.
          demoFieldAlloc(
            'd4',
            4,
            44,
            'Iiro Vierainen',
            'Ulkomaalainen Vieras',
            'UlkV',
            [
              ['180', 'o'],
              ['185', 'o'],
              ['190', 'xo'],
              ['195', 'xxx'],
            ],
            { result: '190', ku: true, cup: 690 },
          ),
          demoFieldAlloc(
            'd5',
            5,
            45,
            'Aatu Vierainen',
            'Ulkomaalainen Vieras',
            'UlkV',
            [
              ['180', 'xo'],
              ['185', 'o'],
              ['190', 'o'],
              ['195', 'xxx'],
            ],
            { result: '190', ku: true, cup: 690 },
          ),
        ]),
      ],
      {},
      'Progress',
    ),
  ],
};

// f1 enters five names for four legs and two are from another club, as a real
// team can (docs/tuloslista-api.md). A follow-list entry for the Mallikylän
// Vire club must match neither of those two, and one for Tuomas must match f1.
const DEMO_RELAY_TEAMS = [
  {
    id: 'f1',
    name: 'Demon Urheilijat',
    org: DEMO_ORG_DEMU,
    names: [
      // Ville is e1's a1 too. This row mints its own Id and shares his licence,
      // so buildDigest names him once (docs/tuloslista-api.md).
      { id: 'f1-0', name: ['Ville', 'Mallinen'], licence: demoLicense('a1-a') },
      { id: 'f1-1', name: ['Joonas', 'Testinen'] },
      { id: 'f1-2', name: ['Tuomas', 'Kokeinen'], org: DEMO_ORG_MALV },
      { id: 'f1-3', name: ['Riku', 'Harjoitinen'] },
      // Nea is e6's g2. She is in the pool and does not run.
      { id: 'g2-a', name: ['Nea', 'Merkkinen'], org: DEMO_ORG_MALV },
    ],
  },
  // A relay confirms once, as a team (docs/tuloslista-api.md). This one ran
  // without confirming, the team case of e16's k6.
  {
    id: 'f2',
    name: 'Mallikylän Vire',
    org: DEMO_ORG_MALV,
    unconfirmed: true,
    names: [
      { id: 'f2-0', name: ['Aleksi', 'Näytteinen'] },
      { id: 'f2-1', name: ['Markus', 'Esimerkkinen'] },
      { id: 'f2-2', name: ['Elias', 'Simulainen'] },
      { id: 'f2-3', name: ['Niilo', 'Demoinen'] },
    ],
  },
];

DEMO_EVENTS.e5 = {
  Name: 'M 4x100m viesti',
  EventCategory: 'Relay',
  EventSubCategory: 'Sprint',
  EventType: { Length: 100, Category: 'Relay', TeamSize: 4, Name: '4x100m viesti' },
  Enrollments: DEMO_RELAY_TEAMS.map(demoTeamEnrollment),
  Rounds: [
    demoRound('r5', 'Loppukilpailu', 0, demoTs(14, 0), [
      demoHeat(1, [
        demoTeam(DEMO_RELAY_TEAMS[0], 1, 91, 4, { result: '42,18', rank: 1 }),
        demoTeam(DEMO_RELAY_TEAMS[1], 2, 92, 4, { result: '42,55', rank: 2 }),
      ]),
    ]),
  ],
};

DEMO_EVENTS.e6 = {
  Name: 'N Keihäs',
  EventCategory: 'Field',
  EventSubCategory: 'Throw',
  EventType: { Category: 'Field', SubCategory: 'Throw', Name: 'Keihäs' },
  // g1 has confirmed and g2 has not, as confirmation is per entry
  // (docs/tuloslista-api.md).
  Enrollments: [
    demoEnrollment('g1', 51, 'Emma Mittainen', DEMO_ORG_DEMU, { sb: '38.20', pb: '39.05' }),
    demoEnrollment('g2', 52, 'Nea Merkkinen', DEMO_ORG_MALV, { sb: '36.80', pb: '37.40', unconfirmed: true }),
  ],
  Rounds: [],
};

DEMO_EVENTS.e7 = {
  Name: 'M 400m aidat',
  EventCategory: 'Track',
  EventSubCategory: 'Hurdles',
  EventType: { Length: 400, Category: 'Track', TeamSize: 1, Name: '400m aidat' },
  Enrollments: [
    demoEnrollment('h1', 31, 'Leevi Mittainen', DEMO_ORG_DEMU),
    demoEnrollment('h2', 32, 'Roope Esimerkkinen', DEMO_ORG_MALV),
  ],
  // The heat carries a wind the page must not print, since a reading governs
  // only 200 m or less (heatWind, lib/results.js, docs/tuloslista-api.md).
  Rounds: [
    demoRound('r7', 'Loppukilpailu', 0, demoTs(15, 30), [
      demoHeat(
        1,
        [
          demoRunner('h1', 1, 31, 'Leevi Mittainen', 'Demon Urheilijat', 'DemU', { result: '54,80', rank: 2 }),
          demoRunner('h2', 2, 32, 'Roope Esimerkkinen', 'Mallikylän Vire', 'MalV', { result: '53,95', rank: 1 }),
        ],
        '−1,7',
      ),
    ]),
  ],
};

// No round and no Enrollments keep e8 Unallocated for good. The event view
// shows "Ei ilmoittautuneita." under its own heading.
DEMO_EVENTS.e8 = {
  Name: 'N 400m aidat',
  EventCategory: 'Track',
  EventSubCategory: 'Hurdles',
  EventType: { Length: 400, Category: 'Track', TeamSize: 1, Name: '400m aidat' },
  Enrollments: [],
  Rounds: [],
};

// Nobody entered e11 either, but its round carries a heat shell with no
// Allocations, as an undrawn round can (docs/tuloslista-api.md).
// Heats.length reads it as drawn, and roundAllocated does not.
DEMO_EVENTS.e11 = {
  Name: 'P13 400m aidat',
  EventCategory: 'Track',
  EventSubCategory: 'Hurdles',
  EventType: { Length: 400, Category: 'Track', TeamSize: 1, Name: '400m aidat' },
  Enrollments: [],
  Rounds: [demoRound('r11', 'Loppukilpailu', 0, demoTs(15, 30), [demoHeat(1, [])], {}, 'Unallocated')],
};

DEMO_EVENTS.e9 = {
  Name: 'N 200m',
  EventCategory: 'Track',
  EventSubCategory: 'Sprint',
  EventType: { Length: 200, Category: 'Track', TeamSize: 1, Name: '200m' },
  Enrollments: [
    // Only i1 carries bests, as an entry publishes them or not
    // (docs/tuloslista-api.md, "`PB` and `SB` are published per entry"). Hers
    // let dev/probe-pending.js tell a club line that dropped a round from an
    // empty one.
    demoEnrollment('i1', 61, 'Elina Vauhtinen', DEMO_ORG_DEMU, { sb: '24,88', pb: '24,88' }),
    demoEnrollment('i2', 62, 'Sara Testinen', DEMO_ORG_TEKI),
    demoEnrollment('i3', 63, 'Milla Kokeinen', DEMO_ORG_NAVA),
    demoEnrollment('i4', 64, 'Nea Harjoitinen', DEMO_ORG_MALV),
    demoEnrollment('i5', 65, 'Aino Simulainen', DEMO_ORG_DEMU),
    demoEnrollment('i6', 66, 'Vilma Esimerkkinen', DEMO_ORG_TEKI),
    demoEnrollment('i7', 67, 'Ronja Näytteinen', DEMO_ORG_NAVA),
    demoEnrollment('i8', 68, 'Iida Mittainen', DEMO_ORG_MALV),
  ],
  Rounds: [
    // The heats come as 1, 3, 4, 2, out of order as the API sends them, for
    // heatsInOrder to sort (docs/tuloslista-api.md). Ranks are round-wide,
    // which Kokonaistulokset merges by (totalResults). Four Q and two q fill
    // Välierät's six.
    demoRound(
      'r9a',
      'Alkuerät',
      0,
      demoTs(8, 30),
      [
        demoHeat(
          1,
          [
            demoRunner('i1', 1, 61, 'Elina Vauhtinen', 'Demon Urheilijat', 'DemU', {
              result: '25,10',
              rank: 2,
              heatRank: 1,
              QRank: true,
              sb: '24,88',
              pb: '24,88',
            }),
            demoRunner('i2', 2, 62, 'Sara Testinen', 'Testilän Kisa', 'TeKi', {
              result: '25,80',
              rank: 6,
              heatRank: 2,
              QResult: true,
            }),
          ],
          '+0,2',
        ),
        demoHeat(
          3,
          [
            demoRunner('i5', 1, 65, 'Aino Simulainen', 'Demon Urheilijat', 'DemU', {
              result: '25,20',
              rank: 3,
              heatRank: 1,
              QRank: true,
            }),
            // i6 and i2 have the fastest times outside the Q places, so both get
            // a q ahead of i4 and i8.
            demoRunner('i6', 2, 66, 'Vilma Esimerkkinen', 'Testilän Kisa', 'TeKi', {
              result: '25,75',
              rank: 5,
              heatRank: 2,
              QResult: true,
            }),
          ],
          '+0,1',
        ),
        demoHeat(
          4,
          [
            demoRunner('i7', 1, 67, 'Ronja Näytteinen', 'Näyteniemen Vauhti', 'NäVa', {
              result: '25,30',
              rank: 4,
              heatRank: 1,
              QRank: true,
            }),
            demoRunner('i8', 2, 68, 'Iida Mittainen', 'Mallikylän Vire', 'MalV', {
              result: '26,50',
              rank: 8,
              heatRank: 2,
            }),
          ],
          '0,0',
        ),
        demoHeat(
          2,
          [
            demoRunner('i3', 1, 63, 'Milla Kokeinen', 'Näyteniemen Vauhti', 'NäVa', {
              result: '25,05',
              rank: 1,
              heatRank: 1,
              QRank: true,
            }),
            demoRunner('i4', 2, 64, 'Nea Harjoitinen', 'Mallikylän Vire', 'MalV', {
              result: '26,20',
              rank: 7,
              heatRank: 2,
            }),
          ],
          '−0,1',
        ),
      ],
      { QRank: '1', QResult: '2' },
    ),
    // Heat 1 is run and heat 2 is not, so the round stays Progress. i1's Q
    // stands, but heat 2 could still beat i2's q, so it renders muted
    // (qualPending, lib/results.js). Heat 2's three are drawn with no Result.
    demoRound(
      'r9v',
      'Välierät',
      1,
      demoTs(9, 30),
      [
        demoHeat(
          1,
          [
            demoRunner('i1', 1, 61, 'Elina Vauhtinen', 'Demon Urheilijat', 'DemU', {
              result: '25,00',
              rank: 1,
              QRank: true,
              sb: '24,88',
              pb: '24,88',
            }),
            demoRunner('i2', 2, 62, 'Sara Testinen', 'Testilän Kisa', 'TeKi', {
              result: '25,40',
              rank: 2,
              QResult: true,
            }),
            demoRunner('i5', 3, 65, 'Aino Simulainen', 'Demon Urheilijat', 'DemU', { result: '25,90', rank: 3 }),
          ],
          '+0,3',
        ),
        // 'NM' is the API's "not measured" (docs/tuloslista-api.md) and must
        // not print as a wind. A 200 m passes the distance gate, so only the
        // sentinel check keeps it off the page.
        demoHeat(
          2,
          [
            demoRunner('i3', 1, 63, 'Milla Kokeinen', 'Näyteniemen Vauhti', 'NäVa'),
            demoRunner('i6', 2, 66, 'Vilma Esimerkkinen', 'Testilän Kisa', 'TeKi'),
            demoRunner('i7', 3, 67, 'Ronja Näytteinen', 'Näyteniemen Vauhti', 'NäVa'),
          ],
          'NM',
        ),
      ],
      { QRank: '1', QResult: '1' },
      'Progress',
    ),
    // The final is not drawn, so previousRoundField (lib/schedule.js) falls
    // back to Välierät. That round is not Official, so the field is all six of
    // its entrants and not only its qualifiers.
    demoRound('r9f', 'Loppukilpailu', 2, demoTs(10, 15), [], {}, 'Unallocated'),
  ],
};

// The contrast to e9: Alkuerät is Official, so j2's q renders solid.
DEMO_EVENTS.e10 = {
  Name: 'M 800m',
  EventCategory: 'Track',
  EventSubCategory: 'MiddleDistance',
  EventType: { Length: 800, Category: 'Track', TeamSize: 1, Name: '800m' },
  Enrollments: [
    demoEnrollment('j1', 71, 'Eetu Vauhtinen', DEMO_ORG_DEMU),
    demoEnrollment('j2', 72, 'Otto Testinen', DEMO_ORG_TEKI),
    demoEnrollment('j3', 73, 'Aku Kokeinen', DEMO_ORG_NAVA),
    demoEnrollment('j4', 74, 'Veeti Harjoitinen', DEMO_ORG_MALV),
  ],
  Rounds: [
    // Two Q and one q take three of four through. Ranks are round-wide, so
    // heat 2's winner is 2nd.
    demoRound(
      'r10a',
      'Alkuerät',
      0,
      demoTs(9, 0),
      [
        demoHeat(1, [
          demoRunner('j1', 1, 71, 'Eetu Vauhtinen', 'Demon Urheilijat', 'DemU', {
            result: '1.52,10',
            rank: 1,
            heatRank: 1,
            QRank: true,
          }),
          demoRunner('j2', 2, 72, 'Otto Testinen', 'Testilän Kisa', 'TeKi', {
            result: '1.53,40',
            rank: 3,
            heatRank: 2,
            QResult: true,
          }),
        ]),
        demoHeat(2, [
          demoRunner('j3', 1, 73, 'Aku Kokeinen', 'Näyteniemen Vauhti', 'NäVa', {
            result: '1.52,50',
            rank: 2,
            heatRank: 1,
            QRank: true,
          }),
          // j2's 1.53,40 in heat 1 beats this, so the one q is j2's. A q is
          // picked across the round and not per heat.
          demoRunner('j4', 2, 74, 'Veeti Harjoitinen', 'Mallikylän Vire', 'MalV', {
            result: '1.54,00',
            rank: 4,
            heatRank: 2,
          }),
        ]),
      ],
      { QRank: '1', QResult: '1' },
    ),
    // The final is not drawn. Alkuerät is Official, so previousRoundField
    // narrows the field to its qualifiers j1, j3 and j2.
    demoRound('r10f', 'Loppukilpailu', 1, demoTs(10, 0), [], {}, 'Unallocated'),
  ],
};

// Eight runners are drawn and running with no Result, the lap counter's own
// case (docs/lap-counter.md). lapPrompts paces each off the SB or, without
// one, the PB. So a row carries both, a PB alone or neither.
DEMO_EVENTS.e16 = {
  Name: 'N 1500m',
  EventCategory: 'Track',
  EventSubCategory: 'MiddleDistance',
  EventType: { Length: 1500, Category: 'Track', TeamSize: 1, Name: '1500m' },
  Enrollments: [
    demoEnrollment('k1', 301, 'Anni Vauhtinen', DEMO_ORG_DEMU, { sb: '4.18,90', pb: '4.15,02' }),
    demoEnrollment('k2', 302, 'Helmi Testinen', DEMO_ORG_TEKI, { sb: '4.20,15', pb: '4.19,80' }),
    demoEnrollment('k3', 303, 'Aada Kokeinen', DEMO_ORG_NAVA, { pb: '4.20,11' }),
    demoEnrollment('k4', 304, 'Siiri Merkkinen', DEMO_ORG_MALV, { sb: '4.22,88', pb: '4.22,88' }),
    demoEnrollment('k5', 305, 'Nella Näytteinen', DEMO_ORG_HARJ, { sb: '4.24,50', pb: '4.22,90' }),
    // She is drawn without confirming, as when a referee waves somebody
    // through (docs/tuloslista-api.md). The counter still gives her a tile.
    demoEnrollment('k6', 306, 'Pinja Demoinen', DEMO_ORG_DEMU, { unconfirmed: true }),
    demoEnrollment('k7', 307, 'Roosa Simulainen', DEMO_ORG_TEKI, { sb: '4.27,12', pb: '4.24,08' }),
    demoEnrollment('k8', 308, 'Kerttu Mittainen', DEMO_ORG_NAVA, { pb: '4.28,12' }),
    // She is unconfirmed and in no heat, as a meet that draws only the
    // confirmed leaves her (docs/tuloslista-api.md). She renders the
    // "Ei erissä" section (docs/views.md).
    demoEnrollment('k9', 309, 'Iida Vauhtinen', DEMO_ORG_HARJ, { sb: '4.30,00', pb: '4.29,15', unconfirmed: true }),
  ],
  Rounds: [
    demoRound(
      'r16',
      'Loppukilpailu',
      0,
      demoTs(11, 30),
      [
        demoHeat(1, [
          demoRunner('k1', 1, 301, 'Anni Vauhtinen', 'Demon Urheilijat', 'DemU', { sb: '4.18,90', pb: '4.15,02' }),
          demoRunner('k2', 2, 302, 'Helmi Testinen', 'Testilän Kisa', 'TeKi', { sb: '4.20,15', pb: '4.19,80' }),
          demoRunner('k3', 3, 303, 'Aada Kokeinen', 'Näyteniemen Vauhti', 'NäVa', { pb: '4.20,11' }),
          demoRunner('k4', 4, 304, 'Siiri Merkkinen', 'Mallikylän Vire', 'MalV', { sb: '4.22,88', pb: '4.22,88' }),
          demoRunner('k5', 5, 305, 'Nella Näytteinen', 'Harjoituspiirin Urheilijat', 'HarjU', {
            sb: '4.24,50',
            pb: '4.22,90',
          }),
          demoRunner('k6', 6, 306, 'Pinja Demoinen', 'Demon Urheilijat', 'DemU'),
          demoRunner('k7', 7, 307, 'Roosa Simulainen', 'Testilän Kisa', 'TeKi', { sb: '4.27,12', pb: '4.24,08' }),
          demoRunner('k8', 8, 308, 'Kerttu Mittainen', 'Näyteniemen Vauhti', 'NäVa', { pb: '4.28,12' }),
        ]),
      ],
      {},
      'Progress',
    ),
  ],
};

// --- The counting starts (Juoksut mode) --------------------------------
//
// The relays below take their team counts, entered names, lanes and bibs
// from one measured meet (2026-02) unless they say otherwise.

// Builds one team with its lane and bib, since tileAnchor (lib/lap-counter.js)
// names a tile by either. Every name is the team's own club's. None built for
// the demo meet is DemU's or MalV's, whose club lines the tests assert in full.
function lapTeam(id, name, org, lane, bib, names) {
  return { id, name, org, lane, bib, names: names.map((n, i) => ({ id: `${id}-${i}`, name: n })) };
}

// Builds a counting relay's one heat, each team cut to the legs run
// (relayLineup, lib/results.js).
function lapHeat(teams, legs, wind = null) {
  return demoHeat(
    1,
    teams.map((t) => demoTeam(t, t.lane, t.bib, legs)),
    wind,
  );
}

// The race lasts several laps, so tileAnchor (lib/lap-counter.js) names each
// tile by its bib, "#911", and not by its lane, "R1".
const DEMO_800_TEAMS = [
  lapTeam('u1', 'Testilän Kisa', DEMO_ORG_TEKI, 1, 911, [
    ['Onni', 'Vauhtinen'],
    ['Elias', 'Kokeinen'],
    ['Miko', 'Näytteinen'],
    ['Aapo', 'Simulainen'],
  ]),
  lapTeam('u2', 'Näyteniemen Vauhti', DEMO_ORG_NAVA, 2, 912, [
    ['Lauri', 'Mittainen'],
    ['Väinö', 'Testinen'],
    ['Kalle', 'Merkkinen'],
    ['Anton', 'Demoinen'],
  ]),
  lapTeam('u3', 'Harjoituspiirin Urheilijat', DEMO_ORG_HARJ, 3, 913, [
    ['Samu', 'Esimerkkinen'],
    ['Rasmus', 'Harjoitinen'],
    ['Oiva', 'Kokeinen'],
    ['Toivo', 'Näytteinen'],
  ]),
  lapTeam('u4', 'Testilän Kisa 2', DEMO_ORG_TEKI, 4, 914, [
    ['Eino', 'Simulainen'],
    ['Arttu', 'Vauhtinen'],
    ['Luka', 'Mittainen'],
    ['Jimi', 'Testinen'],
  ]),
];

DEMO_EVENTS.e12 = {
  Name: 'M15 4x800m viesti',
  EventCategory: 'Relay',
  EventSubCategory: 'MiddleDistance',
  // Length is one leg, as the API reports it for a relay.
  EventType: { Length: 800, Category: 'Relay', TeamSize: 4, Name: '4x800m viesti' },
  Enrollments: DEMO_800_TEAMS.map(demoTeamEnrollment),
  Rounds: [demoRound('r12', 'Loppukilpailu', 0, demoTs(16, 0), [lapHeat(DEMO_800_TEAMS, 4)], {}, 'Allocated')],
};

// Each shuttle team runs in two lanes, and the allocation names one of them
// (docs/tuloslista-api.md). s2 enters seven names for four legs, and its
// lineup is cut to four like any relay's.
const DEMO_SHUTTLE_TEAMS = [
  lapTeam('s1', 'Näyteniemen Vauhti', DEMO_ORG_NAVA, 2, 105, [
    ['Rico', 'Merkkinen'],
    ['Joel', 'Näytteinen'],
    ['Veikko', 'Kokeinen'],
    ['Daniel', 'Simulainen'],
  ]),
  lapTeam('s2', 'Testilän Kisa', DEMO_ORG_TEKI, 4, 57, [
    ['Jooa', 'Testinen'],
    ['Frans', 'Harjoitinen'],
    ['Viljami', 'Demoinen'],
    ['Elmo', 'Vauhtinen'],
    ['Devin', 'Mittainen'],
    ['Aaron', 'Kokeinen'],
    ['Lenni', 'Näytteinen'],
  ]),
  lapTeam('s3', 'Harjoituspiirin Urheilijat', DEMO_ORG_HARJ, 6, 117, [
    ['Eemeli', 'Simulainen'],
    ['Toivo', 'Merkkinen'],
    ['Aamos', 'Esimerkkinen'],
    ['Leo', 'Harjoitinen'],
  ]),
];

DEMO_EVENTS.e13 = {
  Name: 'P11 4x60m aitaviesti',
  EventCategory: 'Relay',
  EventSubCategory: 'Hurdles',
  // SubCategory 'Hurdles' marks a shuttle relay (isShuttleRelay,
  // lib/lap-counter.js). The name's `aitaviesti` stands in if it goes missing.
  EventType: { Length: 60, Category: 'Relay', SubCategory: 'Hurdles', TeamSize: 4, Name: '4x60m aitaviesti' },
  Enrollments: DEMO_SHUTTLE_TEAMS.map(demoTeamEnrollment),
  // The heat's wind must not print. A Length of 60 passes the distance gate,
  // so heatWind's Category check is what hides a relay's reading.
  Rounds: [
    demoRound('r13', 'Loppukilpailu', 0, demoTs(16, 30), [lapHeat(DEMO_SHUTTLE_TEAMS, 4, '+1,4')], {}, 'Allocated'),
  ],
};

// This heat of two is drawn in lanes 2 and 4, the even lane of each pair
// (docs/tuloslista-api.md). The day sheet folds it into P11's block over the
// union of lanes (hurdleSheetBlocks).
const DEMO_SHUTTLE_GIRLS = [
  lapTeam('sg1', 'Testilän Kisa', DEMO_ORG_TEKI, 2, 131, [
    ['Aada', 'Testinen'],
    ['Sofia', 'Harjoitinen'],
    ['Emma', 'Demoinen'],
    ['Lilja', 'Vauhtinen'],
  ]),
  lapTeam('sg2', 'Näyteniemen Vauhti', DEMO_ORG_NAVA, 4, 132, [
    ['Ella', 'Merkkinen'],
    ['Helmi', 'Mittainen'],
    ['Aino', 'Esimerkkinen'],
    ['Venla', 'Simulainen'],
  ]),
];

DEMO_EVENTS.e53 = {
  Name: 'T11 4x60m aitaviesti',
  EventCategory: 'Relay',
  EventSubCategory: 'Hurdles',
  EventType: { Length: 60, Category: 'Relay', SubCategory: 'Hurdles', TeamSize: 4, Name: '4x60m aitaviesti' },
  Enrollments: DEMO_SHUTTLE_GIRLS.map(demoTeamEnrollment),
  Rounds: [demoRound('r53', 'Loppukilpailu', 0, demoTs(16, 40), [lapHeat(DEMO_SHUTTLE_GIRLS, 4)], {}, 'Allocated')],
};

// The sekaviesti is one measured team. It gives the aitaviesti box and the
// day's lines their two-row shape.
const DEMO_SEKA_TEAMS = [
  lapTeam('sk1', 'Näyteniemen Vauhti', DEMO_ORG_NAVA, 3, 121, [
    ['Minttu', 'Merkkinen'],
    ['Roni', 'Merkkinen'],
    ['Selma', 'Näytteinen'],
    ['Jaakko', 'Näytteinen'],
  ]),
];

DEMO_EVENTS.e50 = {
  Name: 'M/N 4x100m aitaviesti',
  EventCategory: 'Relay',
  EventSubCategory: 'Hurdles',
  EventType: { Length: 100, Category: 'Relay', SubCategory: 'Hurdles', TeamSize: 4, Name: '4x100m aitaviesti' },
  Enrollments: DEMO_SEKA_TEAMS.map(demoTeamEnrollment),
  Rounds: [
    demoRound('r50', 'Loppukilpailu', 0, demoTs(16, 45), [
      demoHeat(1, [demoTeam(DEMO_SEKA_TEAMS[0], 3, 121, 4, { result: '57,56', rank: 1 })]),
    ]),
  ],
};

// The race carries the 4x400 m EventType and runs 3x400 m, as a race can be
// filed (docs/tuloslista-api.md). The event's name decides, since trusting the
// type gives 1600 m, two hall laps too many.
const DEMO_MISTYPED_TEAMS = [
  lapTeam('w1', 'Testilän Kisa', DEMO_ORG_TEKI, 1, 75, [
    ['Samuel', 'Kokeinen'],
    ['Max', 'Näytteinen'],
    ['Arian', 'Demoinen'],
  ]),
  lapTeam('w2', 'Näyteniemen Vauhti', DEMO_ORG_NAVA, 2, 232, [
    ['Luka', 'Harjoitinen'],
    ['Joakim', 'Vauhtinen'],
    ['Arthur', 'Merkkinen'],
  ]),
  lapTeam('w3', 'Harjoituspiirin Urheilijat', DEMO_ORG_HARJ, 3, 226, [
    ['Tobias', 'Simulainen'],
    ['Lukas', 'Testinen'],
    ['Benjamin', 'Esimerkkinen'],
  ]),
];

DEMO_EVENTS.e14 = {
  Name: 'P9 3x400m viesti',
  EventCategory: 'Relay',
  EventSubCategory: 'Sprint',
  EventType: {
    Length: 400,
    Category: 'Relay',
    SubCategory: 'Sprint',
    TeamSize: 4,
    Name: '4x400m viesti',
    Code: '4x400mr',
  },
  Enrollments: DEMO_MISTYPED_TEAMS.map(demoTeamEnrollment),
  Rounds: [demoRound('r14', 'Loppukilpailu', 0, demoTs(17, 0), [lapHeat(DEMO_MISTYPED_TEAMS, 3)], {}, 'Allocated')],
};

// Eleven teams run three legs of three hall laps, so both handovers fall on
// the line. The heat is sized like the youth 3x600 m measured in a hall
// (docs/lap-counter.md, "The changeover").
const DEMO_600_TEAMS = [
  lapTeam('v1', 'Näyteniemen Vauhti 3', DEMO_ORG_NAVA, 1, 112, [
    ['Lumi', 'Testinen'],
    ['Alina', 'Kokeinen'],
    ['Peppi', 'Merkkinen'],
  ]),
  lapTeam('v2', 'Testilän Kisa 2', DEMO_ORG_TEKI, 2, 181, [
    ['Emilia', 'Näytteinen'],
    ['Kerttu', 'Demoinen'],
    ['Nea', 'Simulainen'],
  ]),
  lapTeam('v3', 'Näyteniemen Vauhti 4', DEMO_ORG_NAVA, 3, 63, [
    ['Selma', 'Vauhtinen'],
    ['Liisa', 'Mittainen'],
    ['Alli-Ester', 'Harjoitinen'],
  ]),
  lapTeam('v4', 'Harjoituspiirin Urheilijat 2', DEMO_ORG_HARJ, 4, 231, [
    ['Kia', 'Esimerkkinen'],
    ['Isabel', 'Kokeinen'],
    ['Seela', 'Näytteinen'],
  ]),
  // Four names for three legs leave the reserve with no roster row.
  lapTeam('v5', 'Testilän Kisa 3', DEMO_ORG_TEKI, 5, 10, [
    ['Celine', 'Merkkinen'],
    ['Hertta', 'Demoinen'],
    ['Ella', 'Testinen'],
    ['Amanda', 'Vauhtinen'],
  ]),
  lapTeam('v6', 'Näyteniemen Vauhti 5', DEMO_ORG_NAVA, 6, 52, [
    ['Olivia', 'Simulainen'],
    ['Ruusa', 'Harjoitinen'],
    ['Zoja', 'Mittainen'],
  ]),
  lapTeam('v7', 'Harjoituspiirin Urheilijat 3', DEMO_ORG_HARJ, 7, 209, [
    ['Alissa', 'Kokeinen'],
    ['Saimi', 'Näytteinen'],
    ['Saana', 'Esimerkkinen'],
  ]),
  lapTeam('v8', 'Testilän Kisa 4', DEMO_ORG_TEKI, 8, 237, [
    ['Lianna', 'Vauhtinen'],
    ['Viveca', 'Testinen'],
    ['Laila', 'Demoinen'],
  ]),
  lapTeam('v9', 'Näyteniemen Vauhti 6', DEMO_ORG_NAVA, 9, 70, [
    ['Sofi', 'Merkkinen'],
    ['Olivia', 'Harjoitinen'],
    ['Pihla', 'Mittainen'],
  ]),
  lapTeam('v10', 'Näyteniemen Vauhti 7', DEMO_ORG_NAVA, 10, 72, [
    ['Inka', 'Kokeinen'],
    ['Aino', 'Näytteinen'],
    ['Venla', 'Vauhtinen'],
  ]),
  lapTeam('v11', 'Harjoituspiirin Urheilijat 4', DEMO_ORG_HARJ, 11, 74, [
    ['Elsi', 'Testinen'],
    ['Alina', 'Demoinen'],
    ['Emili', 'Merkkinen'],
  ]),
];

DEMO_EVENTS.e15 = {
  Name: 'T13 3x600m viesti',
  EventCategory: 'Relay',
  EventSubCategory: 'Run',
  EventType: {
    Length: 600,
    Category: 'Relay',
    SubCategory: 'Run',
    TeamSize: 3,
    Name: '3x600m viesti',
    Code: '3x600mr',
  },
  Enrollments: DEMO_600_TEAMS.map(demoTeamEnrollment),
  Rounds: [demoRound('r15', 'Loppukilpailu', 0, demoTs(17, 30), [lapHeat(DEMO_600_TEAMS, 3)], {}, 'Allocated')],
};

// --- The starts whose categories share a physical heat -----------------
//
// e17-e23 and e26-e29 draw several classes into one heat down one set of
// lanes. mergeHeats and heatPlaces (lib/results.js) read such a heat as one race
// (docs/views.md). e24/e25 and e30/e31 are two draws under one heat number
// and must stay apart (docs/tuloslista-api.md, "Heats and allocations").

// M and M19 3000m share two heats, interleaved by lane. M has heat 1's odd
// lanes and heat 2's even ones. The race is on, so no row has a result.
DEMO_EVENTS.e17 = {
  Name: 'M 3000m',
  EventCategory: 'Track',
  EventSubCategory: 'MiddleDistance',
  EventType: { Length: 3000, Category: 'Track', TeamSize: 1, Name: '3000m' },
  Enrollments: [
    demoEnrollment('m1', 401, 'Kalle Testinen', DEMO_ORG_DEMU, { sb: '8.42,10', pb: '8.39,55' }),
    demoEnrollment('m2', 402, 'Joona Kokeinen', DEMO_ORG_TEKI, { sb: '8.47,55', pb: '8.47,55' }),
    demoEnrollment('m3', 403, 'Tapio Näytteinen', DEMO_ORG_NAVA, { pb: '8.44,90' }),
    demoEnrollment('m4', 404, 'Ilari Simulainen', DEMO_ORG_MALV, { sb: '8.58,40', pb: '8.55,10' }),
    demoEnrollment('m5', 405, 'Aatu Merkkinen', DEMO_ORG_DEMU),
    demoEnrollment('m6', 406, 'Miska Harjoitinen', DEMO_ORG_TEKI, { sb: '9.10,77', pb: '9.06,20' }),
  ],
  // Both heats carry a Wind that governs no 3000 m, as every track heat does
  // (docs/tuloslista-api.md). The merged heat must print none (heatWind).
  Rounds: [
    demoRound(
      'r17',
      'Loppukilpailu',
      0,
      demoTs(14, 30),
      [
        demoHeat(
          1,
          [
            demoRunner('m1', 1, 401, 'Kalle Testinen', 'Demon Urheilijat', 'DemU', { sb: '8.42,10', pb: '8.39,55' }),
            demoRunner('m2', 3, 402, 'Joona Kokeinen', 'Testilän Kisa', 'TeKi', { sb: '8.47,55', pb: '8.47,55' }),
            demoRunner('m3', 5, 403, 'Tapio Näytteinen', 'Näyteniemen Vauhti', 'NäVa', { pb: '8.44,90' }),
            demoRunner('m4', 7, 404, 'Ilari Simulainen', 'Mallikylän Vire', 'MalV', { sb: '8.58,40', pb: '8.55,10' }),
          ],
          '−2,6',
        ),
        demoHeat(
          2,
          [
            demoRunner('m5', 2, 405, 'Aatu Merkkinen', 'Demon Urheilijat', 'DemU'),
            demoRunner('m6', 4, 406, 'Miska Harjoitinen', 'Testilän Kisa', 'TeKi', { sb: '9.10,77', pb: '9.06,20' }),
          ],
          '−2,6',
        ),
      ],
      {},
      'Progress',
    ),
  ],
};

// M19 3000m has the other lanes of both heats.
DEMO_EVENTS.e18 = {
  Name: 'M19 3000m',
  EventCategory: 'Track',
  EventSubCategory: 'MiddleDistance',
  EventType: { Length: 3000, Category: 'Track', TeamSize: 1, Name: '3000m' },
  Enrollments: [
    demoEnrollment('n1', 501, 'Eemil Demoinen', DEMO_ORG_TEKI, { sb: '8.55,30', pb: '8.51,08' }),
    demoEnrollment('n2', 502, 'Verneri Mittainen', DEMO_ORG_MALV),
    demoEnrollment('n3', 503, 'Kasper Esimerkkinen', DEMO_ORG_NAVA, { pb: '9.02,15' }),
    demoEnrollment('n4', 504, 'Topias Vauhtinen', DEMO_ORG_DEMU, { sb: '9.12,05', pb: '9.09,88' }),
    demoEnrollment('n5', 505, 'Valtteri Kokeinen', DEMO_ORG_TEKI, { sb: '9.20,60', pb: '9.20,60' }),
    demoEnrollment('n6', 506, 'Niko Simulainen', DEMO_ORG_HARJ),
  ],
  Rounds: [
    demoRound(
      'r18',
      'Loppukilpailu',
      0,
      demoTs(14, 30),
      [
        demoHeat(
          1,
          [
            demoRunner('n1', 2, 501, 'Eemil Demoinen', 'Testilän Kisa', 'TeKi', { sb: '8.55,30', pb: '8.51,08' }),
            demoRunner('n2', 4, 502, 'Verneri Mittainen', 'Mallikylän Vire', 'MalV'),
            demoRunner('n3', 6, 503, 'Kasper Esimerkkinen', 'Näyteniemen Vauhti', 'NäVa', { pb: '9.02,15' }),
          ],
          '−2,6',
        ),
        demoHeat(
          2,
          [
            demoRunner('n4', 1, 504, 'Topias Vauhtinen', 'Demon Urheilijat', 'DemU', { sb: '9.12,05', pb: '9.09,88' }),
            demoRunner('n5', 3, 505, 'Valtteri Kokeinen', 'Testilän Kisa', 'TeKi', { sb: '9.20,60', pb: '9.20,60' }),
            demoRunner('n6', 5, 506, 'Niko Simulainen', 'Harjoituspiirin Urheilijat', 'HarjU'),
          ],
          '−2,6',
        ),
      ],
      {},
      'Progress',
    ),
  ],
};

// M65 3000m has no entrants, and its round arrives with an empty Heats[]. It
// must add nothing to the merged heats (mergeHeats, lib/results.js). e8 has no
// round at all, and e11 an empty heat.
DEMO_EVENTS.e19 = {
  Name: 'M65 3000m',
  EventCategory: 'Track',
  EventSubCategory: 'MiddleDistance',
  EventType: { Length: 3000, Category: 'Track', TeamSize: 1, Name: '3000m' },
  Enrollments: [],
  Rounds: [demoRound('r19', 'Loppukilpailu', 0, demoTs(14, 30), [], {}, 'Unallocated')],
};

// M and M19 200m kelaus T54 ran as one heat. T54 is a para class, so the
// label reads "M T54" (parseEventName, lib/schedule.js). The DNS gets a row
// and no place (heatPlaces, lib/results.js).
DEMO_EVENTS.e20 = {
  Name: 'M 200m kelaus T54',
  EventCategory: 'Track',
  EventSubCategory: 'Sprint',
  EventType: { Length: 200, Category: 'Track', TeamSize: 1, Name: '200m kelaus' },
  Enrollments: [
    demoEnrollment('p1', 601, 'Petri Kokeinen', DEMO_ORG_DEMU),
    demoEnrollment('p2', 602, 'Kari Testinen', DEMO_ORG_TEKI),
    demoEnrollment('p3', 603, 'Jarno Näytteinen', DEMO_ORG_NAVA),
    demoEnrollment('p4', 604, 'Tapani Simulainen', DEMO_ORG_MALV),
  ],
  // A reading governs a 200 m, so the merged heat prints it (heatWind,
  // lib/results.js).
  Rounds: [
    demoRound('r20', 'Loppukilpailu', 0, demoTs(15, 45), [
      demoHeat(
        1,
        [
          demoRunner('p1', 3, 601, 'Petri Kokeinen', 'Demon Urheilijat', 'DemU', { result: '27,44', rank: 2 }),
          demoRunner('p2', 5, 602, 'Kari Testinen', 'Testilän Kisa', 'TeKi', { result: '26,91', rank: 1 }),
          demoRunner('p3', 7, 603, 'Jarno Näytteinen', 'Näyteniemen Vauhti', 'NäVa', { result: '29,08', rank: 3 }),
          demoRunner('p4', 8, 604, 'Tapani Simulainen', 'Mallikylän Vire', 'MalV', { result: 'DNS' }),
        ],
        '−0,4',
      ),
    ]),
  ],
};

// M19 has lanes 2, 4 and 6. Each class ranks only its own runners, so the
// heat holds two 1sts and heatPlaces (lib/results.js) places the race. The
// third row is an out-of-competition guest, with a time and no class rank.
DEMO_EVENTS.e21 = {
  Name: 'M19 200m kelaus T54',
  EventCategory: 'Track',
  EventSubCategory: 'Sprint',
  EventType: { Length: 200, Category: 'Track', TeamSize: 1, Name: '200m kelaus' },
  Enrollments: [
    demoEnrollment('q1', 701, 'Elmeri Harjoitinen', DEMO_ORG_TEKI),
    demoEnrollment('q2', 702, 'Jesse Mittainen', DEMO_ORG_MALV),
    demoEnrollment('q3', 703, 'Oskari Demoinen', DEMO_ORG_DEMU),
  ],
  Rounds: [
    demoRound('r21', 'Loppukilpailu', 0, demoTs(15, 45), [
      demoHeat(
        1,
        [
          demoRunner('q1', 2, 701, 'Elmeri Harjoitinen', 'Testilän Kisa', 'TeKi', { result: '30,12', rank: 1 }),
          demoRunner('q2', 4, 702, 'Jesse Mittainen', 'Mallikylän Vire', 'MalV', { result: '31,55', rank: 2 }),
          demoRunner('q3', 6, 703, 'Oskari Demoinen', 'Demon Urheilijat', 'DemU', {
            result: '32,40',
            ku: true,
            cup: 700,
          }),
        ],
        '−0,4',
      ),
    ]),
  ],
};

// N15 and Mixed 15 4x400m share one heat, three teams and two.
const DEMO_4X400_N15_TEAMS = [
  // Six are entered for four legs, as a team can be (docs/tuloslista-api.md).
  // Only the first four reach the roster (relayLineup, lib/results.js).
  lapTeam('t1', 'Testilän Kisa', DEMO_ORG_TEKI, 3, 901, [
    ['Aino', 'Testinen'],
    ['Sanni', 'Kokeinen'],
    ['Iiris', 'Näytteinen'],
    ['Peppi', 'Demoinen'],
    ['Vilma', 'Mittainen'],
    ['Aada', 'Merkkinen'],
  ]),
  lapTeam('t2', 'Näyteniemen Vauhti', DEMO_ORG_NAVA, 5, 902, [
    ['Enni', 'Vauhtinen'],
    ['Tuuli', 'Harjoitinen'],
    ['Neea', 'Esimerkkinen'],
    ['Aava', 'Kokeinen'],
  ]),
  lapTeam('t3', 'Harjoituspiirin Urheilijat', DEMO_ORG_HARJ, 7, 903, [
    ['Linnea', 'Testinen'],
    ['Matilda', 'Simulainen'],
    ['Ida', 'Näytteinen'],
    ['Rebekka', 'Mittainen'],
  ]),
];

const DEMO_4X400_MIXED_TEAMS = [
  lapTeam('x1', 'Näyteniemen Vauhti 2', DEMO_ORG_NAVA, 2, 904, [
    ['Eeli', 'Merkkinen'],
    ['Sohvi', 'Demoinen'],
    ['Lenni', 'Vauhtinen'],
    ['Aurora', 'Harjoitinen'],
  ]),
  lapTeam('x2', 'Harjoituspiirin Urheilijat 2', DEMO_ORG_HARJ, 4, 905, [
    ['Otso', 'Kokeinen'],
    ['Enna', 'Testinen'],
    ['Aleksanteri', 'Mittainen'],
    ['Iida', 'Esimerkkinen'],
  ]),
];

DEMO_EVENTS.e22 = {
  Name: 'N15 4x400m viesti',
  EventCategory: 'Relay',
  EventSubCategory: 'Sprint',
  EventType: { Length: 400, Category: 'Relay', TeamSize: 4, Name: '4x400m viesti' },
  Enrollments: DEMO_4X400_N15_TEAMS.map(demoTeamEnrollment),
  Rounds: [
    demoRound('r22', 'Loppukilpailu', 0, demoTs(18, 0), [
      demoHeat(1, [
        demoTeam(DEMO_4X400_N15_TEAMS[0], 3, 901, 4, { result: '4.12,55', rank: 1 }),
        demoTeam(DEMO_4X400_N15_TEAMS[1], 5, 902, 4, { result: '4.15,80', rank: 2 }),
        // A team's DNF parses to no time, so it sorts last and gets no place
        // (heatPlaces, lib/results.js).
        demoTeam(DEMO_4X400_N15_TEAMS[2], 7, 903, 4, { result: 'DNF' }),
      ]),
    ]),
  ],
};

DEMO_EVENTS.e23 = {
  Name: 'Mixed 15 4x400m viesti',
  EventCategory: 'Relay',
  EventSubCategory: 'Sprint',
  EventType: { Length: 400, Category: 'Relay', TeamSize: 4, Name: '4x400m viesti' },
  Enrollments: DEMO_4X400_MIXED_TEAMS.map(demoTeamEnrollment),
  // The heat's fastest team is in this two-team class, so the combined heat
  // leads with a row its own class ranks 1st of two.
  Rounds: [
    demoRound('r23', 'Loppukilpailu', 0, demoTs(18, 0), [
      demoHeat(1, [
        demoTeam(DEMO_4X400_MIXED_TEAMS[0], 2, 904, 4, { result: '4.09,12', rank: 1 }),
        demoTeam(DEMO_4X400_MIXED_TEAMS[1], 4, 905, 4, { result: '4.18,03', rank: 2 }),
      ]),
    ]),
  ],
};

// N15 and M15 Kolmiloikka each drew its own order under heat 1, as a field
// event's classes do (docs/tuloslista-api.md). laneDrawn (lib/results.js)
// keeps a field start out of the combined heat. heatPlaces cannot rank its
// marks.
DEMO_EVENTS.e24 = {
  Name: 'N15 Kolmiloikka',
  EventCategory: 'Field',
  EventSubCategory: 'HorizontalJump',
  EventType: { Category: 'Field', SubCategory: 'HorizontalJump', Name: 'Kolmiloikka' },
  Enrollments: [
    demoEnrollment('y1', 71, 'Aino Kokeinen', DEMO_ORG_DEMU),
    demoEnrollment('y2', 72, 'Elsa Testinen', DEMO_ORG_TEKI),
    demoEnrollment('y3', 73, 'Helmi Näytteinen', DEMO_ORG_NAVA),
  ],
  Rounds: [
    demoRound('r24', 'Loppukilpailu', 0, demoTs(13, 30), [
      demoHeat(1, [
        demoFieldAlloc(
          'y1',
          1,
          71,
          'Aino Kokeinen',
          'Demon Urheilijat',
          'DemU',
          [
            ['9.74', '+0,2'],
            ['x', null],
            ['10.04', '+0,5'],
          ],
          { result: '10.04', rank: 1, wind: '+0,5' },
        ),
        demoFieldAlloc(
          'y2',
          2,
          72,
          'Elsa Testinen',
          'Testilän Kisa',
          'TeKi',
          [
            ['9.45', '−0,1'],
            ['9.69', '+0,3'],
            ['x', null],
          ],
          { result: '9.69', rank: 2, wind: '+0,3' },
        ),
        demoFieldAlloc(
          'y3',
          3,
          73,
          'Helmi Näytteinen',
          'Näyteniemen Vauhti',
          'NäVa',
          [
            ['8.78', '+0,1'],
            ['8.93', '+0,4'],
            ['x', null],
          ],
          { result: '8.93', rank: 3, wind: '+0,4' },
        ),
      ]),
    ]),
  ],
};

DEMO_EVENTS.e25 = {
  Name: 'M15 Kolmiloikka',
  EventCategory: 'Field',
  EventSubCategory: 'HorizontalJump',
  EventType: { Category: 'Field', SubCategory: 'HorizontalJump', Name: 'Kolmiloikka' },
  Enrollments: [
    demoEnrollment('y4', 74, 'Veeti Demoinen', DEMO_ORG_DEMU),
    demoEnrollment('y5', 75, 'Oiva Mallinen', DEMO_ORG_HARJ),
    demoEnrollment('y6', 76, 'Lauri Simulainen', DEMO_ORG_TEKI),
  ],
  Rounds: [
    demoRound('r25', 'Loppukilpailu', 0, demoTs(13, 30), [
      demoHeat(1, [
        demoFieldAlloc(
          'y4',
          1,
          74,
          'Veeti Demoinen',
          'Demon Urheilijat',
          'DemU',
          [
            ['11.35', '+0,3'],
            ['x', null],
            ['11.98', '+0,1'],
          ],
          { result: '11.98', rank: 1, wind: '+0,1' },
        ),
        demoFieldAlloc(
          'y5',
          2,
          75,
          'Oiva Mallinen',
          'Harjoituspiirin Urheilijat',
          'HarjU',
          [
            ['10.25', '+0,2'],
            ['10.29', '+0,6'],
            ['x', null],
          ],
          { result: '10.29', rank: 2, wind: '+0,6' },
        ),
        demoFieldAlloc(
          'y6',
          3,
          76,
          'Lauri Simulainen',
          'Testilän Kisa',
          'TeKi',
          [
            ['9.61', '−0,2'],
            ['9.62', '+0,1'],
            ['9.22', '+0,2'],
          ],
          { result: '9.62', rank: 3, wind: '+0,1' },
        ),
      ]),
    ]),
  ],
};

// Each heat is one draw of lanes 1-6 (lanesAreOneDraw). Both ranks count one
// class only, so heatPlaces places by time.
const HEAT = 9;
const DEMO_60M = [
  // [id, lane, bib, name, club, class, result, rank, heatRank, heat]
  ['z1', 1, 401, 'Vilja Testinen', DEMO_ORG_TEKI, 'T13', '9,12', 2, 2, 1],
  ['z2', 2, 402, 'Eelis Kokeinen', DEMO_ORG_NAVA, 'P13', '8,84', 2, 2, 1],
  ['z3', 3, 403, 'Lotta Näytteinen', DEMO_ORG_DEMU, 'T11', '9,55', 2, 2, 1],
  ['z4', 4, 404, 'Onerva Merkkinen', DEMO_ORG_HARJ, 'P13', '8,71', 1, 1, 1],
  ['z5', 5, 405, 'Aada Demoinen', DEMO_ORG_MALV, 'T13', '8,98', 1, 1, 1],
  ['z6', 6, 406, 'Peppi Mittainen', DEMO_ORG_TEKI, 'T11', '9,41', 1, 1, 1],
  ['z7', 1, 407, 'Sanni Harjoitinen', DEMO_ORG_HARJ, 'T11', '9,88', 4, 2, 2],
  ['z8', 2, 408, 'Miro Simulainen', DEMO_ORG_DEMU, 'P11', '9,72', 2, 2, 2],
  ['z9', 3, 409, 'Nella Esimerkkinen', DEMO_ORG_NAVA, 'T13', '9,34', 4, 2, 2],
  ['z10', 4, 410, 'Aaro Vauhtinen', DEMO_ORG_MALV, 'P11', '9,60', 1, 1, 2],
  ['z11', 5, 411, 'Emilia Kokeinen', DEMO_ORG_TEKI, 'T13', '9,20', 3, 1, 2],
  ['z12', 6, 412, 'Venla Mallinen', DEMO_ORG_DEMU, 'T11', '9,79', 3, 1, 2],
];

// Builds one class's event from the rows above. A class gets a heat only
// where it has a row.
function demo60mEvent(label) {
  const mine = DEMO_60M.filter(([, , , , , cls]) => cls === label);
  const heats = [...new Set(mine.map((r) => r[HEAT]))]
    .sort((a, b) => a - b)
    .map((idx) =>
      demoHeat(
        idx,
        mine
          .filter((r) => r[HEAT] === idx)
          .map(([id, lane, bib, name, org, , result, rank, heatRank]) =>
            demoRunner(id, lane, bib, name, org.name, org.short, { result, rank, heatRank }),
          ),
        // A reading governs a 60 m (heatWind). A class merged over both heats
        // prints neither reading (soleHeatWind, app/event.js).
        idx === 1 ? '+0,2' : '−0,5',
      ),
    );
  return {
    Name: `${label} 60m`,
    // Group is the class alone, as the results endpoint sends it
    // (docs/tuloslista-api.md). Only cupEventKey (lib/cup.js) reads it, for a
    // walk.
    Group: label,
    EventCategory: 'Track',
    EventSubCategory: 'Sprint',
    EventType: { Length: 60, Category: 'Track', TeamSize: 1, Name: '60m' },
    Enrollments: mine.map(([id, , bib, name, org]) => demoEnrollment(id, bib, name, org)),
    Rounds: [demoRound(`r${{ T11: 26, P11: 27, T13: 28, P13: 29 }[label]}`, 'Loppukilpailu', 0, demoTs(10, 45), heats)],
  };
}

DEMO_EVENTS.e26 = demo60mEvent('T11');
DEMO_EVENTS.e27 = demo60mEvent('P11');
DEMO_EVENTS.e28 = demo60mEvent('T13');
DEMO_EVENTS.e29 = demo60mEvent('P13');

// M and M17 400m share the heat number 1 and are two draws, as a shared
// track heat often is (docs/tuloslista-api.md). M's lanes 4-6 collide with
// M17's 3-5, so lanesAreOneDraw (lib/results.js) keeps each class in its own
// table.
DEMO_EVENTS.e30 = {
  Name: 'M 400m',
  EventCategory: 'Track',
  EventSubCategory: 'Sprint',
  EventType: { Length: 400, Category: 'Track', TeamSize: 1, Name: '400m' },
  Enrollments: [
    demoEnrollment('z16', 416, 'Rasmus Demoinen', DEMO_ORG_DEMU),
    demoEnrollment('z17', 417, 'Aleksanteri Harjoitinen', DEMO_ORG_HARJ),
    demoEnrollment('z18', 418, 'Julius Mittainen', DEMO_ORG_TEKI),
  ],
  Rounds: [
    demoRound('r30', 'Loppukilpailu', 0, demoTs(13, 45), [
      demoHeat(1, [
        demoRunner('z16', 4, 416, 'Rasmus Demoinen', 'Demon Urheilijat', 'DemU', { result: '53,19', rank: 1 }),
        demoRunner('z17', 5, 417, 'Aleksanteri Harjoitinen', 'Harjoituspiirin Urheilijat', 'HarjU', {
          result: '54,28',
          rank: 2,
        }),
        demoRunner('z18', 6, 418, 'Julius Mittainen', 'Testilän Kisa', 'TeKi', { result: '58,68', rank: 3 }),
      ]),
    ]),
  ],
};

DEMO_EVENTS.e31 = {
  Name: 'M17 400m',
  EventCategory: 'Track',
  EventSubCategory: 'Sprint',
  EventType: { Length: 400, Category: 'Track', TeamSize: 1, Name: '400m' },
  Enrollments: [
    demoEnrollment('z13', 413, 'Otso Testinen', DEMO_ORG_TEKI),
    demoEnrollment('z14', 414, 'Elmo Kokeinen', DEMO_ORG_NAVA),
    demoEnrollment('z15', 415, 'Sisu Näytteinen', DEMO_ORG_MALV),
  ],
  Rounds: [
    demoRound('r31', 'Loppukilpailu', 0, demoTs(13, 45), [
      demoHeat(1, [
        demoRunner('z13', 3, 413, 'Otso Testinen', 'Testilän Kisa', 'TeKi', { result: '55,15', rank: 1 }),
        demoRunner('z14', 4, 414, 'Elmo Kokeinen', 'Näyteniemen Vauhti', 'NäVa', { result: '56,51', rank: 2 }),
        demoRunner('z15', 5, 415, 'Sisu Näytteinen', 'Mallikylän Vire', 'MalV', { result: '59,50', rank: 3 }),
      ]),
    ]),
  ],
};

// N 100m Alkuerät is caught half-run. Its cut is on time alone with QRank ''
// (docs/tuloslista-api.md), so the note reads "6 nopeinta aikaa (q)"
// (qualificationNote, lib/results.js).
DEMO_EVENTS.e32 = {
  Name: 'N 100m',
  EventCategory: 'Track',
  EventSubCategory: 'Sprint',
  EventType: { Length: 100, Category: 'Track', TeamSize: 1, Name: '100m' },
  Enrollments: [
    demoEnrollment('w1', 501, 'Emilia Testinen', DEMO_ORG_TEKI, { sb: '12,50', pb: '12,44' }),
    demoEnrollment('w2', 502, 'Helmi Vauhtinen', DEMO_ORG_DEMU, { sb: '12,11', pb: '12,02' }),
    demoEnrollment('w3', 503, 'Aada Mallinen', DEMO_ORG_MALV, { sb: '12,66', pb: '12,66' }),
    demoEnrollment('w4', 504, 'Venla Kokeinen', DEMO_ORG_NAVA, { sb: '12,28', pb: '12,20' }),
    demoEnrollment('w5', 505, 'Peppi Harjoitinen', DEMO_ORG_HARJ, { sb: '12,60', pb: '12,52' }),
    demoEnrollment('w6', 506, 'Siiri Näytteinen', DEMO_ORG_NAVA, { sb: '12,95', pb: '12,95' }),
    demoEnrollment('w7', 507, 'Ella Demoinen', DEMO_ORG_DEMU, { sb: '12,22', pb: '12,15' }),
    demoEnrollment('w8', 508, 'Alisa Mittainen', DEMO_ORG_MALV, { sb: '12,80', pb: '12,74' }),
    demoEnrollment('w9', 509, 'Lotta Esimerkkinen', DEMO_ORG_TEKI, { sb: '12,58', pb: '12,58' }),
    demoEnrollment('w10', 510, 'Enni Simulainen', DEMO_ORG_DEMU, { sb: '13,24', pb: '13,10' }),
    demoEnrollment('w11', 511, 'Iiris Kisainen', DEMO_ORG_HARJ, { sb: '13,31', pb: '13,31' }),
    demoEnrollment('w12', 512, 'Nella Testinen', DEMO_ORG_TEKI, { sb: '13,40', pb: '13,28' }),
    demoEnrollment('w13', 513, 'Sofia Mallinen', DEMO_ORG_MALV, { sb: '13,66', pb: '13,66' }),
    demoEnrollment('w14', 514, 'Vilja Kokeinen', DEMO_ORG_NAVA, { sb: '13,82', pb: '13,71' }),
    demoEnrollment('w15', 515, 'Saara Vauhtinen', DEMO_ORG_HARJ, { sb: '', pb: '13,95' }),
  ],
  // The round stays 'Progress' until its last heat has run. Its ResultRank
  // over the nine run so far and its q badges can still move (resultPending,
  // qualPending, lib/results.js).
  Rounds: [
    demoRound(
      'r32',
      'Alkuerät',
      0,
      demoTs(9, 45),
      [
        // +1,5 is legal, so each row under its season's best is un-muted.
        demoHeat(
          1,
          [
            demoRunner('w1', 1, 501, 'Emilia Testinen', 'Testilän Kisa', 'TeKi', {
              result: '12,44',
              rank: 4,
              heatRank: 2,
              QResult: true,
              sb: '12,50',
              pb: '12,44',
            }),
            demoRunner('w2', 2, 502, 'Helmi Vauhtinen', 'Demon Urheilijat', 'DemU', {
              result: '12,08',
              rank: 1,
              heatRank: 1,
              QResult: true,
              sb: '12,11',
              pb: '12,02',
            }),
            // This 12,61 ranks 8th below heat 3's tied 6ths, as the API ranks
            // on unpublished thousandths (docs/tuloslista-api.md).
            // tiedQualBadge (lib/results.js) reads ranks, as marks would give
            // this row a q.
            demoRunner('w3', 3, 503, 'Aada Mallinen', 'Mallikylän Vire', 'MalV', {
              result: '12,61',
              rank: 8,
              heatRank: 3,
              sb: '12,66',
              pb: '12,66',
            }),
          ],
          '+1,5',
        ),
        // +2,0 is legal (WIND_LEGAL_MAX_MPS in lib/results.js), so the 12,55
        // under a 12,60 season's best is un-muted.
        demoHeat(
          2,
          [
            demoRunner('w4', 1, 504, 'Venla Kokeinen', 'Näyteniemen Vauhti', 'NäVa', {
              result: '12,30',
              rank: 3,
              heatRank: 1,
              QResult: true,
              sb: '12,28',
              pb: '12,20',
            }),
            demoRunner('w5', 2, 505, 'Peppi Harjoitinen', 'Harjoituspiirin Urheilijat', 'HarjU', {
              result: '12,55',
              rank: 5,
              heatRank: 2,
              QResult: true,
              sb: '12,60',
              pb: '12,52',
            }),
            demoRunner('w6', 3, 506, 'Siiri Näytteinen', 'Näyteniemen Vauhti', 'NäVa', {
              result: '13,02',
              rank: 9,
              heatRank: 3,
              sb: '12,95',
              pb: '12,95',
            }),
          ],
          '+2,0',
        ),
        // +2,4 is aided, so the 12,19 under a 12,22 season's best stays muted
        // (beatsMark, lib/results.js).
        demoHeat(
          3,
          [
            demoRunner('w7', 1, 507, 'Ella Demoinen', 'Demon Urheilijat', 'DemU', {
              result: '12,19',
              rank: 2,
              heatRank: 1,
              QResult: true,
              sb: '12,22',
              pb: '12,15',
            }),
            // A dead heat at the cut shares both ranks with the next row, and
            // the API gives the q to only one (docs/tuloslista-api.md).
            // qualBadge (lib/results.js) puts this row's q back.
            demoRunner('w8', 2, 508, 'Alisa Mittainen', 'Mallikylän Vire', 'MalV', {
              result: '12,61',
              rank: 6,
              heatRank: 2,
              sb: '12,80',
              pb: '12,74',
            }),
            demoRunner('w9', 3, 509, 'Lotta Esimerkkinen', 'Testilän Kisa', 'TeKi', {
              result: '12,61',
              rank: 6,
              heatRank: 2,
              QResult: true,
              sb: '12,58',
              pb: '12,58',
            }),
          ],
          '+2,4',
        ),
        // Heats 4 and 5 are drawn and not run, and heatChip (app/event.js)
        // marks them so. An unrun heat's Wind is null, where e9's unrun heat
        // carries 'NM'.
        demoHeat(4, [
          demoRunner('w10', 1, 510, 'Enni Simulainen', 'Demon Urheilijat', 'DemU', { sb: '13,24', pb: '13,10' }),
          demoRunner('w11', 2, 511, 'Iiris Kisainen', 'Harjoituspiirin Urheilijat', 'HarjU', {
            sb: '13,31',
            pb: '13,31',
          }),
          demoRunner('w12', 3, 512, 'Nella Testinen', 'Testilän Kisa', 'TeKi', { sb: '13,40', pb: '13,28' }),
        ]),
        // An entry's SB can be missing, here as an empty string
        // (docs/tuloslista-api.md). The SB cell must show nothing for it.
        demoHeat(5, [
          demoRunner('w13', 1, 513, 'Sofia Mallinen', 'Mallikylän Vire', 'MalV', { sb: '13,66', pb: '13,66' }),
          demoRunner('w14', 2, 514, 'Vilja Kokeinen', 'Näyteniemen Vauhti', 'NäVa', { sb: '13,82', pb: '13,71' }),
          demoRunner('w15', 3, 515, 'Saara Vauhtinen', 'Harjoituspiirin Urheilijat', 'HarjU', { pb: '13,95' }),
        ]),
      ],
      { QResult: '6' },
      'Progress',
    ),
  ],
};

// N Kiekko is drawn and not yet thrown, so Attempts[] is empty on every row
// (docs/tuloslista-api.md), and the start renders as startListTable
// (app/event.js) with the throwers' bests.
DEMO_EVENTS.e33 = {
  Name: 'N Kiekko',
  EventCategory: 'Field',
  EventSubCategory: 'Throw',
  EventType: { Category: 'Field', SubCategory: 'Throw', Name: 'Kiekko' },
  // One thrower has no bests and one a PB better than her SB, as in that
  // round. A best is dot-separated, since a comma would parse as a time.
  Enrollments: [
    demoEnrollment('u1', 601, 'Hilla Demoinen', DEMO_ORG_DEMU),
    demoEnrollment('u2', 602, 'Sanni Näytteinen', DEMO_ORG_NAVA, { sb: '42.81', pb: '42.81' }),
    demoEnrollment('u3', 603, 'Veera Testinen', DEMO_ORG_TEKI, { sb: '50.17', pb: '50.17' }),
    demoEnrollment('u4', 604, 'Aava Harjoitinen', DEMO_ORG_HARJ, { sb: '50.46', pb: '52.33' }),
    demoEnrollment('u5', 605, 'Milja Mittainen', DEMO_ORG_MALV, { sb: '46.09', pb: '46.09' }),
    demoEnrollment('u6', 606, 'Tuuli Simulainen', DEMO_ORG_DEMU, { sb: '48.39', pb: '48.39' }),
  ],
  Rounds: [
    demoRound(
      'r33',
      'Loppukilpailu',
      0,
      demoTs(16, 15),
      [
        demoHeat(1, [
          demoFieldAlloc('u1', 1, 601, 'Hilla Demoinen', 'Demon Urheilijat', 'DemU', []),
          demoFieldAlloc('u2', 2, 602, 'Sanni Näytteinen', 'Näyteniemen Vauhti', 'NäVa', [], {
            sb: '42.81',
            pb: '42.81',
          }),
          demoFieldAlloc('u3', 3, 603, 'Veera Testinen', 'Testilän Kisa', 'TeKi', [], { sb: '50.17', pb: '50.17' }),
          demoFieldAlloc('u4', 4, 604, 'Aava Harjoitinen', 'Harjoituspiirin Urheilijat', 'HarjU', [], {
            sb: '50.46',
            pb: '52.33',
          }),
          demoFieldAlloc('u5', 5, 605, 'Milja Mittainen', 'Mallikylän Vire', 'MalV', [], { sb: '46.09', pb: '46.09' }),
          demoFieldAlloc('u6', 6, 606, 'Tuuli Simulainen', 'Demon Urheilijat', 'DemU', [], {
            sb: '48.39',
            pb: '48.39',
          }),
        ]),
      ],
      {},
      'Allocated',
    ),
  ],
};

// --- The multi-event: three legs and the root they belong to ---
// This T9 3-ottelu is caught half-run. Its legs, their order and the shape of
// the marks and CEPoints are a real multi-event's (docs/tuloslista-api.md),
// with six athletes and a guest.
const DEMO_CE_FACTORS = { UseYouthFormulas: true, A: 5.2632, B: 5.36, C: 0 };

// Each athlete carries [result, CEPoints] for each leg run so far.
const DEMO_OTTELU = [
  { id: 'o1', bib: 701, name: 'Oona Demoinen', org: DEMO_ORG_DEMU, m40: ['7,22', 200], pituus: ['3.50', 192] },
  { id: 'o2', bib: 702, name: 'Lyyli Testinen', org: DEMO_ORG_TEKI, m40: ['7,26', 194], pituus: ['3.23', 156] },
  { id: 'o3', bib: 703, name: 'Minea Mallinen', org: DEMO_ORG_MALV, m40: ['7,51', 161], pituus: ['3.22', 155] },
  { id: 'o4', bib: 704, name: 'Fanni Kokeinen', org: DEMO_ORG_NAVA, m40: ['7,59', 151], pituus: ['3.19', 151] },
  // The two still to jump have a 40m score alone. `out` marks one withdrawn.
  // Her root total is DNF, as a withdrawal's reads (docs/tuloslista-api.md),
  // and the Kuula does not draw her.
  { id: 'o5', bib: 705, name: 'Pihla Harjoitinen', org: DEMO_ORG_HARJ, m40: ['7,64', 146], pituus: null, out: 'DNF' },
  { id: 'o6', bib: 706, name: 'Vieno Näytteinen', org: DEMO_ORG_NAVA, m40: ['7,76', 134], pituus: null },
  // A guest outscores the leader and is ranked nowhere, in the standings or a
  // leg (docs/tuloslista-api.md). A gap read off the biggest total would
  // measure every row against her (combinedLeaderPoints).
  {
    id: 'o7',
    bib: 707,
    name: 'Ilona Vierainen',
    org: DEMO_ORG_ULKV,
    ku: true,
    m40: ['7,18', 206],
    pituus: ['3.52', 195],
  },
];

const demoOtteluEnrollments = () => DEMO_OTTELU.map((a) => demoEnrollment(a.id, a.bib, a.name, a.org, { ku: a.ku }));

// Each root row totals the athlete's CEPoints in the legs. The legs repeat the
// figures by hand, and test/combined.test.mjs checks the sums. A withdrawal is
// ranked nowhere and leaves no gap (docs/tuloslista-api.md).
const demoOtteluTotals = () => {
  let rank = 0;
  return DEMO_OTTELU.map((a) =>
    demoRunner(a.id, 0, a.bib, a.name, a.org.name, a.org.short, {
      result: a.out || String(a.m40[1] + (a.pituus ? a.pituus[1] : 0)),
      rank: a.ku || a.out ? null : ++rank,
      ku: a.ku,
    }),
  );
};

// The 40m runs in two heats, as a leg runs in as many as it needs
// (docs/tuloslista-api.md). A leg read out of Heats[0] loses its second heat.
DEMO_EVENTS.e34 = {
  Id: 'e34',
  Name: 'T9 3-ottelu  40m',
  EventCategory: 'Track',
  EventSubCategory: 'Sprint',
  EventType: { Length: 40, Category: 'Track', TeamSize: 1, Name: '40m' },
  // A non-zero RootId marks a leg (combinedEventRoots, lib/roster.js).
  // RootName is the only place a leg's own resource names its multi-event.
  IsCombinedEvent: true,
  RootId: 'e37',
  RootName: 'T9 3-ottelu',
  CombinedEventFactors: DEMO_CE_FACTORS,
  // Index 0 puts this leg first, whatever the schedule or SubEvents' order say.
  Index: 0,
  Enrollments: demoOtteluEnrollments(),
  // The round says 'Progress' where the schedule row says 'Official', the
  // stale copy a results resource can carry (reconcileStatuses,
  // lib/schedule.js). The standings take the schedule's, or this leg reads
  // "kesken" for good.
  Rounds: [
    demoRound(
      'r34',
      'Loppukilpailu',
      0,
      demoTs(8, 45),
      [
        // Ranks run over both heats, and HeatRank is each heat's own (demoRunner).
        demoHeat(1, [
          demoRunner('o1', 1, 701, 'Oona Demoinen', 'Demon Urheilijat', 'DemU', {
            result: '7,22',
            rank: 1,
            heatRank: 1,
            ce: 200,
          }),
          demoRunner('o3', 2, 703, 'Minea Mallinen', 'Mallikylän Vire', 'MalV', {
            result: '7,51',
            rank: 3,
            heatRank: 2,
            ce: 161,
          }),
          demoRunner('o5', 3, 705, 'Pihla Harjoitinen', 'Harjoituspiirin Urheilijat', 'HarjU', {
            result: '7,64',
            rank: 5,
            heatRank: 3,
            ce: 146,
          }),
        ]),
        demoHeat(2, [
          demoRunner('o2', 1, 702, 'Lyyli Testinen', 'Testilän Kisa', 'TeKi', {
            result: '7,26',
            rank: 2,
            heatRank: 1,
            ce: 194,
          }),
          demoRunner('o4', 2, 704, 'Fanni Kokeinen', 'Näyteniemen Vauhti', 'NäVa', {
            result: '7,59',
            rank: 4,
            heatRank: 2,
            ce: 151,
          }),
          demoRunner('o6', 3, 706, 'Vieno Näytteinen', 'Näyteniemen Vauhti', 'NäVa', {
            result: '7,76',
            rank: 6,
            heatRank: 3,
            ce: 134,
          }),
          // The guest runs the fastest time with points and null in both rank
          // fields, as the API publishes a guest (docs/tuloslista-api.md).
          demoRunner('o7', 4, 707, 'Ilona Vierainen', 'Ulkomaalainen Vieras', 'UlkV', {
            result: '7,18',
            ce: 206,
            ku: true,
            cup: 540,
          }),
        ]),
      ],
      {},
      'Progress',
    ),
  ],
};

// The Pituus is half jumped. Two of seven have no mark yet, so the standings
// leave those cells blank, not 0, and the leg's ladder has points on some rows.
DEMO_EVENTS.e35 = {
  Id: 'e35',
  Name: 'T9 3-ottelu  Pituus',
  EventCategory: 'Field',
  EventSubCategory: 'HorizontalJump',
  EventType: { Category: 'Field', SubCategory: 'HorizontalJump', Name: 'Pituus' },
  IsCombinedEvent: true,
  RootId: 'e37',
  RootName: 'T9 3-ottelu',
  CombinedEventFactors: DEMO_CE_FACTORS,
  Index: 1,
  Enrollments: demoOtteluEnrollments(),
  // Three jumps each and no wind readings, the way a real leg was published.
  Rounds: [
    demoRound(
      'r35',
      'Loppukilpailu',
      0,
      demoTs(10, 30),
      [
        demoHeat(1, [
          demoFieldAlloc('o1', 1, 701, 'Oona Demoinen', 'Demon Urheilijat', 'DemU', [['3.41'], ['3.50'], ['x']], {
            result: '3.50',
            rank: 1,
            ce: 192,
          }),
          demoFieldAlloc('o2', 2, 702, 'Lyyli Testinen', 'Testilän Kisa', 'TeKi', [['3.23'], ['x'], ['3.18']], {
            result: '3.23',
            rank: 2,
            ce: 156,
          }),
          demoFieldAlloc('o3', 3, 703, 'Minea Mallinen', 'Mallikylän Vire', 'MalV', [['3.05'], ['3.22'], ['3.11']], {
            result: '3.22',
            rank: 3,
            ce: 155,
          }),
          demoFieldAlloc('o4', 4, 704, 'Fanni Kokeinen', 'Näyteniemen Vauhti', 'NäVa', [['3.19'], ['x'], ['3.02']], {
            result: '3.19',
            rank: 4,
            ce: 151,
          }),
          demoFieldAlloc('o5', 5, 705, 'Pihla Harjoitinen', 'Harjoituspiirin Urheilijat', 'HarjU', []),
          demoFieldAlloc('o6', 6, 706, 'Vieno Näytteinen', 'Näyteniemen Vauhti', 'NäVa', []),
          demoFieldAlloc('o7', 7, 707, 'Ilona Vierainen', 'Ulkomaalainen Vieras', 'UlkV', [['3.44'], ['3.52'], ['x']], {
            result: '3.52',
            ce: 195,
            ku: true,
            cup: 520,
          }),
        ]),
      ],
      {},
      'Progress',
    ),
  ],
};

// The Kuula is drawn and untouched. Its standings column is empty, and its
// start list carries no points.
DEMO_EVENTS.e36 = {
  Id: 'e36',
  Name: 'T9 3-ottelu  Kuula',
  EventCategory: 'Field',
  EventSubCategory: 'Throw',
  EventType: { Category: 'Field', SubCategory: 'Throw', Name: 'Kuula' },
  IsCombinedEvent: true,
  RootId: 'e37',
  RootName: 'T9 3-ottelu',
  CombinedEventFactors: DEMO_CE_FACTORS,
  Index: 2,
  Enrollments: demoOtteluEnrollments(),
  Rounds: [
    demoRound(
      'r36',
      'Loppukilpailu',
      0,
      demoTs(12, 45),
      [
        demoHeat(
          1,
          DEMO_OTTELU.filter((a) => !a.out).map((a, i) =>
            demoFieldAlloc(a.id, i + 1, a.bib, a.name, a.org.name, a.org.short, [], { ku: a.ku }),
          ),
        ),
      ],
      {},
      'Allocated',
    ),
  ],
};

// The root is on no day's schedule and holds the standings. Its round stays
// Unallocated however finished the meet is (docs/tuloslista-api.md), so the
// chip comes from the legs' schedule rows (combinedEventStarts,
// lib/combined.js).
DEMO_EVENTS.e37 = {
  Id: 'e37',
  Name: 'T9 3-ottelu',
  EventCategory: 'Combined',
  EventType: { Category: 'Combined', Name: '3-ottelu' },
  // The flag is true on both halves. RootId 0 separates the root from a leg
  // (combinedEventRoots, lib/roster.js).
  IsCombinedEvent: true,
  RootId: 0,
  RootName: null,
  CombinedEventFactors: DEMO_CE_FACTORS,
  Index: 0,
  Enrollments: demoOtteluEnrollments(),
  // The SubEvents are listed out of contest order on purpose, since only Index
  // gives the order (docs/tuloslista-api.md). The standings sort by Index
  // (combinedLegColumns, lib/combined.js).
  SubEvents: [DEMO_EVENTS.e35, DEMO_EVENTS.e36, DEMO_EVENTS.e34],
  // The root's one heat is a container. Its Index and every Position are 0,
  // and HeatRank copies ResultRank (docs/tuloslista-api.md).
  Rounds: [demoRound('r37', 'Loppukilpailu', 0, demoTs(8, 45), [demoHeat(0, demoOtteluTotals())], {}, 'Unallocated')],
};

// --- The multi-event that has not started: legs drawn, root empty ---
// This P9 3-ottelu is drawn and not yet contested, as a multi-event's legs can
// be drawn days before it runs. Its standings are the entry list over leg
// columns still empty (combinedTotals, lib/combined.js).
const DEMO_OTTELU2 = [
  { id: 'l1', bib: 711, name: 'Eino Demoinen', org: DEMO_ORG_DEMU },
  { id: 'l2', bib: 712, name: 'Väinö Testinen', org: DEMO_ORG_TEKI },
  { id: 'l3', bib: 713, name: 'Toivo Mallinen', org: DEMO_ORG_MALV },
  { id: 'l4', bib: 714, name: 'Aarne Kokeinen', org: DEMO_ORG_NAVA },
];

const demoOttelu2Enrollments = () =>
  DEMO_OTTELU2.map((a) => demoEnrollment(a.id, a.bib, a.name, a.org, { unconfirmed: a.id === 'l4' }));

const demoOttelu2Track = () =>
  DEMO_OTTELU2.map((a, i) => demoRunner(a.id, i + 1, a.bib, a.name, a.org.name, a.org.short));
const demoOttelu2Field = () =>
  DEMO_OTTELU2.map((a, i) => demoFieldAlloc(a.id, i + 1, a.bib, a.name, a.org.name, a.org.short, []));

DEMO_EVENTS.e38 = {
  Id: 'e38',
  Name: 'P9 3-ottelu  40m',
  EventCategory: 'Track',
  EventSubCategory: 'Sprint',
  EventType: { Length: 40, Category: 'Track', TeamSize: 1, Name: '40m' },
  IsCombinedEvent: true,
  RootId: 'e41',
  RootName: 'P9 3-ottelu',
  CombinedEventFactors: DEMO_CE_FACTORS,
  Index: 0,
  Enrollments: demoOttelu2Enrollments(),
  Rounds: [demoRound('r38', 'Loppukilpailu', 0, demoTs(14, 30), [demoHeat(1, demoOttelu2Track())], {}, 'Allocated')],
};

DEMO_EVENTS.e39 = {
  Id: 'e39',
  Name: 'P9 3-ottelu  Pituus',
  EventCategory: 'Field',
  EventSubCategory: 'HorizontalJump',
  EventType: { Category: 'Field', SubCategory: 'HorizontalJump', Name: 'Pituus' },
  IsCombinedEvent: true,
  RootId: 'e41',
  RootName: 'P9 3-ottelu',
  CombinedEventFactors: DEMO_CE_FACTORS,
  Index: 1,
  Enrollments: demoOttelu2Enrollments(),
  Rounds: [demoRound('r39', 'Loppukilpailu', 0, demoTs(15, 15), [demoHeat(1, demoOttelu2Field())], {}, 'Allocated')],
};

DEMO_EVENTS.e40 = {
  Id: 'e40',
  Name: 'P9 3-ottelu  Kuula',
  EventCategory: 'Field',
  EventSubCategory: 'Throw',
  EventType: { Category: 'Field', SubCategory: 'Throw', Name: 'Kuula' },
  IsCombinedEvent: true,
  RootId: 'e41',
  RootName: 'P9 3-ottelu',
  CombinedEventFactors: DEMO_CE_FACTORS,
  Index: 2,
  Enrollments: demoOttelu2Enrollments(),
  Rounds: [demoRound('r40', 'Loppukilpailu', 0, demoTs(16, 0), [demoHeat(1, demoOttelu2Field())], {}, 'Allocated')],
};

DEMO_EVENTS.e41 = {
  Id: 'e41',
  Name: 'P9 3-ottelu',
  EventCategory: 'Combined',
  EventType: { Category: 'Combined', Name: '3-ottelu' },
  IsCombinedEvent: true,
  RootId: 0,
  RootName: null,
  CombinedEventFactors: DEMO_CE_FACTORS,
  Index: 0,
  Enrollments: demoOttelu2Enrollments(),
  SubEvents: [DEMO_EVENTS.e38, DEMO_EVENTS.e39, DEMO_EVENTS.e40],
  // The root's round is a heat shell, one empty heat left at Unallocated, so
  // Enrollments is the whole field (combinedTotals, lib/combined.js). (Break
  // on purpose: give it the four allocations and the entry list is never
  // reached.)
  Rounds: [demoRound('r41', 'Loppukilpailu', 0, demoTs(14, 30), [demoHeat(0, [])], {}, 'Unallocated')],
};

// The T11 3-ottelu is entered and undrawn. Its legs carry no round, and the
// root is a heat shell. Its three clubs have entries elsewhere in the day, so
// the day's confirmation list folds an ottelu (watchConfirmations,
// lib/confirmation.js).
const DEMO_OTTELU3 = [
  { id: 'ot1', bib: 721, name: 'Sofia Demoinen', org: DEMO_ORG_DEMU },
  { id: 'ot2', bib: 722, name: 'Iiris Mallinen', org: DEMO_ORG_MALV, unconfirmed: true },
  { id: 'ot3', bib: 723, name: 'Venla Testinen', org: DEMO_ORG_TEKI },
];

// `off` unconfirms one entry on one leg while the root keeps her confirmed,
// as a leg's own Confirmed can disagree with the root's
// (docs/tuloslista-api.md).
const demoOttelu3Enrollments = (off = null) =>
  DEMO_OTTELU3.map((a) => demoEnrollment(a.id, a.bib, a.name, a.org, { unconfirmed: !!a.unconfirmed || a.id === off }));

const demoOttelu3Leg = (id, rest) => ({
  Id: id,
  IsCombinedEvent: true,
  RootId: 'e59',
  RootName: 'T11 3-ottelu',
  CombinedEventFactors: DEMO_CE_FACTORS,
  Enrollments: demoOttelu3Enrollments(),
  Rounds: [],
  ...rest,
});

DEMO_EVENTS.e56 = demoOttelu3Leg('e56', {
  Enrollments: demoOttelu3Enrollments('ot3'),
  Name: 'T11 3-ottelu  40m',
  EventCategory: 'Track',
  EventSubCategory: 'Sprint',
  EventType: { Length: 40, Category: 'Track', TeamSize: 1, Name: '40m' },
  Index: 0,
});

DEMO_EVENTS.e57 = demoOttelu3Leg('e57', {
  Name: 'T11 3-ottelu  Korkeus',
  EventCategory: 'Field',
  EventSubCategory: 'HighJump',
  EventType: { Length: 0, Category: 'Field', TeamSize: 1, Name: 'Korkeus' },
  Index: 1,
});

DEMO_EVENTS.e58 = demoOttelu3Leg('e58', {
  Name: 'T11 3-ottelu  Kuula',
  EventCategory: 'Field',
  EventSubCategory: 'ShotPut',
  EventType: { Length: 0, Category: 'Field', TeamSize: 1, Name: 'Kuula' },
  Index: 2,
});

DEMO_EVENTS.e59 = {
  Id: 'e59',
  Name: 'T11 3-ottelu',
  EventCategory: 'Combined',
  EventType: { Category: 'Combined', Name: '3-ottelu' },
  IsCombinedEvent: true,
  RootId: 0,
  RootName: null,
  CombinedEventFactors: DEMO_CE_FACTORS,
  Index: 0,
  Enrollments: demoOttelu3Enrollments(),
  SubEvents: [DEMO_EVENTS.e56, DEMO_EVENTS.e57, DEMO_EVENTS.e58],
  Rounds: [demoRound('r59', 'Loppukilpailu', 0, demoTs(11, 15), [demoHeat(0, [])], {}, 'Unallocated')],
};

// One of four has confirmed in this undrawn field final. No round is in
// Rounds[], as before a draw (docs/tuloslista-api.md), so Enrollments is the
// start list.
DEMO_EVENTS.e45 = {
  Name: 'T13 Korkeus',
  EventCategory: 'Field',
  EventSubCategory: 'HighJump',
  EventType: { Length: 0, Category: 'Field', TeamSize: 1, Name: 'Korkeus' },
  Enrollments: [
    // DemU also has entries in e6 and the T11 3-ottelu, so its day's
    // confirmation list counts 3/4 (watchConfirmations, lib/confirmation.js).
    demoEnrollment('v1', 71, 'Sanni Demoinen', DEMO_ORG_DEMU, { sb: '1.45', pb: '1.48' }),
    demoEnrollment('v2', 72, 'Veera Mallinen', DEMO_ORG_DEMU, { sb: '1.40', pb: '1.42', unconfirmed: true }),
    demoEnrollment('v3', 73, 'Elsa Vireinen', DEMO_ORG_MALV, { sb: '1.38', pb: '1.38', unconfirmed: true }),
    demoEnrollment('v4', 74, 'Aada Kisainen', DEMO_ORG_TEKI, { sb: '1.35', pb: '1.36', unconfirmed: true }),
  ],
  Rounds: [],
};

// The meet's setting alone puts this start's 0/3 on its start page
// (confirmNote, lib/confirmation.js), while the day list's row reads its three
// entries (countLine).
DEMO_EVENTS.e46 = {
  Name: 'T13 Kuula',
  EventCategory: 'Field',
  EventSubCategory: 'ShotPut',
  EventType: { Length: 0, Category: 'Field', TeamSize: 1, Name: 'Kuula' },
  Enrollments: [
    demoEnrollment('kk1', 75, 'Helmi Testilä', DEMO_ORG_TEKI, { sb: '9.12', pb: '9.44', unconfirmed: true }),
    demoEnrollment('kk2', 76, 'Pihla Vauhtinen', DEMO_ORG_NAVA, { sb: '8.87', pb: '8.87', unconfirmed: true }),
    demoEnrollment('kk3', 77, 'Alma Harjoinen', DEMO_ORG_HARJ, { sb: '8.40', pb: '8.61', unconfirmed: true }),
  ],
  Rounds: [],
};

// Like e8, this class has no enrollments and no round, and its day-list line
// reads "Ei ilmoittautuneita".
DEMO_EVENTS.e55 = {
  Name: 'P13 Kuula',
  EventCategory: 'Field',
  EventSubCategory: 'ShotPut',
  EventType: { Length: 0, Category: 'Field', TeamSize: 1, Name: 'Kuula' },
  Enrollments: [],
  Rounds: [],
};

// The masters classes are one runner each, as at a measured meet (2026-01).
// The box gives each setting its lanes (hurdleStartSetups, lib/hurdles.js).
// Lanes 2 and 4 stay empty where that meet filled them, since a change of
// setting needs a free lane beside it (observed, 2026-09). The wind is 'NM',
// as on a heat without a reading (docs/tuloslista-api.md).
DEMO_EVENTS.e47 = {
  Name: 'M17 60m aidat',
  EventCategory: 'Track',
  EventSubCategory: 'Hurdles',
  EventType: { Length: 60, Category: 'Track', SubCategory: 'Hurdles', TeamSize: 1, Name: '60m aidat' },
  Enrollments: [
    demoEnrollment('ai1', 81, 'Jooa Mallinen', DEMO_ORG_DEMU, { sb: '8.82', pb: '8.82' }),
    demoEnrollment('ai2', 82, 'Niilo Testinen', DEMO_ORG_TEKI, { sb: '9.04', pb: '8.95' }),
  ],
  Rounds: [
    demoRound(
      'r47',
      'Loppukilpailu',
      0,
      demoTs(10, 10),
      [
        demoHeat(
          1,
          [
            demoRunner('ai1', 5, 81, 'Jooa Mallinen', 'Demon Urheilijat', 'DemU'),
            demoRunner('ai2', 6, 82, 'Niilo Testinen', 'Testilän Kisa', 'TeKi'),
          ],
          'NM',
        ),
      ],
      {},
      'Allocated',
    ),
  ],
};

DEMO_EVENTS.e48 = {
  Name: 'M50 60m aidat',
  EventCategory: 'Track',
  EventSubCategory: 'Hurdles',
  EventType: { Length: 60, Category: 'Track', SubCategory: 'Hurdles', TeamSize: 1, Name: '60m aidat' },
  Enrollments: [demoEnrollment('ai3', 83, 'Sami Vauhtinen', DEMO_ORG_NAVA, { sb: '9.88', pb: '9.61' })],
  Rounds: [
    demoRound(
      'r48',
      'Loppukilpailu',
      0,
      demoTs(10, 10),
      [demoHeat(1, [demoRunner('ai3', 3, 83, 'Sami Vauhtinen', 'Näyteniemen Vauhti', 'NäVa')], 'NM')],
      {},
      'Allocated',
    ),
  ],
};

DEMO_EVENTS.e49 = {
  Name: 'M65 60m aidat',
  EventCategory: 'Track',
  EventSubCategory: 'Hurdles',
  EventType: { Length: 60, Category: 'Track', SubCategory: 'Hurdles', TeamSize: 1, Name: '60m aidat' },
  Enrollments: [demoEnrollment('ai4', 84, 'Reijo Harjoinen', DEMO_ORG_HARJ, { sb: '11.40', pb: '10.92' })],
  Rounds: [
    demoRound(
      'r49',
      'Loppukilpailu',
      0,
      demoTs(10, 10),
      [demoHeat(1, [demoRunner('ai4', 1, 84, 'Reijo Harjoinen', 'Harjoituspiirin Urheilijat', 'HarjU')], 'NM')],
      {},
      'Allocated',
    ),
  ],
};

DEMO_EVENTS.e54 = {
  Name: 'M65 100m aidat',
  EventCategory: 'Track',
  EventSubCategory: 'Hurdles',
  EventType: { Length: 100, Category: 'Track', SubCategory: 'Hurdles', TeamSize: 1, Name: '100m aidat' },
  Enrollments: [demoEnrollment('ai5', 85, 'Pentti Harjoinen', DEMO_ORG_HARJ, { sb: '24.27', pb: '23.90' })],
  Rounds: [demoRound('r54', 'Loppukilpailu', 0, demoTs(10, 0), [], {}, 'Unallocated')],
};

// The API files a 1500 m steeple as `Run` (docs/tuloslista-api.md). A Position
// is a place on a group start's line, not a lane the box could read.
DEMO_EVENTS.e51 = {
  Name: 'N 1500m esteet',
  EventCategory: 'Track',
  EventSubCategory: 'Run',
  EventType: { Length: 1500, Category: 'Track', SubCategory: 'Run', TeamSize: 1, Name: '1500m esteet' },
  Enrollments: [
    demoEnrollment('st1', 741, 'Sanni Estelinen', DEMO_ORG_DEMU, { sb: '5.41,20', pb: '5.32,08' }),
    demoEnrollment('st2', 742, 'Aada Vesinen', DEMO_ORG_MALV, { sb: '5.58,77', pb: '5.58,77' }),
  ],
  Rounds: [
    demoRound(
      'r51',
      'Loppukilpailu',
      0,
      demoTs(14, 40),
      [
        demoHeat(
          1,
          [
            demoRunner('st1', 1, 741, 'Sanni Estelinen', 'Demon Urheilijat', 'DemU'),
            demoRunner('st2', 2, 742, 'Aada Vesinen', 'Mallikylän Vire', 'MalV'),
          ],
          'NM',
        ),
      ],
      {},
      'Allocated',
    ),
  ],
};

DEMO_EVENTS.e52 = {
  Name: 'M15 1500m esteet',
  EventCategory: 'Track',
  EventSubCategory: 'Run',
  EventType: { Length: 1500, Category: 'Track', SubCategory: 'Run', TeamSize: 1, Name: '1500m esteet' },
  Enrollments: [demoEnrollment('st3', 743, 'Eetu Pukkinen', DEMO_ORG_TEKI, { sb: '4.58,31', pb: '4.58,31' })],
  Rounds: [
    demoRound(
      'r52',
      'Loppukilpailu',
      0,
      demoTs(14, 40),
      [demoHeat(1, [demoRunner('st3', 3, 743, 'Eetu Pukkinen', 'Testilän Kisa', 'TeKi')], 'NM')],
      {},
      'Allocated',
    ),
  ],
};

// --- democup: the club cup's own meet -----------------------------------
// It is an osakilpailu (DEMO_MEETS' Settings) over the demo's six clubs, and a
// competition of its own because no cup meet measured holds a multi-event
// (docs/tuloslista-api.md, "An osakilpailu").

const DEMO_CUP_STARTS = [
  // One start of two classes down one set of lanes (docs/tuloslista-api.md)
  // is two cup events that agree on their digits and do not merge. A club's
  // better runner scores, and the guest scores nobody.
  {
    eventId: 'c1',
    roundId: 'cr1',
    event: 'T11 60m',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Official',
    ts: demoTs(10, 0),
  },
  {
    eventId: 'c2',
    roundId: 'cr2',
    event: 'P11 60m',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Official',
    ts: demoTs(10, 0),
  },
  // The walks are two starts half an hour apart and one cup event. A DNS worth
  // 0 is its club's only row in that event.
  {
    eventId: 'c3',
    roundId: 'cr3',
    event: 'T11 1000m kävely',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Official',
    ts: demoTs(14, 15),
  },
  {
    eventId: 'c4',
    roundId: 'cr4',
    event: 'P11 1000m kävely',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Official',
    ts: demoTs(14, 45),
  },
  // Heats and no final make a `Qualify` round, which scores nobody.
  {
    eventId: 'c5',
    roundId: 'cr5',
    event: 'T13 200m',
    round: 'Alkuerät',
    category: 'Track',
    status: 'Official',
    ts: demoTs(9, 15),
  },
  // A relay team's own row scores its club.
  {
    eventId: 'c6',
    roundId: 'cr6',
    event: 'T13 4x100m viesti',
    round: 'Loppukilpailu',
    category: 'Relay',
    status: 'Official',
    ts: demoTs(11, 30),
  },
  // A field ladder carries the points rail. It is the one start still going,
  // so the meet's phase is Käynnissä (meetPhase, lib/schedule.js).
  {
    eventId: 'c7',
    roundId: 'cr7',
    event: 'P13 Kuula',
    round: 'Loppukilpailu',
    category: 'Field',
    status: 'Progress',
    ts: demoTs(12, 45),
  },
];

const DEMO_CUP_EVENTS = {};

// Both classes run in both heats, each heat one draw of lanes
// (lanesAreOneDraw, lib/results.js). Demon Urheilijat's two T11 runners score
// 820 alone. The guest's 860 tops the winner's, as a guest's rows carry real
// points (docs/tuloslista-api.md). (Break on purpose: add where cupStandings
// replaces, and the club gains 680.)
const DEMO_CUP_60M = [
  // [id, lane, bib, name, club, class, result, rank, heatRank, heat]
  // `rank` is round-wide in the class and `heatRank` the class's in the heat.
  ['sc16', 1, 706, 'Guest Sprinter', DEMO_ORG_ULKV, 'T11', '9,05', null, null, 1],
  ['sc13', 2, 703, 'Peppi Loikkanen', DEMO_ORG_DEMU, 'T11', '9,31', 3, 3, 1],
  ['sc11', 3, 701, 'Iiris Seurainen', DEMO_ORG_DEMU, 'T11', '9,12', 1, 1, 1],
  ['sc12', 4, 702, 'Milla Kisanen', DEMO_ORG_TEKI, 'T11', '9,24', 2, 2, 1],
  ['sc17', 5, 711, 'Aatu Kisanen', DEMO_ORG_TEKI, 'P11', '9,02', 1, 1, 1],
  ['sc18', 6, 712, 'Niilo Seurainen', DEMO_ORG_DEMU, 'P11', '9,15', 2, 2, 1],
  ['sc19', 2, 713, 'Otso Pisteenmaa', DEMO_ORG_MALV, 'P11', '9,29', 3, 1, 2],
  ['sc14', 3, 704, 'Sofia Ratanen', DEMO_ORG_NAVA, 'T11', '9,48', 4, 1, 2],
  ['sc20', 4, 714, 'Eemeli Juoksunen', DEMO_ORG_HARJ, 'P11', '9,44', 4, 2, 2],
  ['sc15', 5, 705, 'Nelli Juoksunen', DEMO_ORG_HARJ, 'T11', '9,60', 5, 2, 2],
  ['sc21', 6, 715, 'Leevi Ratanen', DEMO_ORG_NAVA, 'P11', '9,58', 5, 3, 2],
];

// Every row here beats its SB, and all but one beat their PB (beatsMark,
// lib/results.js).
const DEMO_CUP_60M_BESTS = {
  sc11: { sb: '9,18', pb: '9,18' },
  sc12: { sb: '9,30', pb: '9,22' },
  sc13: { sb: '9,35', pb: '9,35' },
  sc14: { sb: '9,52', pb: '9,50' },
  sc15: { sb: '9,61', pb: '9,61' },
  sc17: { sb: '9,08', pb: '9,08' },
  sc18: { sb: '9,20', pb: '9,17' },
  sc19: { sb: '9,33', pb: '9,33' },
  sc20: { sb: '9,49', pb: '9,45' },
  sc21: { sb: '9,60', pb: '9,60' },
};

// Returns one class's event out of that start.
function demoCup60mEvent(label, eventId, roundId) {
  const mine = DEMO_CUP_60M.filter(([, , , , , cls]) => cls === label);
  const heats = [1, 2].map((idx) =>
    demoHeat(
      idx,
      mine
        .filter((r) => r[9] === idx)
        .map(([id, lane, bib, name, org, , result, rank, heatRank]) =>
          demoRunner(id, lane, bib, name, org.name, org.short, {
            result,
            rank,
            heatRank,
            ...(DEMO_CUP_60M_BESTS[id] || {}),
            // The guest is ranked nowhere, so its score is written down (demoCupPoints).
            ...(id === 'sc16' ? { ku: true, cup: 860 } : {}),
          }),
        ),
      idx === 1 ? '+0,6' : '−0,3',
    ),
  );
  return {
    Name: `${label} 60m`,
    Group: label,
    EventCategory: 'Track',
    EventSubCategory: 'Sprint',
    EventType: { Length: 60, Category: 'Track', SubCategory: 'Sprint', TeamSize: 1, Name: '60m' },
    Enrollments: mine.map(([id, , bib, name, org, , , , ,]) =>
      demoEnrollment(id, bib, name, org, {
        ...(DEMO_CUP_60M_BESTS[id] || {}),
        ...(id === 'sc16' ? { ku: true } : {}),
      }),
    ),
    Rounds: [demoRound(roundId, 'Loppukilpailu', 0, demoTs(10, 0), heats)],
  };
}

DEMO_CUP_EVENTS.c1 = demoCup60mEvent('T11', 'c1', 'cr1');
DEMO_CUP_EVENTS.c2 = demoCup60mEvent('P11', 'c2', 'cr2');

// A club scores its best walker across both races (docs/tuloslista-api.md,
// "The walk is one event for both genders"). Demon Urheilijat scores 610 of 500
// and 610, and Mallikylän Vire 430 of 380 and 430. (Break on purpose: drop the
// Walk branch from cupEventKey, and the two gain their 500 and 380.)
const DEMO_WALK_EVENT_TYPE = {
  Length: 1000,
  Category: 'Track',
  SubCategory: 'Walk',
  TeamSize: 1,
  Name: '1000m kävely',
};

DEMO_CUP_EVENTS.c3 = {
  Name: 'T11 1000m kävely',
  Group: 'T11',
  EventCategory: 'Track',
  EventSubCategory: 'Walk',
  EventType: DEMO_WALK_EVENT_TYPE,
  Enrollments: [
    demoEnrollment('sc1', 731, 'Aino Kävelinen', DEMO_ORG_TEKI),
    demoEnrollment('sc2', 732, 'Elsa Demoinen', DEMO_ORG_DEMU),
    demoEnrollment('sc3', 733, 'Sohvi Mallinen', DEMO_ORG_MALV),
  ],
  Rounds: [
    demoRound('cr3', 'Loppukilpailu', 0, demoTs(14, 15), [
      demoHeat(1, [
        demoRunner('sc1', 1, 731, 'Aino Kävelinen', 'Testilän Kisa', 'TeKi', { result: '6.11,69', rank: 1, cup: 640 }),
        demoRunner('sc2', 2, 732, 'Elsa Demoinen', 'Demon Urheilijat', 'DemU', {
          result: '6.24,03',
          rank: 2,
          cup: 500,
        }),
        demoRunner('sc3', 3, 733, 'Sohvi Mallinen', 'Mallikylän Vire', 'MalV', {
          result: '6.58,12',
          rank: 3,
          cup: 380,
        }),
      ]),
    ]),
  ],
};

DEMO_CUP_EVENTS.c4 = {
  Name: 'P11 1000m kävely',
  Group: 'P11',
  EventCategory: 'Track',
  EventSubCategory: 'Walk',
  EventType: DEMO_WALK_EVENT_TYPE,
  Enrollments: [
    demoEnrollment('sc4', 734, 'Onni Demoinen', DEMO_ORG_DEMU),
    demoEnrollment('sc5', 735, 'Elias Näyteinen', DEMO_ORG_NAVA),
    demoEnrollment('sc6', 736, 'Väinö Mallinen', DEMO_ORG_MALV),
    demoEnrollment('sc10', 740, 'Topi Harjoitteleva', DEMO_ORG_HARJ),
  ],
  Rounds: [
    demoRound('cr4', 'Loppukilpailu', 0, demoTs(14, 45), [
      demoHeat(1, [
        demoRunner('sc4', 1, 734, 'Onni Demoinen', 'Demon Urheilijat', 'DemU', {
          result: '6.02,45',
          rank: 1,
          cup: 610,
        }),
        demoRunner('sc5', 2, 735, 'Elias Näyteinen', 'Näyteniemen Vauhti', 'NäVa', {
          result: '6.31,90',
          rank: 2,
          cup: 470,
        }),
        demoRunner('sc6', 3, 736, 'Väinö Mallinen', 'Mallikylän Vire', 'MalV', {
          result: '6.44,21',
          rank: 3,
          cup: 430,
        }),
        // This DNS is no scoring row. (Break on purpose: drop the points test
        // from cupStandings' scoring push, and 'c4:sc10' is in it.)
        demoRunner('sc10', 4, 740, 'Topi Harjoitteleva', 'Harjoituspiirin Urheilijat', 'HarjU', { result: 'DNS' }),
      ]),
    ]),
  ],
};

// The round is heats alone, with no final (docs/tuloslista-api.md).
// (Break on purpose: drop the RoundTypeCategory test from cupStandings, and
// three clubs gain 800, 720 and 640.)
DEMO_CUP_EVENTS.c5 = {
  Name: 'T13 200m',
  Group: 'T13',
  EventCategory: 'Track',
  EventSubCategory: 'Sprint',
  EventType: { Length: 200, Category: 'Track', TeamSize: 1, Name: '200m' },
  Enrollments: [
    demoEnrollment('sc7', 737, 'Venla Demoinen', DEMO_ORG_DEMU),
    demoEnrollment('sc8', 738, 'Iida Kokeinen', DEMO_ORG_TEKI),
    demoEnrollment('sc9', 739, 'Nea Vauhtinen', DEMO_ORG_NAVA),
  ],
  Rounds: [
    demoRound('cr5', 'Alkuerät', 0, demoTs(9, 15), [
      demoHeat(1, [
        demoRunner('sc7', 3, 737, 'Venla Demoinen', 'Demon Urheilijat', 'DemU', { result: '29,02', rank: 1, cup: 800 }),
        demoRunner('sc8', 4, 738, 'Iida Kokeinen', 'Testilän Kisa', 'TeKi', { result: '29,44', rank: 2, cup: 720 }),
        demoRunner('sc9', 5, 739, 'Nea Vauhtinen', 'Näyteniemen Vauhti', 'NäVa', {
          result: '30,10',
          rank: 3,
          cup: 640,
        }),
      ]),
    ]),
  ],
};

const DEMO_CUP_RELAY_TEAMS = [
  lapTeam('cv1', 'Demon Urheilijat', DEMO_ORG_DEMU, 3, 721, [
    ['Aaro', 'Seurainen'],
    ['Vilja', 'Loikkanen'],
    ['Ellen', 'Kaarteinen'],
    ['Nea', 'Pisteenmaa'],
  ]),
  lapTeam('cv2', 'Testilän Kisa', DEMO_ORG_TEKI, 4, 722, [
    ['Oona', 'Kisanen'],
    ['Aino', 'Ratanen'],
    ['Veera', 'Juoksunen'],
    ['Enni', 'Kisanen'],
  ]),
  lapTeam('cv3', 'Mallikylän Vire', DEMO_ORG_MALV, 5, 723, [
    ['Sanni', 'Pisteenmaa'],
    ['Tuuli', 'Kaarteinen'],
    ['Meri', 'Loikkanen'],
    ['Nelma', 'Seurainen'],
  ]),
  lapTeam('cv4', 'Harjoituspiirin Urheilijat', DEMO_ORG_HARJ, 6, 724, [
    ['Kerttu', 'Juoksunen'],
    ['Anni', 'Ratanen'],
    ['Alma', 'Kaarteinen'],
    ['Iida', 'Juoksunen'],
  ]),
];

DEMO_CUP_EVENTS.c6 = {
  Name: 'T13 4x100m viesti',
  Group: 'T13',
  EventCategory: 'Relay',
  EventSubCategory: 'Sprint',
  EventType: { Length: 100, Category: 'Relay', TeamSize: 4, Name: '4x100m viesti' },
  Enrollments: DEMO_CUP_RELAY_TEAMS.map(demoTeamEnrollment),
  Rounds: [
    demoRound('cr6', 'Loppukilpailu', 0, demoTs(11, 30), [
      demoHeat(1, [
        demoTeam(DEMO_CUP_RELAY_TEAMS[0], 3, 721, 4, { result: '55,12', rank: 1 }),
        demoTeam(DEMO_CUP_RELAY_TEAMS[1], 4, 722, 4, { result: '55,88', rank: 2 }),
        demoTeam(DEMO_CUP_RELAY_TEAMS[2], 5, 723, 4, { result: '56,40', rank: 3 }),
        demoTeam(DEMO_CUP_RELAY_TEAMS[3], 6, 724, 4, { result: '57,03', rank: 4 }),
      ]),
    ]),
  ],
};

// Three fouls score 0 on a club's second row in the event.
DEMO_CUP_EVENTS.c7 = {
  Name: 'P13 Kuula',
  Group: 'P13',
  EventCategory: 'Field',
  EventSubCategory: 'Throw',
  EventType: { Category: 'Field', SubCategory: 'Throw', TeamSize: 1, Name: 'Kuula' },
  Enrollments: [
    demoEnrollment('sc22', 741, 'Miska Seurainen', DEMO_ORG_DEMU, { sb: '10.02', pb: '10.02' }),
    demoEnrollment('sc23', 742, 'Roope Ratanen', DEMO_ORG_NAVA, { sb: '9.90', pb: '10.11' }),
    demoEnrollment('sc24', 743, 'Elmeri Pisteenmaa', DEMO_ORG_MALV, { sb: '9.28', pb: '9.28' }),
    demoEnrollment('sc25', 744, 'Sisu Loikkanen', DEMO_ORG_DEMU, { sb: '8.94', pb: '9.05' }),
    demoEnrollment('sc26', 745, 'Aatos Kaarteinen', DEMO_ORG_HARJ, { sb: '8.66', pb: '8.66' }),
  ],
  Rounds: [
    demoRound(
      'cr7',
      'Loppukilpailu',
      0,
      demoTs(12, 45),
      [
        demoHeat(1, [
          demoFieldAlloc('sc22', 1, 741, 'Miska Seurainen', 'Demon Urheilijat', 'DemU', [['10.12'], ['10.44'], ['x']], {
            result: '10.44',
            rank: 1,
            sb: '10.02',
            pb: '10.02',
          }),
          demoFieldAlloc('sc23', 2, 742, 'Roope Ratanen', 'Näyteniemen Vauhti', 'NäVa', [['9.71'], ['x'], ['9.87']], {
            result: '9.87',
            rank: 2,
            sb: '9.90',
            pb: '10.11',
          }),
          demoFieldAlloc('sc24', 3, 743, 'Elmeri Pisteenmaa', 'Mallikylän Vire', 'MalV', [['9.12'], ['8.98'], ['x']], {
            result: '9.12',
            rank: 3,
            sb: '9.28',
            pb: '9.28',
          }),
          demoFieldAlloc('sc25', 4, 744, 'Sisu Loikkanen', 'Demon Urheilijat', 'DemU', [['x'], ['x'], ['x']], {
            result: 'NM',
            sb: '8.94',
            pb: '9.05',
          }),
          // A row still to throw has no result and shows no points.
          demoFieldAlloc('sc26', 5, 745, 'Aatos Kaarteinen', 'Harjoituspiirin Urheilijat', 'HarjU', [], {
            sb: '8.66',
            pb: '8.66',
          }),
        ]),
      ],
      {},
      'Progress',
    ),
  ],
};

// Nobody confirms, as in most meets with no Type-1 setting (DEMO_MEETS,
// docs/tuloslista-api.md).
for (const event of Object.values(DEMO_CUP_EVENTS)) {
  event.Enrollments = event.Enrollments.map((e) => ({ ...e, Confirmed: false }));
}

// --- democupfinal: a Seuracup final, which scores by place ---
// Three starts of a real Superfinaali keep its heats, places, marks, shared
// heights and DNF row for row. The names, and which of the eight clubs took
// which row, are invented.
const DEMO_CUP_FINAL_STARTS = [
  {
    eventId: 'f1',
    roundId: 'fr1',
    event: 'P13 Korkeus',
    round: 'Loppukilpailu',
    category: 'Field',
    status: 'Official',
    ts: demoTs(10, 10),
  },
  {
    eventId: 'f2',
    roundId: 'fr2',
    event: 'T13 60m aidat',
    round: 'Loppukilpailu',
    category: 'Track',
    status: 'Official',
    ts: demoTs(11, 10),
  },
  {
    eventId: 'f3',
    roundId: 'fr3',
    event: 'Sukkulaviesti 16x60m',
    round: 'Loppukilpailu',
    category: 'Relay',
    status: 'Official',
    ts: demoTs(14, 45),
    gender: 'Male',
    age: '0',
  },
];

const DEMO_CUP_FINAL_EVENTS = {};

// P13 Korkeus is one pool whose places 5, 8 and 14 are shared, so its points
// come in halves.
// [id, position, bib, name, org, result, rank, attempts, pb]
const DEMO_CUP_FINAL_HIGH = [
  ['sf1', 1, 5, 'Leo Demoinen', DEMO_ORG_DEMU, '135', 8, '125:o 130:o 135:o 140:xxx', '148'],
  ['sf2', 2, 1, 'Joel Demoinen', DEMO_ORG_DEMU, '145', 5, '140:o 145:o 150:xxx', '163'],
  ['sf3', 3, 9, 'Emil Harjoitteleva', DEMO_ORG_HARJ, '120', 13, '110:o 120:xo 125:xxx', '139'],
  ['sf4', 4, 12, 'Aleksi Kokeilu', DEMO_ORG_KOKI, '135', 10, '110:o 120:o 125:xo 130:o 135:o 140:xxx', '134'],
  ['sf5', 6, 15, 'Elmeri Esimerkki', DEMO_ORG_ESPO, '150', 3, '130:xo 135:o 140:o 145:o 150:xo 153:xxx', '146'],
  ['sf6', 7, 8, 'Benjamin Näyteinen', DEMO_ORG_NAVA, '135', 8, '125:o 130:o 135:o 140:xxx', '141'],
  ['sf7', 8, 13, 'Jasper Pisteinen', DEMO_ORG_PIPY, '120', 12, '110:o 120:o 125:xxx', '130'],
  ['sf8', 9, 6, 'Topias Mallinen', DEMO_ORG_MALV, '145', 5, '125:o 130:o 135:o 140:o 145:o 150:xxx', '140'],
  ['sf9', 10, 14, 'Peetu Pisteinen', DEMO_ORG_PIPY, '110', 14, '110:o 120:xxx', '114'],
  ['sf10', 11, 4, 'Pekko Kisanen', DEMO_ORG_TEKI, '153', 2, '145:o 150:o 153:xo 156:xxx', '155'],
  ['sf11', 12, 11, 'Hugo Kokeilu', DEMO_ORG_KOKI, '140', 7, '120:o 125:o 130:o 135:o 140:xxo 145:xxx', '140'],
  ['sf12', 13, 7, 'Paavo Näyteinen', DEMO_ORG_NAVA, '150', 4, '140:xo 145:o 150:xxo 153:xxx', '157'],
  ['sf13', 14, 10, 'Paavo Harjoitteleva', DEMO_ORG_HARJ, '110', 14, '110:o 120:xxx', '125'],
  ['sf14', 15, 3, 'Joel Kisanen', DEMO_ORG_TEKI, '164', 1, '145:o 150:xo 153:o 156:o 160:xo 164:o 166:x', '163'],
  ['sf15', 16, 2, 'Lauri Mallinen', DEMO_ORG_MALV, '135', 11, '120:o 125:xo 130:xxo 135:xo 140:xxx', ''],
];

DEMO_CUP_FINAL_EVENTS.f1 = {
  Name: 'P13 Korkeus',
  Group: 'P13',
  EventCategory: 'Field',
  EventSubCategory: 'VerticalJump',
  EventType: { Category: 'Field', SubCategory: 'VerticalJump', TeamSize: 1, Name: 'Korkeus' },
  Enrollments: DEMO_CUP_FINAL_HIGH.map(([id, , bib, name, org, , , , pb]) =>
    demoEnrollment(id, bib, name, org, { sb: pb, pb }),
  ),
  Rounds: [
    demoRound('fr1', 'Loppukilpailu', 0, demoTs(10, 10), [
      demoHeat(
        1,
        DEMO_CUP_FINAL_HIGH.map(([id, position, bib, name, org, result, rank, attempts, pb]) =>
          demoFieldAlloc(
            id,
            position,
            bib,
            name,
            org.name,
            org.short,
            attempts.split(' ').map((a) => a.split(':')),
            { result, rank, sb: pb, pb },
          ),
        ),
      ),
    ]),
  ],
};

// T13 60m aidat lists its second heat first, as the API may
// (docs/tuloslista-api.md). One club fields a single runner, and her DNF is a
// row with no place.
// [id, lane, bib, name, org, result, rank, heatRank, heat, pb]
const DEMO_CUP_FINAL_HURDLES = [
  ['sf21', 1, 11, 'Camilla Kokeilu', DEMO_ORG_KOKI, 'DNF', null, null, 2, '10,86'],
  ['sf22', 2, 5, 'Pihla Mallinen', DEMO_ORG_MALV, '10,50', 8, 4, 2, ''],
  ['sf23', 3, 9, 'Ella Harjoitteleva', DEMO_ORG_HARJ, '10,91', 12, 7, 2, '9,95'],
  ['sf24', 4, 7, 'Ellen Näyteinen', DEMO_ORG_NAVA, '10,08', 3, 2, 2, '9,79'],
  ['sf25', 5, 1, 'Liina Demoinen', DEMO_ORG_DEMU, '9,72', 1, 1, 2, '9,40'],
  ['sf26', 6, 3, 'Aino Kisanen', DEMO_ORG_TEKI, '10,52', 9, 5, 2, '9,97'],
  ['sf27', 7, 13, 'Ada Pisteinen', DEMO_ORG_PIPY, '10,11', 4, 3, 2, '10,17'],
  ['sf28', 8, 15, 'Vilma Esimerkki', DEMO_ORG_ESPO, '10,63', 10, 6, 2, '10,47'],
  ['sf29', 1, 14, 'Henna Pisteinen', DEMO_ORG_PIPY, '11,94', 14, 7, 1, ''],
  ['sf30', 2, 6, 'Zoja Mallinen', DEMO_ORG_MALV, '10,32', 6, 3, 1, '10,28'],
  ['sf31', 3, 4, 'Signe Kisanen', DEMO_ORG_TEKI, '10,38', 7, 4, 1, '10,15'],
  ['sf32', 4, 10, 'Enni Harjoitteleva', DEMO_ORG_HARJ, '10,78', 11, 5, 1, '10,12'],
  ['sf33', 5, 2, 'Lumi Demoinen', DEMO_ORG_DEMU, '10,00', 2, 1, 1, '9,94'],
  ['sf34', 6, 8, 'Minnea Näyteinen', DEMO_ORG_NAVA, '10,14', 5, 2, 1, '10,12'],
  ['sf35', 7, 16, 'Sanni Esimerkki', DEMO_ORG_ESPO, '11,33', 13, 6, 1, '10,87'],
];

DEMO_CUP_FINAL_EVENTS.f2 = {
  Name: 'T13 60m aidat',
  Group: 'T13',
  EventCategory: 'Track',
  EventSubCategory: 'Hurdles',
  EventType: { Length: 60, Category: 'Track', SubCategory: 'Hurdles', TeamSize: 1, Name: '60m aidat' },
  Enrollments: DEMO_CUP_FINAL_HURDLES.map(([id, , bib, name, org, , , , , pb]) =>
    demoEnrollment(id, bib, name, org, { sb: pb, pb }),
  ),
  Rounds: [
    demoRound(
      'fr2',
      'Loppukilpailu',
      0,
      demoTs(11, 10),
      [2, 1].map((idx) =>
        demoHeat(
          idx,
          DEMO_CUP_FINAL_HURDLES.filter((row) => row[8] === idx).map(
            ([id, lane, bib, name, org, result, rank, heatRank, , pb]) =>
              demoRunner(id, lane, bib, name, org.name, org.short, { result, rank, heatRank, sb: pb, pb }),
          ),
          idx === 2 ? '-3,8' : '-3,4',
        ),
      ),
    ),
  ],
};

// Each club fields two teams of sixteen legs. Testilän Kisa and Demon
// Urheilijat tie on points, and the relay puts the first ahead where a sort by
// name would not (docs/tuloslista-api.md, "The finals").
// [org, team, lane, bib, result, rank, heatRank, heat]
const DEMO_CUP_FINAL_SHUTTLE = [
  [DEMO_ORG_PIPY, 1, 1, 13, '2.19,3h', 12, 8, 2],
  [DEMO_ORG_KOKI, 1, 2, 11, '2.16,9h', 6, 6, 2],
  [DEMO_ORG_NAVA, 1, 3, 7, '2.15,9h', 5, 5, 2],
  [DEMO_ORG_MALV, 1, 4, 5, '2.13,3h', 4, 4, 2],
  [DEMO_ORG_DEMU, 1, 5, 1, '2.13,0h', 3, 3, 2],
  [DEMO_ORG_TEKI, 1, 6, 3, '2.11,5h', 1, 1, 2],
  [DEMO_ORG_HARJ, 1, 7, 9, '2.12,9h', 2, 2, 2],
  [DEMO_ORG_ESPO, 1, 8, 15, '2.18,2h', 9, 7, 2],
  [DEMO_ORG_PIPY, 2, 1, 14, '2.29,8h', 16, 8, 1],
  [DEMO_ORG_KOKI, 2, 2, 12, '2.26,5h', 15, 7, 1],
  [DEMO_ORG_NAVA, 2, 3, 8, '2.19,0h', 11, 4, 1],
  [DEMO_ORG_MALV, 2, 4, 6, '2.18,3h', 10, 3, 1],
  [DEMO_ORG_DEMU, 2, 5, 2, '2.17,4h', 7, 1, 1],
  [DEMO_ORG_TEKI, 2, 6, 4, '2.17,6h', 8, 2, 1],
  [DEMO_ORG_HARJ, 2, 7, 10, '2.20,3h', 13, 5, 1],
  [DEMO_ORG_ESPO, 2, 8, 16, '2.26,2h', 14, 6, 1],
];
const DEMO_CUP_FINAL_FIRST = ['Aada', 'Eetu', 'Helmi', 'Ilmari', 'Kaisla', 'Lenni', 'Minea', 'Oiva'];
const DEMO_CUP_FINAL_TEAMS = DEMO_CUP_FINAL_SHUTTLE.map(([org, team, lane, bib]) =>
  lapTeam(
    `sft${org.id}-${team}`,
    `${org.name} ${team}`,
    org,
    lane,
    bib,
    Array.from({ length: 16 }, (_, i) => [DEMO_CUP_FINAL_FIRST[i % 8], `${org.short}${team}-${i + 1}`]),
  ),
);

DEMO_CUP_FINAL_EVENTS.f3 = {
  Name: 'Sukkulaviesti 16x60m',
  Group: 'M',
  EventCategory: 'Relay',
  EventSubCategory: 'Sprint',
  EventType: { Length: 60, Category: 'Relay', SubCategory: 'Sprint', TeamSize: 16, Name: '16x60m viesti' },
  Enrollments: DEMO_CUP_FINAL_TEAMS.map(demoTeamEnrollment),
  Rounds: [
    demoRound(
      'fr3',
      'Loppukilpailu',
      0,
      demoTs(14, 45),
      [2, 1].map((idx) =>
        demoHeat(
          idx,
          DEMO_CUP_FINAL_SHUTTLE.map((row, i) => [row, DEMO_CUP_FINAL_TEAMS[i]])
            .filter(([row]) => row[7] === idx)
            .map(([[, , lane, bib, result, rank, heatRank], t]) => ({
              ...demoTeam(t, lane, bib, 16, { result, rank }),
              HeatRank: heatRank,
            })),
        ),
      ),
    ),
  ],
};

for (const event of Object.values(DEMO_CUP_FINAL_EVENTS)) {
  event.Enrollments = event.Enrollments.map((e) => ({ ...e, Confirmed: false }));
}

// The fixture for t4rGraft (lib/elsewhere.js) is an adults' SM meet as
// Tuloslista has it, with entries and nothing drawn. Beside it are the same
// meet's result pages from the other site, already parsed (docs/elsewhere.md).
const DEMO_SM_PEOPLE = {
  m1: ['Aarne Demoinen', DEMO_ORG_DEMU],
  m2: ['Eino Mallinen', DEMO_ORG_MALV],
  m3: ['Ilmo Kisanen', DEMO_ORG_TEKI],
  m4: ['Oiva Näyteinen', DEMO_ORG_NAVA],
  m5: ['Urho Esimerkki', DEMO_ORG_ESPO],
  m6: ['Yrjö Kokeilu', DEMO_ORG_KOKI],
  m7: ['Armas Demoinen', DEMO_ORG_DEMU],
  m8: ['Arvo Demoinen', DEMO_ORG_DEMU],
  n1: ['Aili Demoinen', DEMO_ORG_DEMU],
  n2: ['Elli Mallinen', DEMO_ORG_MALV],
  n3: ['Inka Kisanen', DEMO_ORG_TEKI],
  n4: ['Oona Näyteinen', DEMO_ORG_NAVA],
  n5: ['Ulla Esimerkki', DEMO_ORG_ESPO],
  n6: ['Ylva Kokeilu', DEMO_ORG_KOKI],
  n7: ['Aili Mallinen', DEMO_ORG_MALV],
};
const DEMO_SM_HEPTA = ['100m aidat', 'Korkeus', 'Kuula', '200m', 'Pituus', 'Keihäs', '800m'];
// The meet's two days are a Saturday and the Sunday after it. The other site
// names a day's directory after its weekday, and its last day is the front
// page (t4rDays, lib/elsewhere.js). A start's `when` and a page's are
// "<directory><clock>", with the clock that the site's index gives.
const DEMO_SM_DAYS = { 'la/': '8.8.2026', '': '9.8.2026' };
const demoSmWhen = (when) => /^([a-z]+\/)?(\d\d:\d\d)$/.exec(when).slice(1);
const demoSmDay = (when) => DEMO_SM_DAYS[demoSmWhen(when)[0] ?? ''];
const demoSmTs = (when) => {
  const [d, m, y] = demoSmDay(when).split('.');
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${demoSmWhen(when)[1]}:00.0000000+03:00`;
};
// A field event's kind says how the other site's attempt columns read
// (t4rAttempts, lib/elsewhere.js).
const DEMO_SM_FIELD = { Korkeus: 'VerticalJump', Pituus: 'HorizontalJump', Kuula: 'Throw', Keihäs: 'Throw' };
const demoSmEventType = (kind) =>
  DEMO_SM_FIELD[kind]
    ? { Category: 'Field', SubCategory: DEMO_SM_FIELD[kind], TeamSize: 1 }
    : { Category: kind, TeamSize: kind === 'Relay' ? 4 : 1 };
// [eventId, event, round, kind, entries, when]. The meet's row is the event's
// first page, and a multi-event's legs carry its start (t4rEventGraft).
const DEMO_SM_LIST = [
  // The final is on the next day, and the meet has no row for it.
  ['s1', 'M 400m', 'Alkuerät', 'Track', ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'], 'la/11:20'],
  // One jumper is entered under a new surname, and a clubmate of theirs does
  // not jump.
  ['s2', 'M Pituus', 'Loppukilpailu', 'Pituus', ['m1', 'm2', 'm3', 'm4', 'm7', 'm8'], 'la/12:00'],
  // A hurdler on the page is not entered. A clubmate who runs has the same
  // first name, and so has another club's entry who does not. The site has no
  // page of the heats that are the meet's row, so the final takes the row.
  ['s3', 'N 100m aidat', 'Alkuerät', 'Track', ['n1', 'n2', 'n3', 'n4', 'n7'], 'la/11:40'],
  // The winner on the result page is not entered in any event of the meet.
  ['s4', 'M 3000m esteet', 'Loppukilpailu', 'Track', ['m4', 'm5', 'm6'], 'la/13:00'],
  ['s5', 'N 200m', 'Alkuerät', 'Track', ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'], '11:20'],
  // A wheelchair race's result page prints a class after each name.
  ['s6', 'M 100m kelaus', 'Loppukilpailu', 'Track', ['m5', 'm6'], '11:40'],
  // A relay has no entries. Its result page has each team and its runners.
  ['s7', 'M 4x200m viesti', 'Loppukilpailu', 'Relay', [], '12:00'],
  ...DEMO_SM_HEPTA.map((leg, i) => [
    `s${10 + i}`,
    `N 7-ottelu  ${leg}`,
    'Loppukilpailu',
    /\d/.test(leg) ? 'Track' : leg,
    ['n3', 'n4', 'n5', 'n6'],
    'la/11:00',
  ]),
];
const DEMO_SM_STARTS = DEMO_SM_LIST.map(([eventId, event, round, kind, , when]) => ({
  eventId,
  roundId: `r${eventId}`,
  event,
  round,
  category: demoSmEventType(kind).Category,
  status: 'Unallocated',
  day: demoSmDay(when),
  ts: demoSmTs(when),
}));
const demoSmEntries = (ids) => ids.map((id) => demoEnrollment(id, null, ...DEMO_SM_PEOPLE[id]));
const DEMO_SM_EVENTS = Object.fromEntries(
  DEMO_SM_LIST.map(([eventId, event, round, kind, ids, when]) => [
    eventId,
    {
      Id: eventId,
      Name: event,
      EventCategory: demoSmEventType(kind).Category,
      EventType: demoSmEventType(kind),
      ...(event.includes('ottelu') ? { IsCombinedEvent: true, RootId: 's20', RootName: 'N 7-ottelu' } : {}),
      Enrollments: demoSmEntries(ids),
      Rounds: [demoRound(`r${eventId}`, round, 0, demoSmTs(when), [], {}, 'Unallocated')],
    },
  ]),
);
// A leg's Index is the contest order. The root carries every leg whole in
// SubEvents, as empty as the leg's own document (docs/tuloslista-api.md, "An
// adults' SM whose results are on another site").
DEMO_SM_HEPTA.forEach((leg, i) => {
  DEMO_SM_EVENTS[`s${10 + i}`].Index = i;
});
DEMO_SM_EVENTS.s20 = {
  Id: 's20',
  Name: 'N 7-ottelu',
  EventCategory: 'Combined',
  EventType: { Category: 'Combined' },
  IsCombinedEvent: true,
  RootId: 0,
  RootName: null,
  Enrollments: demoSmEntries(['n3', 'n4', 'n5', 'n6']),
  Rounds: [demoRound('rs20', 'Loppukilpailu', 0, demoSmTs('la/11:00'), [demoHeat(0, [])], {}, 'Unallocated')],
  SubEvents: DEMO_SM_HEPTA.map((leg, i) => ({ ...DEMO_SM_EVENTS[`s${10 + i}`] })),
};

// [event, round, when, the attempt columns' heads, then one list per heat], in
// the day indexes' order. A heat starts with its wind where it has one. A row
// is "place name result", then the result's wind after a "~", then " / " and
// a cell per attempt column. A cell's lines are "~" apart and "." is empty. A
// "Q" or "q" after the result marks a row that went through, and "800p" a
// multi-event leg's points. A relay's row adds " | " and its runners. A
// vertical jump's heads are its bars, and a head of two is a column the page
// wrapped. DEMO_SM_CLUBS gives each row its club, and the page spells one club
// its own way (docs/elsewhere.md).
const DEMO_SM_CLUBS = new Map(
  [
    ...Object.values(DEMO_SM_PEOPLE),
    ['Veli Vierailija', DEMO_ORG_DEMU],
    ['Eino Mallinén', DEMO_ORG_MALV],
    ['Armas Entinen', DEMO_ORG_DEMU],
    ['Aili Vierailija', DEMO_ORG_DEMU],
    ...[DEMO_ORG_TEKI, DEMO_ORG_MALV, DEMO_ORG_NAVA].map((org) => [org.name, org]),
    ['DU-yleisurheilu', { name: 'DU-yleisurheilu' }],
  ].map(([name, org]) => [name, org.name]),
);
const demoSmCell = (cell) => (cell === '.' ? [] : cell.split('~'));
const demoSmRow = (row) => {
  const [line, runners] = row.split(' | ');
  const [place, ...name] = line.split(' / ')[0].split(' ');
  const points = /^\d+p$/.test(name[name.length - 1]) ? Number(name.pop().slice(0, -1)) : null;
  const qual = /^[Qq]$/.test(name[name.length - 1]) ? name.pop() : '';
  const [result, wind] = name.pop().split('~');
  return {
    place,
    name: name.join(' '),
    club: DEMO_SM_CLUBS.get(name.filter((w) => !/^(?:T\d\d|\d)$/.test(w)).join(' ')) || '',
    result,
    wind: wind || null,
    qual,
    points,
    attempts: (line.split(' / ')[1] || '').split(' ').filter(Boolean).map(demoSmCell),
    ...(runners ? { runners: runners.split(', ') } : {}),
  };
};
const demoSmPage = ([event, round, when, heads, ...heats]) => ({
  event,
  round,
  heats: heats.map((rows) => ({
    wind: /^[+-]/.test(rows[0]) ? rows[0] : null,
    heads: heads ? heads.split(' ').map(demoSmCell) : [],
    rows: rows.filter((row) => !/^[+-]/.test(row)).map(demoSmRow),
  })),
  time: demoSmWhen(when)[1],
  dir: demoSmWhen(when)[0] ?? '',
});
const DEMO_SM_PAGES = [
  // Two of each heat go through, the winners as Q and the two fastest others as q.
  [
    'M 400 m',
    'Alkuerät',
    'la/11:20',
    '',
    ['1 Eino Mallinen 48,04 Q', '2 Aarne Demoinen 48,06 q', '3 Urho Esimerkki 48,99'],
    ['1 Ilmo Kisanen 46,99 Q', '2 Oiva Näyteinen 47,85 q', '3 Yrjö Kokeilu 48,59'],
  ],
  ['N masters 100 m', '', 'la/11:30', '', ['+0,9', '1 Aili Demoinen 13,20', '2 Elli Mallinen 13,41']],
  // The page writes an accent that the entry lacks, and it has the last
  // jumper's earlier surname. A jumper's wind is the best attempt's, and the
  // one who stopped early has empty cells.
  [
    'M Pituus',
    '',
    'la/12:00',
    '1 2 3',
    [
      '1 Ilmo Kisanen 7,84~+0,3 / 7,60~+1,1 7,84~+0,3 X~-0,2',
      '2 Aarne Demoinen 7,82~0,0 / 7,82~0,0 X~+0,4 7,71~+0,8',
      '3 Oiva Näyteinen 7,76~+1,2 / X~+0,9 7,76~+1,2 7,70~+0,5',
      '4 Eino Mallinén 7,40~+0,6 / 7,40~+0,6 7,38~+0,2 X~+0,7',
      '5 Armas Entinen 7,10~+0,4 / 7,10~+0,4 . .',
    ],
  ],
  ['Esiurheilija M Pituus', '', 'la/12:20', '1 2 3', ['1 Urho Esimerkki 5,12~+0,2 / 5,12~+0,2 X~+0,3 4,98~+0,1']],
  [
    'N 100 m aj',
    'Loppukilpailu',
    'la/12:40',
    '',
    [
      '+1,4',
      '1 Elli Mallinen 13,05',
      '2 Aili Demoinen 13,11',
      '3 Oona Näyteinen 13,38',
      '4 Aili Vierailija 13,90',
      ' Inka Kisanen DNF',
    ],
  ],
  [
    'M 3000 m ej',
    '',
    'la/13:00',
    '',
    ['1 Veli Vierailija 8.47,79', '2 Yrjö Kokeilu 8.51,09', '3 Oiva Näyteinen 8.56,88', '4 Urho Esimerkki 9.16,96'],
  ],
  // A multi-event has a standings page for each day. The last one is final.
  [
    'N  7-ottelu',
    '',
    'la/19:00',
    '',
    ['1 Oona Näyteinen 3301', '2 Inka Kisanen 3250', '3 Ulla Esimerkki 3107', '4 Ylva Kokeilu 2988'],
  ],
  // The final of the first day's heats is on the next day, at an earlier clock.
  [
    'M 400 m',
    'Loppukilpailu',
    '11:00',
    '',
    ['1 Aarne Demoinen 46,34', '2 Ilmo Kisanen 46,63', '3 Eino Mallinen 47,18', '4 Oiva Näyteinen 47,33'],
  ],
  // A final runs in two heats, each placed from 1 with its own wind. The
  // winner is in the first.
  [
    'N 200 m',
    'Loppukilpailu',
    '11:20',
    '',
    ['+1,2', '1 Ulla Esimerkki 23,14', '2 Ylva Kokeilu 24,30', '3 Aili Demoinen 24,81'],
    ['-0,4', '1 Inka Kisanen 23,78', '2 Elli Mallinen 23,83', '3 Oona Näyteinen 24,72'],
  ],
  ['M 100 m kelaus', '', '11:40', '', ['1 Urho Esimerkki T54 15,02', '2 Yrjö Kokeilu T54 15,40']],
  [
    'M 4 x 200 m',
    'Loppukilpailu',
    '12:00',
    '',
    [
      '1 Testilän Kisa 1 1.29,70 | Ilmo Kisanen, Ilpo Kisanen, Ismo Kisanen, Iivo Kisanen',
      '2 Mallikylän Vire 1.31,84 | Eino Mallinen, Eero Mallinen, Elmo Mallinen, Esa Mallinen',
    ],
    [
      '1 DU-yleisurheilu 1.29,32 | Arvo Demoinen, Aarne Demoinen, Aatu Demoinen, Aki Demoinen',
      '2 Näyteniemen Vauhti 1.30,50 | Oiva Näyteinen, Olli Näyteinen, Onni Näyteinen, Otto Näyteinen',
    ],
  ],
  // A throw's attempts include a pass.
  [
    'N  7-ottelu Kuula',
    '',
    '12:20',
    '1 2 3',
    [
      '1 Inka Kisanen 12,80 715p / 12,80 X 12,64',
      '2 Oona Näyteinen 12,41 690p / 11,98 12,41 -',
      '3 Ulla Esimerkki 11,76 648p / 11,76 X X',
      '4 Ylva Kokeilu 11,20 613p / 10,94 11,20 11,05',
    ],
  ],
  // A vertical jump's heads are the bars, and the page has wrapped the last
  // two under the first two. The winner came in over the first two bars, so
  // her first cells have nothing on their first line.
  [
    'N  7-ottelu Korkeus',
    '',
    '12:40',
    '155~173 160~176 165 168 170',
    [
      '1 Oona Näyteinen 173 891p / ~O ~XXX O XO XO',
      '2 Inka Kisanen 168 830p / O~- XO~- O O XXX',
      '3 Ylva Kokeilu 165 795p / O~- XXO~- XXO XXX .',
      '4 Ulla Esimerkki 160 736p / XO~- O~- XXX . .',
    ],
  ],
  ...DEMO_SM_HEPTA.filter((leg) => !/Kuula|Korkeus/.test(leg)).map((leg, i) => [
    `N  7-ottelu ${leg.replace(/(\d+)m/, '$1 m').replace('aidat', 'aj')}`,
    '',
    `1${3 + i}:00`,
    '',
    ['n3', 'n4', 'n5', 'n6'].map(
      (id, k) => `${k + 1} ${DEMO_SM_PEOPLE[id][0]} ${/\d/.test(leg) ? 14 + k : 9 - k},${10 + i} ${800 - 100 * k}p`,
    ),
  ]),
  // Each total is the sum of that athlete's seven legs.
  [
    'N  7-ottelu',
    '',
    '18:00',
    '',
    ['1 Inka Kisanen 5545', '2 Oona Näyteinen 5081', '3 Ulla Esimerkki 4384', '4 Ylva Kokeilu 3908'],
  ],
].map(demoSmPage);

// The same pages as the other site serves them, keyed by the path under the
// meet's directory (docs/elsewhere.md).
const demoSmCellHtml = (lines) => `<td class="drr">${lines.join('<br>')}</td>`;
// A long relay's page writes each leg's split after the runner, in seconds or
// in minutes, and a split's comma cuts its fraction into the next item
// (docs/elsewhere.md). The demo's relay has both forms, which t4rResultPage
// has to drop to give DEMO_SM_PAGES' runners back.
const DEMO_SM_SPLITS = ['22,40', '1.02,10', '23,90', '1.03,44'];
const demoSmSplit = (runner, i) => `${runner} ${DEMO_SM_SPLITS[i % DEMO_SM_SPLITS.length]}`;
// A multi-event leg's points sit in an unheaded column before the attempt
// columns, or last where there are none. A page without them has another
// unheaded cell of digits and a comma, and only a cell of digits alone scores
// (docs/elsewhere.md).
const demoSmHeatHtml = ({ wind, heads, rows }, i) => {
  const scored = rows.some((r) => r.points != null);
  const blank = '<th width="46px"></th>';
  return `<table><tr><td width="50%">Erä ${i + 1}</td><td width="25%">${wind ? `Tuuli: ${wind}` : ''}</td><td width="25%"></td></tr></table>
<table class="tblRes"><thead><tr><th>Sija</th><th>Nimi / Seura</th><th>Tulos</th><th><!-- record --></th><th width="11px"></th>${scored ? blank : ''}${heads.map((h) => `<th width="37px">${h.join('<br>')}</th>`).join('')}${scored && !heads.length ? blank : ''}</tr></thead>
${rows
  .map(
    (r) => `<tr>
  <td class="drr">${r.place}</td>
  <td class="dr">${r.name} <br>${r.club}</td>
  <td class="drr"><b>${r.result}${r.wind ? `<br>${r.wind}` : ''}</b></td>
  <td class="dr"></td>
  <td class="dr">${r.qual}</td>
  ${scored ? `<td class="drr">${heads.length ? r.points : '0,192'}</td>` : ''}
  ${r.attempts.map(demoSmCellHtml).join('')}
  ${scored && !heads.length ? `<td class="drr">${r.points}</td>` : ''}
</tr>${r.runners ? `<tr><td></td><td colspan="3" class="dr">${r.runners.map(demoSmSplit).join(' , ')} </td><td></td></tr>` : ''}`,
  )
  .join('\n')}</table>`;
};
const demoSmPageHtml = ({ event, round, heats }) => `<div id="header"><h1>${event}</h1></div>
<table width="100%"><tr><td style="text-align: center"><h2>${round || ' '}</h2></td></tr></TABLE>
${heats.map(demoSmHeatHtml).join('\n')}
${
  /\./.test(heats[0].rows[0].result)
    ? `<table class="tblRes"><caption>Väliajat</caption>
<tr><th>Matka</th><th>Aika</th><th>Nimi</th>
<tr><td class="drr">1000m</td><td class="drr">2.58,70</td><td class="dr">${heats[0].rows[0].name} </td></tr></table>`
    : ''
}`;
const demoSmIndexHtml = (pages, dir) => `<table>
<!--<tr><td class=""><a href="./to/">Torstain tuloksiin</a></td></tr> -->
${[...new Set(dir ? [] : pages.map((p) => p.dir).filter(Boolean))].map((day) => `<td class=""><a href="./${day}">Lauantain tuloksiin</a></td>`).join('')}</table>
<table><thead><tr><th>AIKA</th><th>LAJI</th><th></th><th>LÄHTÖLISTA</th><th>TULOKSET</th></tr></thead>
${pages
  .map((p, i) => [p, i])
  .filter(([p]) => p.dir === dir)
  .map(
    ([p, i]) => `<tr>
  <td width="80px" class="TDA">${p.time}</TD>
  <td class="TDA">${p.event}</TD>
  <td class="TDA">${p.round || ' '}</TD>
  <TD class="TDA" width="80"><input type="image" src="g.jpg" onclick="javascript:showEvent('${i + 1}-1-sl.html')"></TD>
  <td class="TDA" width="80"><input type="image" src="g.jpg" onclick="javascript:showEvent('${i + 1}-1-r.html')"> <input type="image" src="pdficon_small.gif" onclick="javascript:showEvent('${i + 1}-1-r.pdf')"></TD>
</TR>`,
  )
  .join('\n')}</table>`;
// A start list's row over each heat gives the round's rule for going through
// (docs/elsewhere.md).
const demoSmStartHtml = ({ heats, time }, rule) =>
  heats
    .map(
      (h, i) => `<center><table width="550px" border="0">
<tr><td width="250px">Erä ${i + 1}/${heats.length}<br>Jatkoonpääsy: ${rule}</td></td><td width="250px" style="font-size: 9pt; font-weight: bold">${time}</td></tr>
</table></center>`,
    )
    .join('\n');
const DEMO_SM_SITE = {
  '': demoSmIndexHtml(DEMO_SM_PAGES, ''),
  'la/': demoSmIndexHtml(DEMO_SM_PAGES, 'la/'),
  ...Object.fromEntries(DEMO_SM_PAGES.map((p, i) => [`${p.dir}${i + 1}-1-r.html`, demoSmPageHtml(p)])),
  'la/1-1-sl.html': demoSmStartHtml(DEMO_SM_PAGES[0], '1 parasta (Q) + 2 ajalla (q)'),
};

// The fixture for olAloneMeet (lib/elsewhere.js) is a road championship's row of
// elsewhere.json and the mass race's files, as docs/elsewhere.md measures them.
const DEMO_ROAD_ROW = {
  id: 'maraton-2026',
  name: 'SM-maraton',
  location: 'Demola',
  date: '2026-08-08',
  start: '12:00:00+03:00',
  ol: '2026_demomaraton',
  classes: { 'M Maraton': 5, 'N Maraton': 6, 'M40 Maraton': 7 },
};
// [club, name, class id, finish in tenths of a second or a status]
const DEMO_ROAD_LIST = [
  ['Testilän Kisa', 'Ilmo Kisanen', 5, 87000],
  ['Näyteniemen Vauhti', 'Oiva Näyteinen', 5, 'DNF'],
  ['Demon urheilijat', 'Aarne Demoinen', 5, 86000],
  ['Tuntemattoman Juoksijat', 'Onni Outonen', 5, 85000],
  ['Mallikylän Vire', 'Eino Mallinen', 5, 84271],
  ['Mallikylän Vire', 'Elli Mallinen', 6, 96000],
  ['Testilän Kisa', 'Inka Kisanen', 6, 'DNS'],
  ['Demon Urheilijat Demola', 'Aili Demoinen', 6, 95000],
  ['Testilän Kisa', 'Ilpo Kisanen', 7, 99000],
];
const DEMO_ROAD_CLUBS = [...new Set(DEMO_ROAD_LIST.map(([club]) => club))];
const DEMO_ROAD_FILES = {
  event: {
    JsonFileFormats: {
      OLClub: ['ID', 'ClubNameLong', 'ClubNameShort', 'DistrictID'],
      OLIndividualCompetitor: [
        'CompetitorID',
        'ClubID',
        'Nationality',
        'BaseBib',
        'Races',
        'LicenseNumber',
        'WRCode',
        'NameLast',
        'NameFirst',
        'Team',
        'TotalPoints1',
        'TotalPoints2',
        'TotalPoints3',
      ],
      OLIndividualCompetitorRace: [
        'CompetitorID',
        'RaceNo',
        'Status',
        'PenaltyTime',
        'ShootingPenalties',
        'StartTimeReal',
        'Badge1',
        'Badge2',
        'Results',
        'Bib',
        'ClassID',
        'StartTimeTable',
        'RacePoints',
        'RacePoints2',
      ],
    },
  },
  competitors: {
    Clubs: DEMO_ROAD_CLUBS.map((club, i) => [i, club, club, 0]),
    Competitors: DEMO_ROAD_LIST.map(([club, name], i) => [
      i + 1,
      DEMO_ROAD_CLUBS.indexOf(club),
      '',
      i + 1,
      0,
      0,
      '',
      name.split(' ')[1],
      name.split(' ')[0],
      '',
      0,
      0,
      0,
    ]),
  },
  results: Object.fromEntries(
    Object.values(DEMO_ROAD_ROW.classes).map((classId) => [
      classId,
      {
        Results: DEMO_ROAD_LIST.flatMap(([, , cls, finish], i) =>
          cls !== classId
            ? []
            : [
                [
                  i + 1,
                  1,
                  Number.isFinite(finish) ? 'OP' : finish,
                  null,
                  [],
                  432000,
                  i + 1,
                  0,
                  [
                    [0, Number.isFinite(finish) ? finish : null],
                    [2, null],
                  ],
                  i + 1,
                  classId,
                  432000,
                  0,
                  0,
                ],
              ],
        ),
      },
    ]),
  ),
};
// The club index's rows give one club a second record of the same name.
// DEMO_ROAD_SPELLINGS is elsewhere.json's `clubs`, which maps the race's
// spelling of a club to its abbreviation.
const DEMO_ROAD_ORGS = [
  ...[DEMO_ORG_DEMU, DEMO_ORG_MALV, DEMO_ORG_TEKI, DEMO_ORG_NAVA].map((o) => ({
    id: String(o.id),
    name: o.name,
    nameShort: o.short,
  })),
  { id: '902', name: 'Mallikylän Vire', nameShort: 'MalVire' },
];
const DEMO_ROAD_SPELLINGS = { 'Demon Urheilijat Demola': DEMO_ORG_DEMU.short };
// DEMO_ROAD_COMP is the same race as a Tuloslista meet that holds only its
// entries, which olGraft (lib/elsewhere.js) grafts onto. Each class is an
// event with one round of no heats. One finisher is entered nowhere, and one
// event's name has a second space that the row's lacks.
const DEMO_ROAD_COMP = { comp: 90026, ol: DEMO_ROAD_ROW.ol, classes: DEMO_ROAD_ROW.classes };
const DEMO_ROAD_DAY = DEMO_ROAD_ROW.date.split('-').reverse().map(Number).join('.');
const DEMO_ROAD_UNENTERED = 'Onni Outonen';
const DEMO_ROAD_ORG = {
  'Demon urheilijat': DEMO_ORG_DEMU,
  'Demon Urheilijat Demola': DEMO_ORG_DEMU,
  'Mallikylän Vire': DEMO_ORG_MALV,
  'Testilän Kisa': DEMO_ORG_TEKI,
  'Näyteniemen Vauhti': DEMO_ORG_NAVA,
};
const DEMO_ROAD_EVENTS = Object.entries(DEMO_ROAD_COMP.classes).map(([name, classId]) => ({
  eventId: `o${classId}`,
  data: {
    Id: `o${classId}`,
    Name: name.replace('M40 ', 'M40  '),
    EventCategory: 'Track',
    EventType: { Category: 'Track', TeamSize: 1 },
    Enrollments: DEMO_ROAD_LIST.filter(
      ([club, person, cls]) => cls === classId && person !== DEMO_ROAD_UNENTERED && DEMO_ROAD_ORG[club],
    ).map(([club, person], i) => demoEnrollment(`o${classId}-${i}`, null, person, DEMO_ROAD_ORG[club])),
    Rounds: [
      demoRound(
        `ro${classId}`,
        'Loppukilpailu',
        0,
        `${DEMO_ROAD_ROW.date}T${DEMO_ROAD_ROW.start}`,
        [],
        {},
        'Unallocated',
      ),
    ],
  },
}));
const DEMO_ROAD_SCHEDULE = {
  [DEMO_ROAD_DAY]: DEMO_ROAD_EVENTS.map(({ data }) => ({
    Id: data.Rounds[0].Id,
    EventId: data.Id,
    EventName: data.Name,
    Name: 'Loppukilpailu',
    Status: 'Unallocated',
    BeginDateTimeWithTZ: data.Rounds[0].BeginDateTimeWithTZ,
    Category: 'Track',
  })),
};

// Each demo competition sits under the id it answers to, with its starts, the
// events /results serves and the Settings that make its kind of meet. The
// functions below branch on no id, so a competition is one more entry here.
const DEMO_MEETS = {
  [DEMO_ID]: {
    name: DEMO_COMP_NAME,
    starts: DEMO_STARTS,
    events: DEMO_EVENTS,
    // The demo carries SeuraCUPPoints and shows none, as a meet with no Type-3
    // setting does (docs/tuloslista-api.md).
    settings: [
      // The meet runs varmistus. Its Type-1 entry carries 60 minutes and
      // reads "off", as a meet that confirms can, since the entry's presence
      // is read and its value is not (docs/tuloslista-api.md). A gate that
      // reads the value fails e46's check in dev/probe-varmistus.js.
      { Type: 1, Index: 1, IntValue: 60, StringValue: 'off' },
    ],
  },
  [DEMO_CUP_ID]: {
    name: DEMO_CUP_COMP_NAME,
    starts: DEMO_CUP_STARTS,
    events: DEMO_CUP_EVENTS,
    // A Type 3 with a non-zero IntValue makes a club cup (isCupMeet, lib/cup.js).
    // Its StringValue is the live meets' and decides nothing.
    settings: [{ Type: 3, Index: 0, IntValue: 1, StringValue: 'KKFIImport' }],
  },
  [DEMO_CUP_FINAL_ID]: {
    name: DEMO_CUP_FINAL_COMP_NAME,
    starts: DEMO_CUP_FINAL_STARTS,
    events: DEMO_CUP_FINAL_EVENTS,
    // A final's Type 0 carries the winner's points, as all four finals of
    // 2026-08-29 do (cupMode, lib/cup.js).
    settings: [{ Type: 0, Index: 0, IntValue: 17, StringValue: 'KKFIImport' }],
  },
};

// Returns the demo meet a competition id names, or null for a real one.
function demoMeet(compId) {
  return Object.prototype.hasOwnProperty.call(DEMO_MEETS, String(compId)) ? DEMO_MEETS[String(compId)] : null;
}

// Returns a demo meet's events by event id, the key /results is fetched by.
function demoEvents(compId) {
  return demoMeet(compId)?.events || {};
}

// The age has to end the token, so "M 100m" is an adult class.
const DEMO_CLASS_RE = /^(Mixed|[MNPT])\s*(\d+)?(?=\s|$)/;

// Returns a schedule row's Gender and Age off the class its event name starts
// with, as every triple measured in test/hurdles.test.mjs agrees. An adult
// class is Age '0', and a mixed one takes one of two genders
// (docs/tuloslista-api.md, "Relays").
function demoClassFields(event) {
  const [, cls, age] = DEMO_CLASS_RE.exec(event) || [];
  if (!cls) return {};
  return { Gender: 'MP'.includes(cls) ? 'Male' : 'Female', Age: age || '0' };
}

// A start with no day of its own lands on today (demoTs), where the day tabs
// open. A start whose name does not give its row's gender and age carries its
// own.
function demoSchedule(compId = DEMO_ID, starts = demoMeet(compId)?.starts || []) {
  const today = new Date().toLocaleDateString('fi-FI');
  const days = {};
  for (const s of starts) {
    const day = s.day || today;
    days[day] = days[day] || [];
    days[day].push({
      EventId: s.eventId,
      Id: s.roundId,
      EventName: s.event,
      Name: s.round,
      Category: s.category,
      Status: s.status,
      BeginDateTimeWithTZ: s.ts,
      ...demoClassFields(s.event),
      ...(s.gender ? { Gender: s.gender } : {}),
      ...(s.age ? { Age: s.age } : {}),
    });
  }
  return days;
}

// Returns the demo's answer to an API url, or null for any other url.
function demoResponse(url) {
  for (const [compId, meet] of Object.entries(DEMO_MEETS)) {
    if (url.endsWith(`/competition/${compId}/properties`)) {
      return {
        Settings: meet.settings,
        Competition: { Id: compId, Name: meet.name, BeginDate: demoTs(12, 0) },
      };
    }
    if (url.endsWith(`/competition/${compId}`)) return demoSchedule(compId);
    const m = new RegExp(`/results/${compId}/([^/]+)$`).exec(url);
    if (m) return meet.events[m[1]] || { Name: 'Tuntematon', Enrollments: [], Rounds: [] };
  }
  return null;
}

// demoApiBody (lib/demo-api.js) builds a demo meet's /api bodies from these.
const DEMO_API = { DEMO_DISTRICTS, demoEvents, demoMeet, demoResponse, demoSchedule };

// Returns what app/data.js's fetch of `url` answers for a demo meet, the /api
// bodies worker.js serves and Tuloslista's, or null for any other url.
function demoBody(url) {
  return demoApiBody(url, DEMO_API) || demoResponse(url);
}

export {
  DEMO_ID,
  DEMO_COMP_NAME,
  DEMO_EVENTS,
  DEMO_STARTS,
  DEMO_CUP_ID,
  DEMO_CUP_COMP_NAME,
  DEMO_CUP_EVENTS,
  DEMO_DISTRICTS,
  DEMO_CUP_FINAL_ID,
  DEMO_CUP_FINAL_EVENTS,
  DEMO_SM_STARTS,
  DEMO_SM_EVENTS,
  DEMO_SM_PAGES,
  DEMO_SM_SITE,
  DEMO_ROAD_ROW,
  DEMO_ROAD_FILES,
  DEMO_ROAD_ORGS,
  DEMO_ROAD_SPELLINGS,
  DEMO_ROAD_COMP,
  DEMO_ROAD_EVENTS,
  DEMO_ROAD_SCHEDULE,
  DEMO_API,
  demoBody,
  demoLicense,
  demoMeet,
  demoEvents,
  demoSchedule,
  demoResponse,
};
