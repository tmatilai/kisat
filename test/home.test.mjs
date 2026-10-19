// Tests the front page's dates, calendar and scan (docs/home.md).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoEventResults } from './fixtures.mjs';
import {
  dateRange,
  dateSortKey,
  dayDiff,
  defaultDay,
  fiToIsoDay,
  isoDay,
  scheduleDays,
  shiftIsoDay,
} from '../public/lib/dates.js';
import {
  calendarCandidates,
  calendarWindow,
  meetIsRecent,
  meetPlace,
  meetSortValue,
  meetWhen,
  scanHits,
  scanSince,
} from '../public/lib/home.js';
import { scheduleEventOrder } from '../public/lib/digest.js';
import { buildRoster, scheduleEventIds } from '../public/lib/roster.js';
import { DEMO_EVENTS, demoSchedule } from '../public/demo.js';

// --- day helpers ---
test('day helpers', () => {
  assert.equal(dateRange(['7.8.2026', '8.8.2026', '9.8.2026']), '7.8.–9.8.2026');
  assert.equal(dateRange(['7.8.2026']), '7.8.2026');
  assert.equal(defaultDay(['7.8.2026', '8.8.2026', '9.8.2026'], '8.8.2026'), '8.8.2026');
  assert.equal(defaultDay(['7.8.2026', '8.8.2026'], '9.8.2026'), '8.8.2026', 'after the meet: the last day');
  assert.equal(defaultDay(['8.8.2026', '9.8.2026'], '1.8.2026'), '8.8.2026', 'before the meet: the next day');
  assert.equal(dateSortKey('9.8.2026') > dateSortKey('10.7.2026'), true);
});

// --- meetPlace: the venue and the organiser, without the listing's
// placeholder venue (docs/tuloslista-api.md) ---
test('meetPlace', () => {
  assert.equal(meetPlace('Demola', 'Demon Urheilijat'), 'Demola · Demon Urheilijat');
  assert.equal(meetPlace('Kilpailupaikka', 'Demon Urheilijat'), 'Demon Urheilijat', 'placeholder venue is dropped');
  assert.equal(meetPlace('', 'Demon Urheilijat'), 'Demon Urheilijat', 'no venue at all');
  assert.equal(meetPlace('Demola', ''), 'Demola', 'no organizer carried (e.g. an older cache entry)');
  assert.equal(meetPlace('Kilpailupaikka', ''), '', 'nothing real on either side');
  assert.equal(meetPlace(null, undefined), '');
});

// --- meetWhen / meetIsRecent: where a meet sits relative to today
// (docs/home.md) ---
test('meetWhen', () => {
  const today = '2026-08-11';
  const when = (days, date) => meetWhen(days, date, today);

  assert.equal(dayDiff('2026-08-11', '2026-08-04'), 7);
  assert.equal(dayDiff('2026-03-30', '2026-03-29'), 1, 'a DST change is still one day');
  assert.equal(dayDiff('nonsense', today), null);

  // It asserts the whole record, so an added field fails here.
  assert.deepEqual(when(['10.8.2026', '11.8.2026', '12.8.2026'], '2026-08-10'), {
    first: '2026-08-10',
    last: '2026-08-12',
    running: true,
    endedDaysAgo: 0,
  });

  assert.equal(when(['10.8.2026', '12.8.2026'], '2026-08-10').running, false, 'a rest day is not a running day');
  // Without its real days a multi-day meet on its second day reads as past.
  assert.equal(when([], '2026-08-10').running, false);
  assert.equal(when([], '2026-08-10').endedDaysAgo, 1, 'the listing Date is the fallback span');
  assert.equal(
    when(null, '2026-08-11T09:30:00.0000000+00:00').running,
    true,
    'a listing timestamp is read as its own wall-clock day',
  );
  assert.equal(
    when(['4.8.2026'], '2026-08-06').endedDaysAgo,
    7,
    'the real day wins over a listing Date that falls after it (docs/tuloslista-api.md, "`Date` is one day")',
  );
  assert.equal(when([], null), null, 'nothing to go on is not the same as long ago');

  assert.equal(meetIsRecent(when(['4.8.2026'], '2026-08-04')), true, 'a week ago exactly');
  assert.equal(meetIsRecent(when(['3.8.2026'], '2026-08-03')), false, 'eight days');
  assert.equal(
    meetIsRecent(when(['1.8.2026', '9.8.2026'], '2026-08-01')),
    true,
    'a long meet is judged by its last day, not its first',
  );
  assert.equal(meetIsRecent(when(['1.9.2026'], '2026-09-01')), true, 'the future is never old');
  assert.equal(meetIsRecent(null), true, 'an unreadable date is shown, not hidden');

  // An unreadable today gives null, since every field but first and last is
  // computed from it.
  assert.equal(meetWhen(['10.8.2026'], '2026-08-10', 'ei päivä'), null);
});

