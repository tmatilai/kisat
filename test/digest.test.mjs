// Tests a meet's digest of who is in it, which the front page's scan and the
// picker's search read (docs/home.md, docs/backend.md).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoEventResults } from './fixtures.mjs';
import { DIGEST_VERSION, buildDigest, scanDigest, scanEventLabel, scheduleEventOrder } from '../public/lib/digest.js';
import { roundAllocated } from '../public/lib/results.js';
import { buildRoster, drawnEntries, relayTeams } from '../public/lib/roster.js';
import { demoSchedule } from '../public/demo.js';

// --- buildDigest/scanDigest: the front page's match, over the demo roster ---
test('buildDigest/scanDigest', () => {
  const roster = buildRoster(demoEventResults());
  const emma = roster.athletes.find((a) => a.name === 'Emma Mittainen');
  const teams = relayTeams(demoEventResults());
  const digest = buildDigest(roster, ['8.8.2026'], scheduleEventOrder(demoSchedule()), new Map(), teams);

  assert.equal(digest.v, DIGEST_VERSION);
  assert.deepEqual(digest.days, ['8.8.2026']);
  assert.equal(digest.athletes.length, 245, '246 roster rows, and Ville Mallinen is two of them');

  // A club is one team row, holding each relay it has a team in once and in
  // schedule order. (Break on purpose: key the merge on the event as well and
  // a club gets a row per relay.)
  assert.equal(teams.length, 31);
  assert.deepEqual(
    digest.teams.map(([org, name]) => [org, name]),
    [
      [1, 'Demon Urheilijat'],
      [2, 'Mallikylän Vire'],
      [3, 'Testilän Kisa'],
      [4, 'Näyteniemen Vauhti'],
      [6, 'Harjoituspiirin Urheilijat'],
    ],
  );
  assert.deepEqual(digest.teams.find(([org]) => org === 3)[2], [
    'M15 4x800m viesti',
    'P11 4x60m aitaviesti',
    'T11 4x60m aitaviesti',
    'P9 3x400m viesti',
    'T13 3x600m viesti',
    'N15 4x400m viesti',
  ]);

  // A person is one line. An individual entry and a relay entry are two
  // roster rows under one licence (docs/tuloslista-api.md). (Break on
  // purpose: key the merge on a.id and Ville gets two lines.)
  const ville = digest.athletes.filter((a) => a[2] === 'Ville Mallinen');
  assert.equal(ville.length, 1);
  assert.deepEqual(
    ville[0][3],
    ['M 100m', ['M 4x100m viesti', 1]],
    "both his events, in schedule order, the relay still carrying its team's club",
  );
  assert.ok(
    digest.orgs.some(([, name]) => name === 'DemU'),
    "clubs are stored by NameShort, the same string the meet page's athlete lines show",
  );

  // An athlete entry stores a LicenseId, never the per-competition
  // Athletes[].Id. (Break on purpose: store a.id instead of a.licenseId in
  // buildDigest and both assertions swap results.)
  const byLicence = scanDigest(digest, [{ type: 'athlete', id: emma.licenseId, name: 'Emma' }]);
  assert.deepEqual(byLicence, [{ name: 'Emma Mittainen', club: 'DemU', events: ['N Keihäs'], via: 'athlete' }]);
  assert.deepEqual(
    scanDigest(digest, [{ type: 'athlete', id: emma.id, name: 'Emma' }]),
    [],
    'the per-competition athlete id means nothing here',
  );

  // A club entry lists everyone of that club entered individually, with its
  // relays on the club's own line first.
  const demu = scanDigest(digest, [{ type: 'club', id: 1 }]);
  assert.deepEqual(
    demu.map((l) => [l.name, l.via]),
    [
      ['Demon Urheilijat', 'club'],
      ['Aatu Merkkinen', 'club'],
      ['Aino Kokeinen', 'club'],
      ['Aino Simulainen', 'club'],
      ['Anni Vauhtinen', 'club'],
      ['Eetu Vauhtinen', 'club'],
      ['Eino Demoinen', 'club'],
      ['Elina Vauhtinen', 'club'],
      ['Ella Demoinen', 'club'],
      ['Emma Mittainen', 'club'],
      ['Enni Simulainen', 'club'],
      ['Helmi Vauhtinen', 'club'],
      ['Hilla Demoinen', 'club'],
      ['Joel Esimerkkinen', 'club'],
      ['Jooa Mallinen', 'club'],
      ['Kalle Testinen', 'club'],
      ['Leevi Mittainen', 'club'],
      ['Lotta Näytteinen', 'club'],
      ['Miro Simulainen', 'club'],
      ['Onni Harjoitinen', 'club'],
      ['Oona Demoinen', 'club'],
      ['Oskari Demoinen', 'club'],
      ['Petri Kokeinen', 'club'],
      ['Pinja Demoinen', 'club'],
      ['Rasmus Demoinen', 'club'],
      ['Ronja Merkkinen', 'club'],
      ['Sanni Demoinen', 'club'],
      ['Sanni Estelinen', 'club'],
      ['Sofia Demoinen', 'club'],
      ['Topias Vauhtinen', 'club'],
      ['Tuuli Simulainen', 'club'],
      ['Veera Mallinen', 'club'],
      ['Veeti Demoinen', 'club'],
      ['Venla Mallinen', 'club'],
      ['Ville Mallinen', 'club'],
    ],
  );
  assert.deepEqual(demu[0], { name: 'Demon Urheilijat', club: 'DemU', events: ['M 4x100m'], via: 'club' });

  // The club's relay team is on the club's line, so its runners get no line
  // for it. (Break on purpose: let a followed club's relay through to the
  // athlete line and this list grows by three.)
  assert.deepEqual(
    demu.find((l) => l.name === 'Ville Mallinen').events,
    ['M 100m'],
    "the man himself, with the event the club's line does not carry",
  );
  assert.ok(!demu.some((l) => ['Joonas Testinen', 'Riku Harjoitinen'].includes(l.name)));

  // Nor is the guest from another club, whose only entry is DemU's relay.
  // Following him by name puts him back (below).
  assert.ok(!demu.some((l) => l.name === 'Tuomas Kokeinen'));

  // A followed club does not match its athlete's entry in another club's team
  // (docs/tuloslista-api.md). (Break on purpose: drop scanDigest's
  // per-event teamOrg check and Tuomas reappears.)
  const malv = scanDigest(digest, [{ type: 'club', id: 2 }]);
  assert.deepEqual(
    malv.map((l) => l.name),
    [
      'Mallikylän Vire',
      'Aada Demoinen',
      'Aada Mallinen',
      'Aada Vesinen',
      'Aaro Vauhtinen',
      'Alisa Mittainen',
      'Elsa Vireinen',
      'Iida Mittainen',
      'Iiris Mallinen',
      'Ilari Simulainen',
      'Jesse Mittainen',
      'Milja Mittainen',
      'Minea Mallinen',
      'Nea Harjoitinen',
      'Nea Merkkinen',
      'Roope Esimerkkinen',
      'Siiri Merkkinen',
      'Sisu Näytteinen',
      'Sofia Mallinen',
      'Tapani Simulainen',
      'Toivo Mallinen',
      'Veeti Harjoitinen',
      'Verneri Mittainen',
    ],
    "MalV's own team and its own individual entrants — not its athlete in DemU's team",
  );
  assert.ok(!malv.some((l) => l.name === 'Tuomas Kokeinen'));

  // Following a person by name brings their relay, whoever's team it is.
  const tuomasRow = roster.athletes.find((a) => a.name === 'Tuomas Kokeinen');
  assert.deepEqual(scanDigest(digest, [{ type: 'athlete', id: tuomasRow.licenseId }]), [
    { name: 'Tuomas Kokeinen', club: 'MalV', events: ['M 4x100m'], via: 'athlete' },
  ]);

  // A pool name is not in the relay (relayLineup), even when followed by
  // name.
  const neaRow = roster.athletes.find((a) => a.name === 'Nea Merkkinen');
  assert.deepEqual(scanDigest(digest, [{ type: 'athlete', id: neaRow.licenseId }])[0].events, ['N Keihäs']);

  // A person followed by name and by club is one line, the athlete entry's.
  // It sorts above the club's lines, since the row shows only its first ones.
  // (Break on purpose: sort the lines by name alone and she drops below
  // DemU's relay line.)
  const both = scanDigest(digest, [
    { type: 'club', id: 1 },
    { type: 'athlete', id: emma.licenseId },
  ]);
  assert.deepEqual(
    both.filter((l) => l.name === 'Emma Mittainen').map((l) => l.via),
    ['athlete'],
  );
  assert.deepEqual(
    both.slice(0, 2).map((l) => [l.name, l.via]),
    [
      ['Emma Mittainen', 'athlete'],
      ['Demon Urheilijat', 'club'],
    ],
  );
  assert.equal(both.length, 35, "her club's other entries are still there, once each");

  // A followed person's relay for a followed club is on the club's line alone,
  // so Tuomas, whose only entry it is, gets no line.
  const tuomasAndDemu = scanDigest(digest, [
    { type: 'club', id: 1 },
    { type: 'athlete', id: tuomasRow.licenseId },
  ]);
  assert.ok(!tuomasAndDemu.some((l) => l.name === 'Tuomas Kokeinen'));
  assert.deepEqual(tuomasAndDemu[0].events, ['M 4x100m'], 'the club whose team he runs in is on the list');

  assert.deepEqual(scanDigest(digest, [{ type: 'athlete', id: emma.licenseId, enabled: false }]), []);
  assert.deepEqual(
    scanDigest(digest, [{ type: 'athlete', id: '999999' }]),
    [],
    'a follow-list whose people are not entered here is the ordinary case, not an error',
  );
  assert.deepEqual(scanDigest(digest, []), []);
  assert.deepEqual(scanDigest(null, [{ type: 'club', id: 1 }]), []);

  // With both clubs followed the relay lines come first and then the people,
  // each sorted by name and shown with their own club.
  const everyone = scanDigest(digest, [
    { type: 'club', id: 1 },
    { type: 'club', id: 2 },
  ]);
  assert.equal(everyone.length, 58);
  assert.deepEqual(
    everyone.slice(0, 2).map((l) => l.name),
    ['Demon Urheilijat', 'Mallikylän Vire'],
  );
  const people = everyone.slice(2).map((l) => l.name);
  assert.deepEqual(
    people,
    [...people].sort((a, b) => a.localeCompare(b, 'fi')),
  );
  assert.equal(
    everyone.find((l) => l.name === 'Nea Merkkinen').club,
    'MalV',
    "the club shown is the athlete's own, whichever club's entry matched her",
  );

  // A line drops a trailing "viesti" and keeps "aitaviesti". The digest stores the name whole. (Break on purpose:
  // drop the \s+ from the pattern and "aitaviesti" is cut too.)
  assert.deepEqual(
    ['M 4x100m viesti', 'N15 4x80m aitaviesti', 'M 100m', 'Mixed 15 4x400m viesti'].map(scanEventLabel),
    ['M 4x100m', 'N15 4x80m aitaviesti', 'M 100m', 'Mixed 15 4x400m'],
  );
  assert.equal(scanEventLabel('viesti'), 'viesti', 'never left with nothing to print');
  assert.equal(scanEventLabel(null), '');
  assert.equal(
    digest.teams.find(([org]) => org === 1)[2][0],
    'M 4x100m viesti',
    'stored whole; only the line shortens it',
  );

  // Events are stored in running order, not in the roster's order.
  const twoEvents = buildDigest(
    {
      organizations: [{ id: 1, nameShort: 'DemU' }],
      athletes: [
        {
          licenseId: 'L1',
          organizationId: 1,
          name: 'Ville Mallinen',
          events: [
            { eventId: 'e6', eventName: 'M50 Kuula' },
            { eventId: 'e2', eventName: 'M 100m' },
          ],
        },
      ],
    },
    ['8.8.2026'],
    ['e2', 'e6'],
  );
  assert.deepEqual(
    scanDigest(twoEvents, [{ type: 'athlete', id: 'L1' }])[0].events,
    ['M 100m', 'M50 Kuula'],
    'schedule order, not roster fetch order',
  );
});

// --- drawnEntries: a drawn round's entrant in no heat leaves the digest ---
// The demo's N 1500m leaves one entrant out of its drawn final, as a meet
// that draws only those at the track does. (Break on purpose: return every
// event unchanged and she comes back.)
test("drawnEntries: a drawn round's entrant in no heat leaves the digest", () => {
  const order = scheduleEventOrder(demoSchedule());
  const harju = (events) =>
    scanDigest(buildDigest(buildRoster(events), ['8.8.2026'], order, new Map()), [{ type: 'club', id: 6 }]).map(
      (l) => l.name,
    );
  assert.ok(harju(demoEventResults()).includes('Iida Vauhtinen'));
  const drawn = harju(drawnEntries(demoEventResults()));
  assert.ok(!drawn.includes('Iida Vauhtinen'), 'an entrant in no heat is not at the meet');
  assert.ok(drawn.includes('Nella Näytteinen'), 'a drawn entrant stays');

  // An undrawn event keeps all its entries, as its heats are not yet made.
  const undrawn = demoEventResults().filter(({ data }) => !(data.Rounds || []).some(roundAllocated));
  assert.ok(undrawn.length > 0);
  assert.deepEqual(drawnEntries(undrawn), undrawn);
});