// --- meetSortValue / scanHits: home's order and its Seuratut section
// (docs/home.md) ---
test('meetSortValue/scanHits', () => {
  const today = '2026-08-11';
  const day = (iso) => Date.parse(`${iso}T00:00:00Z`);
  const value = (days, date) => meetSortValue(meetWhen(days, date, today), today);

  assert.equal(
    value(['9.8.2026', '10.8.2026', '11.8.2026'], '2026-08-09'),
    day(today),
    'a meet in progress sorts as today',
  );
  assert.equal(value([], '2026-08-09'), day('2026-08-09'), 'without its days it sorts at the listing Date');
  assert.equal(value(['5.8.2026', '6.8.2026'], '2026-08-05'), day('2026-08-06'), 'a past meet at its last day');
  assert.equal(value(['12.8.2026', '13.8.2026'], '2026-08-12'), day('2026-08-12'), 'a future meet at its first day');
  assert.equal(meetSortValue(null, today), -Infinity);

  // Meets sort newest first, and meets on one day keep the listing's order.
  // (Break on purpose: return NaN for no date and it stays on top.)
  const listing = [
    { id: 'no date', days: [], date: null },
    { id: 'last week', days: ['4.8.2026', '5.8.2026'], date: '2026-08-04' },
    { id: 'in progress', days: ['9.8.2026', '10.8.2026', '11.8.2026', '12.8.2026'], date: '2026-08-09' },
    { id: 'today', days: ['11.8.2026'], date: '2026-08-11' },
    { id: 'tomorrow', days: [], date: '2026-08-12' },
  ];
  assert.deepEqual(
    listing.sort((a, b) => value(b.days, b.date) - value(a.days, a.date)).map((r) => r.id),
    ['tomorrow', 'in progress', 'today', 'last week', 'no date'],
  );

  // Seuratut keeps the meets with a match, stale or not. A meet not scanned
  // yet is left out, as is one with nobody followed in it.
  // (Break on purpose: keep c.matches == null, and the unscanned meet shows.)
  const line = { name: 'Ville Mallinen', club: 'DemU', events: ['M 100m'], via: 'athlete' };
  const scanOf = (...matches) => ({ comps: matches.map((m, i) => ({ id: i + 1, matches: m })), pending: [] });
  const shown = (scan) => scanHits(scan, today).map((c) => c.id);
  assert.deepEqual(shown(scanOf([line], [], null)), [1]);
  const stale = scanOf([line], [line]);
  stale.comps[1].stale = true;
  assert.deepEqual(shown(stale), [1, 2], 'a stale match stays');
  assert.deepEqual(shown(scanOf([], null)), []);
  assert.deepEqual(shown(null), [], 'a failed scan has no hits');
  // Seuratut sorts newest first, as Kilpailut does, where the scan answers by
  // first day. (Break on purpose: drop the sort from scanHits.)
  const byDay = scanOf([line], [line], [line]);
  [['5.8.2026'], ['10.8.2026', '11.8.2026', '12.8.2026'], ['12.8.2026']].forEach((d, i) => {
    byDay.comps[i].days = d;
  });
  assert.deepEqual(shown(byDay), [3, 2, 1], 'tomorrow, in progress, last week');

  // The heading writes the window's first day without its year.
  assert.equal(scanSince({ from: '2026-09-05' }), '5.9.');
  assert.equal(scanSince({ from: '2026-12-24' }), '24.12.');
  assert.equal(scanSince({}), '', 'a scan with no window says nothing');
});

// --- scheduleEventIds/buildRoster: the roster worker.js builds, over the demo
// fixture. The rounds of e3, e9 and e10 are schedule rows of their own under
// one EventId each, and the roster fetches each EventId once ---
test('scheduleEventIds/buildRoster', () => {
  const schedule = demoSchedule();
  const eventIds = scheduleEventIds(schedule);
  assert.equal(
    eventIds.length,
    53,
    '57 schedule rows, e3/e9/e10 each shared by their own rounds -> 53 distinct EventIds',
  );
  // No multi-event root is among them. A root is on no day's schedule, so a
  // follower's entry is on the legs (buildDigest collapses them).
  assert.ok(!eventIds.includes('e37'));
  assert.ok(!eventIds.includes('e41'));
  assert.ok(eventIds.includes('e3'));
  assert.ok(eventIds.includes('e9'));
  assert.ok(eventIds.includes('e10'));

  const roster = buildRoster(demoEventResults());
  // The roster reads Enrollments, so an entrant in no heat is on it too. A
  // multi-event athlete is one row, entered in each leg under one athlete id.
  assert.deepEqual(
    roster.organizations.map((o) => o.name).sort(),
    [
      'Demon Urheilijat',
      'Harjoituspiirin Urheilijat',
      'Mallikylän Vire',
      'Testilän Kisa',
      'Näyteniemen Vauhti',
      'Ulkomaalainen Vieras',
    ].sort(),
  );
  assert.equal(roster.athletes.length, 246);

  // Every allocation joins an enrollment on its Id, the only way to read its
  // confirmation (docs/tuloslista-api.md). (Break on purpose: give
  // demoTeamEnrollment a suffixed id of its own and every relay fails.)
  for (const [eventId, data] of Object.entries(DEMO_EVENTS)) {
    const entered = new Set((data.Enrollments || []).map((e) => e.Id));
    for (const round of data.Rounds || []) {
      for (const heat of round.Heats || []) {
        for (const alloc of heat.Allocations || []) {
          assert.ok(entered.has(alloc.Id), `${eventId}: allocation ${alloc.Id} (${alloc.Name}) joins no enrollment`);
        }
      }
    }
  }

  // Athletes[].Id keys the roster (buildRoster), so one id on two people drops
  // the second silently. (Break on purpose: give a second enrollment an id
  // already used in the file.)
  const nameById = new Map();
  for (const [eventId, data] of Object.entries(DEMO_EVENTS)) {
    for (const enr of data.Enrollments || []) {
      for (const ath of enr.Athletes || []) {
        if (ath?.Id == null) continue;
        const name = [ath.Firstname, ath.Surname].filter(Boolean).join(' ');
        const seen = nameById.get(ath.Id);
        assert.ok(
          seen == null || seen === name,
          `${eventId}: athlete id ${ath.Id} is "${name}" here and "${seen}" elsewhere`,
        );
        nameById.set(ath.Id, name);
      }
    }
  }

  // A relay puts its lineup on the roster, the first N names with N from the
  // event's name and not TeamSize. (Break on purpose: drop relayLineup's slice
  // in buildRoster and e13 counts 15, e15 34.)
  const entrants = (eventId) => roster.athletes.filter((a) => a.events.some((ev) => ev.eventId === eventId));
  assert.equal(entrants('e12').length, 16, '4x800m: four teams of four');
  assert.equal(entrants('e13').length, 12, 'the shuttle: three teams of four, one of them entered with seven');
  assert.equal(entrants('e14').length, 9, 'the mistyped 3x400m: three legs by name, not the four its type claims');
  assert.equal(entrants('e15').length, 33, '3x600m: eleven teams of three, one of them entered with four');
  assert.equal(entrants('e22').length, 12, '4x400m N15: three teams of four, one of them entered with six');
  assert.equal(entrants('e23').length, 8, '4x400m Mixed 15: two teams of four');
  assert.ok(
    entrants('e15').every((a) => a.events.every((ev) => ev.relay && ev.organizationId === a.organizationId)),
    'each recorded against the club that entered the team — which is their own club here, ' +
      "since the guest case is DEMO_RELAY_TEAMS' job",
  );
  const emma = roster.athletes.find((a) => a.name === 'Emma Mittainen');
  assert.equal(emma.events.length, 1);
  assert.equal(emma.events[0].eventId, 'e6');
  assert.equal(emma.events[0].eventName, 'N Keihäs');
  assert.equal(emma.events[0].relay, false);
  assert.equal(emma.events[0].organizationId, 1, "an individual entry is the athlete's own club's");

  // A name past a team's leg count is not in the relay, so this pool name
  // keeps only her individual event. (Break on purpose: drop relayLineup's
  // slice in buildRoster and this fails too.)
  const nea = roster.athletes.find((a) => a.name === 'Nea Merkkinen');
  assert.deepEqual(
    nea.events.map((ev) => ev.eventId),
    ['e6'],
  );
  // This lists every entrant outside the six team events above, by name.
  const teamEventIds = new Set(['e12', 'e13', 'e14', 'e15', 'e22', 'e23']);
  const individualNames = roster.athletes
    .filter((a) => a.events.some((ev) => !teamEventIds.has(ev.eventId)))
    .map((a) => a.name);
  assert.deepEqual(
    individualNames.sort(),
    [
      // e1
      'Ville Mallinen',
      'Aleksi Testinen',
      'Kasperi Kokeinen',
      'Guest Runner',
      // e2
      'Onni Harjoitinen',
      'Eetu Näytteinen',
      'Akseli Esimerkkinen',
      // e3
      'Silvia Kokeinen',
      'Katri Testinen',
      'Ronja Merkkinen',
      'Iina Demoinen',
      'Sofia Mittainen',
      'Venla Simulainen',
      // e4
      'Joel Esimerkkinen',
      'Veikko Mittainen',
      'Aada Harjoitinen',
      'Iiro Vierainen',
      'Aatu Vierainen',
      // e5
      'Ville Mallinen',
      'Joonas Testinen',
      'Tuomas Kokeinen',
      'Riku Harjoitinen',
      'Aleksi Näytteinen',
      'Markus Esimerkkinen',
      'Elias Simulainen',
      'Niilo Demoinen',
      // e6
      'Emma Mittainen',
      'Nea Merkkinen',
      // e7
      'Leevi Mittainen',
      'Roope Esimerkkinen',
      // e9
      'Elina Vauhtinen',
      'Sara Testinen',
      'Milla Kokeinen',
      'Nea Harjoitinen',
      'Aino Simulainen',
      'Vilma Esimerkkinen',
      'Ronja Näytteinen',
      'Iida Mittainen',
      // e10
      'Eetu Vauhtinen',
      'Otto Testinen',
      'Aku Kokeinen',
      'Veeti Harjoitinen',
      // e16
      'Anni Vauhtinen',
      'Helmi Testinen',
      'Aada Kokeinen',
      'Siiri Merkkinen',
      'Nella Näytteinen',
      'Pinja Demoinen',
      'Roosa Simulainen',
      'Kerttu Mittainen',
      'Iida Vauhtinen',
      // e17/e18
      'Kalle Testinen',
      'Joona Kokeinen',
      'Tapio Näytteinen',
      'Ilari Simulainen',
      'Aatu Merkkinen',
      'Miska Harjoitinen',
      'Eemil Demoinen',
      'Verneri Mittainen',
      'Kasper Esimerkkinen',
      'Topias Vauhtinen',
      'Valtteri Kokeinen',
      'Niko Simulainen',
      // e20/e21
      'Petri Kokeinen',
      'Kari Testinen',
      'Jarno Näytteinen',
      'Tapani Simulainen',
      'Elmeri Harjoitinen',
      'Jesse Mittainen',
      'Oskari Demoinen',
      // e24/e25
      'Aino Kokeinen',
      'Elsa Testinen',
      'Helmi Näytteinen',
      'Veeti Demoinen',
      'Oiva Mallinen',
      'Lauri Simulainen',
      // e26-e29
      'Vilja Testinen',
      'Eelis Kokeinen',
      'Lotta Näytteinen',
      'Onerva Merkkinen',
      'Aada Demoinen',
      'Peppi Mittainen',
      'Sanni Harjoitinen',
      'Miro Simulainen',
      'Nella Esimerkkinen',
      'Aaro Vauhtinen',
      'Emilia Kokeinen',
      'Venla Mallinen',
      // e30/e31
      'Otso Testinen',
      'Elmo Kokeinen',
      'Sisu Näytteinen',
      'Rasmus Demoinen',
      'Aleksanteri Harjoitinen',
      'Julius Mittainen',
      // e32
      'Emilia Testinen',
      'Helmi Vauhtinen',
      'Aada Mallinen',
      'Venla Kokeinen',
      'Peppi Harjoitinen',
      'Siiri Näytteinen',
      'Ella Demoinen',
      'Alisa Mittainen',
      'Lotta Esimerkkinen',
      'Enni Simulainen',
      'Iiris Kisainen',
      'Nella Testinen',
      'Sofia Mallinen',
      'Vilja Kokeinen',
      'Saara Vauhtinen',
      // e33
      'Hilla Demoinen',
      'Sanni Näytteinen',
      'Veera Testinen',
      'Aava Harjoitinen',
      'Milja Mittainen',
      'Tuuli Simulainen',
      // e34-e36
      'Oona Demoinen',
      'Lyyli Testinen',
      'Minea Mallinen',
      'Fanni Kokeinen',
      'Pihla Harjoitinen',
      'Vieno Näytteinen',
      'Ilona Vierainen',
      // e38-e40
      'Eino Demoinen',
      'Väinö Testinen',
      'Toivo Mallinen',
      'Aarne Kokeinen',
      // e45
      'Sanni Demoinen',
      'Veera Mallinen',
      'Elsa Vireinen',
      'Aada Kisainen',
      // e46
      'Helmi Testilä',
      'Pihla Vauhtinen',
      'Alma Harjoinen',
      // e47-e49
      'Jooa Mallinen',
      'Niilo Testinen',
      'Sami Vauhtinen',
      'Reijo Harjoinen',
      // e54
      'Pentti Harjoinen',
      // e50
      'Minttu Merkkinen',
      'Roni Merkkinen',
      'Selma Näytteinen',
      'Jaakko Näytteinen',
      // e51-e52
      'Sanni Estelinen',
      'Aada Vesinen',
      'Eetu Pukkinen',
      // e53
      'Aada Testinen',
      'Sofia Harjoitinen',
      'Emma Demoinen',
      'Lilja Vauhtinen',
      'Ella Merkkinen',
      'Helmi Mittainen',
      'Aino Esimerkkinen',
      'Venla Simulainen',
      // e56-e58
      'Sofia Demoinen',
      'Iiris Mallinen',
      'Venla Testinen',
    ].sort(),
    'every individual entrant, and nobody entered e8, e11, e19 or e55',
  );

  // Athletes[].Id is minted per enrollment, so a person entered alone and in
  // a relay is two roster rows. buildDigest makes them one line.
  const villeRows = roster.athletes.filter((a) => a.name === 'Ville Mallinen');
  assert.equal(villeRows.length, 2);
  assert.equal(new Set(villeRows.map((a) => a.licenseId)).size, 1, 'one licence');
  assert.equal(new Set(villeRows.map((a) => String(a.id))).size, 2, 'two enrollment ids');
  // Two rows alike in name and club are one person under one licence, or the
  // picker offers two rows nobody can tell apart.
  const licences = new Map();
  for (const a of roster.athletes) {
    const key = `${a.name} · ${a.organizationId}`;
    licences.set(key, (licences.get(key) || new Set()).add(a.licenseId));
  }
  assert.deepEqual(
    [...licences].filter(([, ids]) => ids.size > 1).map(([key]) => key),
    [],
    'no two people share a name and a club',
  );

  // A relay event is recorded against the club that entered the team, not
  // the runner's own (filterEventIds).
  const tuomas = roster.athletes.find((a) => a.name === 'Tuomas Kokeinen');
  assert.equal(tuomas.organizationId, 2, 'his own club');
  assert.deepEqual(tuomas.events, [{ eventId: 'e5', eventName: 'M 4x100m viesti', organizationId: 1, relay: true }]);

  // The same athlete in two EventIds is one roster row with two events.
  const twice = buildRoster([
    { eventId: 'x1', data: DEMO_EVENTS.e6 },
    { eventId: 'x2', data: DEMO_EVENTS.e6 },
  ]);
  const emmaTwice = twice.athletes.find((a) => a.name === 'Emma Mittainen');
  assert.equal(twice.athletes.length, 2, 'still just the two distinct athletes');
  assert.equal(emmaTwice.events.length, 2, 'but now entered in both events');
});

// --- Day maths: isoDay/fiToIsoDay/shiftIsoDay ---
test('isoDay/fiToIsoDay/shiftIsoDay', () => {
  // The day is the timestamp string's first ten characters, not a Date's.
  // (Break on purpose: parse it as a Date and the +03:00 line fails.)
  assert.equal(isoDay('2026-08-07T00:15:00.0000000+00:00'), '2026-08-07');
  assert.equal(isoDay('2026-08-07T10:15:00.0000000+00:00'), '2026-08-07');
  assert.equal(
    isoDay('2026-08-07T00:15:00.0000000+03:00'),
    '2026-08-07',
    'the date as written, though the instant is still the 6th in UTC',
  );
  assert.equal(isoDay(null), '', 'a missing date is not a day, and does not throw');
  assert.equal(isoDay('nope'), '');

  assert.equal(fiToIsoDay('8.8.2026'), '2026-08-08', 'single digits pad, so the keys sort as strings');
  assert.equal(fiToIsoDay('31.12.2026'), '2026-12-31');
  assert.equal(fiToIsoDay(''), '');
  assert.ok(fiToIsoDay('9.8.2026') > fiToIsoDay('31.7.2026'), 'padded keys compare chronologically');

  assert.equal(shiftIsoDay('2026-08-08', -2), '2026-08-06');
  assert.equal(shiftIsoDay('2026-08-08', 2), '2026-08-10');
  assert.equal(shiftIsoDay('2026-03-01', -1), '2026-02-28', 'month and leap-year edges come from Date, not arithmetic');
  assert.equal(shiftIsoDay('2026-01-01', -1), '2025-12-31');
});

// --- scheduleDays/scheduleEventOrder: what the calendar index (L1) reads ---
test('scheduleDays/scheduleEventOrder', () => {
  const schedule = {
    '9.8.2026': [{ EventId: 'e3', BeginDateTimeWithTZ: '2026-08-09T11:00:00.0000000+00:00' }],
    '7.8.2026': [
      { EventId: 'e2', BeginDateTimeWithTZ: '2026-08-07T12:00:00.0000000+00:00' },
      // e3's qualifying round shares the final's EventId, so the event is
      // placed by its first start.
      { EventId: 'e3', BeginDateTimeWithTZ: '2026-08-07T10:00:00.0000000+00:00' },
    ],
  };
  assert.deepEqual(
    scheduleDays(schedule),
    ['7.8.2026', '9.8.2026'],
    'day keys come back ascending, whatever order the object had them in',
  );
  assert.deepEqual(
    scheduleEventOrder(schedule),
    ['e3', 'e2'],
    'e3 leads: its Karsinta at 10:00 beats e2 at 12:00, even though its final is last',
  );
  assert.deepEqual(scheduleDays(null), []);
  assert.deepEqual(scheduleEventOrder(undefined), []);
});

// --- calendarCandidates: which meets get a schedule fetch. The listing's
// Date can fall after the meet's first day (docs/tuloslista-api.md),
// and a multi-day meet can start before the window ---
test('calendarCandidates', () => {
  const comps = [
    { Id: 1, Name: 'Alkaa ikkunassa', Date: '2026-08-08T09:00:00.0000000+00:00' },
    // Its listing Date falls two days after the day it runs.
    { Id: 2, Name: 'Date myöhässä', Date: '2026-08-12T09:00:00.0000000+00:00' },
    // A multi-day meet starts before the window and runs into it.
    { Id: 3, Name: 'Monipäiväinen', Date: '2026-08-05T09:00:00.0000000+00:00' },
    { Id: 4, Name: 'Kaukana menneisyydessä', Date: '2026-07-10T09:00:00.0000000+00:00' },
    { Id: 5, Name: 'Kaukana tulevaisuudessa', Date: '2026-09-01T09:00:00.0000000+00:00' },
    { Id: 6, Name: 'Ei päivää', Date: null },
  ];
  const ids = calendarCandidates(comps, '2026-08-06', '2026-08-10').map((c) => c.Id);
  assert.deepEqual(ids, [1, 2, 3], 'both slack directions pull in a meet a strict window would miss');
  // (Break on purpose: drop the slack and the first assertion loses 2 and 3.)
  assert.deepEqual(
    calendarCandidates(comps, '2026-08-08', '2026-08-08').map((c) => c.Id),
    [1, 3],
    'even a single-day window keeps its slack — this is the wide-erring side',
  );
  assert.deepEqual(
    calendarCandidates(comps, '2026-08-20', '2026-08-24').map((c) => c.Id),
    [],
    'a window nothing reaches is empty, not everything',
  );
  assert.deepEqual(calendarCandidates(null, '2026-08-06', '2026-08-10'), []);
});

// --- calendarWindow: the two sections the front page renders ---
test('calendarWindow', () => {
  const entries = [
    { id: 5, name: 'Myöhempi', days: ['10.8.2026'] },
    { id: 1, name: 'Ikkunassa', days: ['8.8.2026'] },
    { id: 3, name: 'Monipäiväinen', days: ['5.8.2026', '6.8.2026', '7.8.2026'] },
    { id: 4, name: 'Ikkunan ulkopuolella', days: ['31.7.2026'] },
    { id: 6, name: 'Päivät tuntematta', days: [] },
    { id: 2, name: 'Ikkunassa myös', days: ['8.8.2026'] },
  ];
  const { inWindow, others } = calendarWindow(entries, '2026-08-06', '2026-08-10');
  assert.deepEqual(
    inWindow.map((e) => e.id),
    [3, 1, 2, 5],
    'window is chronological by first day, ties broken by name — not the listing order',
  );
  assert.equal(
    inWindow[0].firstDay,
    '2026-08-05',
    'a meet that started before the window keeps its own first day, not the window edge',
  );
  assert.deepEqual(
    others.map((e) => e.id),
    [4, 6],
    "the rest keeps the caller's own order (the listing's), unsorted",
  );
  // A meet with no fetched schedule is never claimed as happening now.
  assert.ok(!inWindow.some((e) => e.id === 6), 'unknown days stay out of the window');
  assert.deepEqual(calendarWindow(null, '2026-08-06', '2026-08-10'), { inWindow: [], others: [] });
});
