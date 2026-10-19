// Tests districts.json and the medals per piiri (docs/districts.md).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INVENTED_MEMBERS, inventedDistricts } from './fixtures.mjs';
import { DEMO_DISTRICTS } from '../public/demo.js';
import districts from '../public/data/districts.json' with { type: 'json' };
import {
  closedPair,
  coversStart,
  defaultScopes,
  districtProblems,
  meetScopes,
  scopeTree,
} from '../public/lib/districts.js';

// --- districts.json: the piiris' clubs, proof-reading itself ---------------
test("districts.json: the piiris' clubs, proof-reading itself", () => {
  assert.deepEqual(districtProblems(districts), [], `districts.json: ${districtProblems(districts).join('; ')}`);
  assert.deepEqual(districtProblems(DEMO_DISTRICTS), []);
  assert.equal(districts.piirit.length, 21, "the federation's 21 piiris");
  const broken = () => JSON.parse(JSON.stringify(districts));
  // (Break on purpose: a club pasted under a second piiri.)
  {
    const d = broken();
    d.piirit[1].clubs.push(d.piirit[0].clubs[0]);
    assert.deepEqual(districtProblems(d), [`${d.piirit[0].clubs[0]}: in ${d.piirit[0].id} and ${d.piirit[1].id}`]);
  }
  // (Break on purpose: a club's name under a second piiri, spelt its own way.)
  {
    const d = broken();
    const name = d.piirit[0].names[0].toUpperCase();
    d.piirit[1].names.push(name);
    assert.deepEqual(districtProblems(d), [`${name}: in ${d.piirit[0].id} and ${d.piirit[1].id}`]);
  }
  // (Break on purpose: a club under a piiri and outside every piiri too.)
  {
    const d = broken();
    d.outside.names.push(d.piirit[0].names[0]);
    assert.deepEqual(districtProblems(d), [`${d.piirit[0].names[0]}: in ${d.piirit[0].id} and outside`]);
    d.outside = { clubs: 'UlkV' };
    assert.deepEqual(districtProblems(d), ['outside: clubs not a list', 'outside: names not a list']);
  }
  assert.deepEqual(
    districts.alueet.map((a) => a.id),
    ['etelainen', 'lounainen', 'lantinen', 'itainen', 'pohjoinen'],
  );
  assert.deepEqual(
    meetScopes(districts)
      .slice(0, 7)
      .map((s) => s.short),
    [
      'SM',
      'Eteläinen alue',
      'Lounainen alue',
      'Läntinen alue',
      'Itäinen alue',
      'Pohjoinen alue',
      districts.piirit[0].short,
    ],
  );
  assert.equal(
    meetScopes(districts)[0].clubs.length,
    districts.piirit.flatMap((p) => p.clubs).length,
    "the country over every piiri's clubs",
  );
  // (Break on purpose: an alue given the country's id.)
  {
    const d = broken();
    d.alueet[0].id = 'sm';
    d.piirit
      .filter((p) => p.alue === 'etelainen')
      .forEach((p) => {
        p.alue = 'sm';
      });
    assert.deepEqual(districtProblems(d), ["sm: the country's id"]);
  }
  // The championship page lists by name, whatever the file's order.
  const tree = (d) => scopeTree(d).map((t) => [t.alue.name, ...t.piirit.map((p) => p.id)]);
  const shuffled = broken();
  shuffled.alueet.reverse();
  shuffled.piirit.reverse();
  assert.deepEqual(tree(shuffled), tree(districts), "the file's order does not matter");
  assert.deepEqual(
    tree(districts).map((t) => t[0]),
    ['Suomenmestaruus', 'Eteläinen', 'Itäinen', 'Lounainen', 'Läntinen', 'Pohjoinen'],
    'the country first',
  );
  assert.deepEqual(
    tree(districts).map((t) => t.length - 1),
    [0, 6, 3, 4, 4, 4],
    'every piiri under its alue',
  );
  assert.deepEqual(
    scopeTree(districts)[3]
      .piirit.map((p) => p.name)
      .slice(-1),
    ['Ålands Idrottsdistrikt'],
    'Å after Z',
  );
  // (Break on purpose: the ids ignored, or an alue with none of them kept.)
  const some = (ids) => scopeTree(shuffled, ids).map((t) => [t.alue.id, ...t.piirit.map((p) => p.id)]);
  assert.deepEqual(
    some(['saty', 'lounainen', 'etelainen', 'helsy', 'aid']),
    [
      ['etelainen', 'helsy'],
      ['lounainen', 'saty', 'aid'],
    ],
    "a meet's scopes: the same tree, the rest left out",
  );
  assert.deepEqual(some([]), [], 'none');
  // (Break on purpose: an alue given by its name, not its id.)
  {
    const d = broken();
    d.piirit[0].alue = 'Eteläinen';
    assert.deepEqual(districtProblems(d), [`${d.piirit[0].id}: alue "Eteläinen" is not in alueet`]);
  }
  // (Break on purpose: a piiri given an alue's id.)
  {
    const d = broken();
    d.piirit[0].id = 'lounainen';
    assert.deepEqual(districtProblems(d), ["lounainen: an alue's id and a piiri's"]);
  }
  // (Break on purpose: an alue named in a case other than the nominative.)
  {
    const d = broken();
    d.alueet[0].name = 'Eteläisen';
    assert.deepEqual(districtProblems(d), ['etelainen: name "Eteläisen" does not end in "nen"']);
  }
  // (Break on purpose: a trailing space, which NameShort never carries.)
  {
    const d = broken();
    d.piirit[2].clubs[0] += ' ';
    assert.deepEqual(districtProblems(d), [`${d.piirit[2].id}: club ${JSON.stringify(d.piirit[2].clubs[0])}`]);
  }
  assert.deepEqual(
    districtProblems({
      alueet: [{ id: 'a', name: 'Anen' }],
      piirit: [{ id: 'p', name: 'P', short: 'P', alue: 'a', clubs: ['X', 'X'] }],
    }),
    ['p: X twice'],
  );
  assert.deepEqual(districtProblems({ alueet: [], piirit: [] }), ['alueet: not a list']);

  // defaultScopes reads a meet's name and organiser, tested on the listing's
  // names of 2026-09-13. `clubs` gives an invented organiser
  // the abbreviation the rows carry.
  const clubs = Object.fromEntries(Object.values(INVENTED_MEMBERS).flat());
  const off = (name, org = null) => defaultScopes(name, org, inventedDistricts, (club) => clubs[club] || null);
  const ids = (name, org) => off(name, org).map((s) => s.id);
  const cover = (name, org) => off(name, org).map((s) => s.cover);
  const whole = (...list) => list.map((id) => ({ id, cover: null }));
  const from = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  assert.deepEqual(
    off('Helsyn ja NÅID:in junnuhuipentuma 9-13v', 'Mittalan Veikot'),
    whole('helsy', 'naid'),
    '20759: two named, no pm word',
  );
  // A meet whose entries are closed to two piiris is both piiris' (closedPair).
  // (Break on purpose: drop the head count, and 20251's relay
  // is a pair.)
  assert.deepEqual(
    closedPair([
      ['helsy', 70],
      ['naid', 15],
    ]),
    ['helsy', 'naid'],
    '20828',
  );
  assert.deepEqual(
    closedPair([
      ['helsy', 137],
      ['naid', 38],
      ['kymy', 2],
      ['lasy', 1],
      ['uudy', 1],
    ]),
    ['helsy', 'naid'],
    '20840: four guests of 179',
  );
  assert.equal(
    closedPair([
      ['esy', 80],
      ['pokary', 43],
      ['eky', 26],
      ['psy', 5],
      ['kesy', 4],
      ['kepy', 1],
    ]),
    null,
    '18865: an open hall meet, a fifth from outside',
  );
  assert.equal(
    closedPair([
      ['varsy', 122],
      ['saty', 12],
      ['uudy', 2],
      ['naid', 1],
      ['hamsy', 1],
      ['ppyu', 1],
    ]),
    null,
    '18545: nearly closed, the second under its share',
  );
  assert.equal(
    closedPair([
      ['kymy', 5],
      ['lasy', 4],
    ]),
    null,
    "20251: a relay's few clubs are under the head count",
  );
  assert.equal(
    closedPair([
      ['helsy', 70],
      ['naid', 15],
      [null, 6],
    ]),
    null,
    'a club in no piiri is from outside',
  );
  assert.equal(closedPair([['kymy', 62]]), null, '20765: one piiri alone');
  assert.equal(closedPair([]), null);
  const closedTo = (pair) => (name, org) =>
    defaultScopes(
      name,
      org,
      inventedDistricts,
      () => null,
      () => pair,
    ).map((s) => s.id);
  assert.deepEqual(
    closedTo(['helsy', 'naid'])('Helsyn Pm-moniottelut II 12-13v', 'Mittalan Veikot'),
    ['helsy', 'naid'],
    '20828: the partner joins, unnamed',
  );
  assert.deepEqual(
    defaultScopes(
      'Helsyn Pm-moniottelut II 12-13v',
      'Mittalan Veikot',
      inventedDistricts,
      () => null,
      () => ['helsy', 'naid'],
    ).map((s) => s.cover),
    [
      { ages: [12, 13], events: ['moniottelut'] },
      { ages: [12, 13], events: ['moniottelut'] },
    ],
    "under the pm word's cover",
  );
  assert.deepEqual(
    closedTo(['kymy', 'lasy'])('Helsyn Pm-moniottelut II 12-13v', 'Mittalan Veikot'),
    ['helsy'],
    "a pair without the meet's own piiri joins nobody",
  );
  assert.deepEqual(
    closedTo(['helsy', 'naid'])('Avoimet Helsy-hallit 1', 'Helsingin Seudun Yleisurheilu'),
    [],
    'no championship by its name: none by its entries',
  );
  let asked = 0;
  defaultScopes(
    'Kevätkisat',
    'Mittalan Veikot',
    inventedDistricts,
    () => null,
    () => {
      asked += 1;
      return null;
    },
  );
  assert.equal(asked, 0, 'a meet without a piiri scope is not tallied');
  assert.deepEqual(
    off('Avoimet Helsy-hallit 1', 'Helsingin Seudun Yleisurheilu'),
    [],
    '18828: one named, neither word — its medals went to the whole field',
  );
  assert.deepEqual(
    off('Avoimet Helsyn Junnuviestit', 'Helsingin Seudun Yleisurheilu'),
    whole('helsy'),
    "18851: the piiri's junnu meet is its own",
  );
  assert.deepEqual(
    off('Junnuhallit 3', 'Helsingin Seudun Yleisurheilu'),
    whole('helsy'),
    'the piiri itself organising a junnu meet',
  );
  assert.deepEqual(
    off('Junnuhallit 3', 'Helsingin Seudun Yleisurheilu ry'),
    whole('helsy'),
    'written as a club is (clubNameKey). (Break on purpose: compare the names in lower case.)',
  );
  assert.deepEqual(off('MitVe:n junnukisat', 'Mittalan Veikot'), [], "a club's own junnu meet is open");
  assert.deepEqual(
    off('Uudy:n avoimet pm-kilpailut 14-15-v.', 'Kaavakylän Kunto'),
    [{ id: 'uudy', cover: { ages: [14, 15], events: null } }],
    'a suffix after the colon',
  );
  assert.deepEqual(
    off('Kesyn pm-viestit', 'Otosmäen Isku'),
    [{ id: 'kesy', cover: { ages: null, events: ['viestit'] } }],
    'a suffix without one',
  );
  assert.deepEqual(
    off('Avoimet Piirinmestaruuskilpailut 9-17 v, osa 3', 'Koejärven Urheilijat'),
    [{ id: 'eky', cover: { ages: from(9, 17), events: null } }],
    "20401: the organiser's piiri",
  );
  assert.deepEqual(off('Stafett-DM', 'IF Prov'), whole('oid'), 'the Swedish word');
  assert.deepEqual(
    off('pm-kilpailut Avoimet HämSY:n ja SatY:n pm-viestit', 'Arviolan Pyrkijät'),
    whole('hamsy', 'saty'),
    'a word binding nothing is the whole meet',
  );
  assert.deepEqual(
    off('Kyvyt Esiin. Avoimet TUL:n Järvi- Suomen pm', 'Koejärven Urheilijat'),
    [],
    "20751: TUL's pm is no SUL piiri's, whoever organises",
  );
  assert.deepEqual(off('Piirikunnalliset', 'Aihiolan Riento'), [], 'not a championship');
  assert.deepEqual(
    off('Satakunnan 9-15-v piirinmestaruusmoniottelut', 'Luonnoslahden Voima ja Hahmolan Into'),
    [{ id: 'saty', cover: { ages: from(9, 15), events: ['moniottelut'] } }],
    '20774: two organisers of one piiri, the event compounded into the word',
  );
  assert.deepEqual(
    off('Piirinmestaruuskilpailut', 'Luonnoslahden Voima / Mittalan Veikot'),
    [],
    'two organisers of two piiris: none',
  );
  assert.deepEqual(off('Piirinmestaruuskilpailut', 'Nobody'), [], 'an organiser the rows do not name');
  assert.deepEqual(off('Helsylle kiitos', 'Koejärven Urheilijat'), [], 'a short inside a longer word is not the piiri');
  assert.deepEqual(
    ids('Kymenlaakson pm-ottelut T/P 9-13 V., 2. osa', 'Nobody'),
    ['kymy'],
    '18044: the region names the piiri',
  );
  assert.deepEqual(ids('Kymenlaakson ja Lahden pm-viestit 9-15v', 'Nobody'), ['kymy', 'lasy'], '17564');
  assert.deepEqual(ids('Hämeenlinnan pm-kisat', 'Nobody'), [], 'a region inside a longer word is not the piiri');
  // A region word that opens a club's name names the club and no piiri,
  // however the name inflects it. (Break on
  // purpose: drop the regionClub test in namedPiirit.)
  assert.deepEqual(ids('Lapin Luonnoksen pm-viestit', 'Lapin Luonnos'), ['saty'], "a SatY club's, not LY's");
  assert.deepEqual(ids('Helsingin Mitan ja Lahden Aihion seuraottelu', 'Helsingin Mitta'), [], 'two clubs, no piiri');
  assert.deepEqual(ids('Lahden piirin pm-ottelut', 'Koejärven Urheilijat'), ['eky', 'lasy'], '18109: the region alone');
  assert.deepEqual(
    ids('Pohjola Seuracup Piirikisa I - EKY, KYMY, LASY', 'Koejärven Urheilijat'),
    [],
    '19677: a cup meet names no scope',
  );
  assert.deepEqual(
    ids('Pohjola Föreningscup Distriktstävling I - NÅID, ÅID', 'IF Prov'),
    [],
    'nor its Swedish name. (Break on purpose: drop föreningscup from NO_SCOPE_RE.)',
  );
  assert.deepEqual(
    ids('Piiriottelu LASY, KYMY, EKY', 'Koejärven Urheilijat'),
    [],
    '19833: nor a piiriottelu, however many it names',
  );
  assert.deepEqual(
    ids('Junnujen piiriottelu Helsy - UudY', 'Helsingin Seudun Yleisurheilu'),
    [],
    'a junnu word included. (Break on purpose: drop !none from the junnu test.)',
  );
  assert.deepEqual(ids('Veteraanien pm-hallikisat', 'Koejärven Urheilijat'), [], '16680');
  assert.deepEqual(off(null, null), []);

  // A scope's cover is what the name binds to its word.
  const pm = (name) => cover(name, 'Koejärven Urheilijat')[0];
  assert.deepEqual(pm('Reilu Cup 3, seiväs ja 8-15v pm-seiväs'), { ages: from(8, 15), events: ['seiväs'] }, '19759');
  assert.deepEqual(pm('Pitkät ratamatkat (pm 10000 m) ja muut'), { ages: null, events: ['10000m'] }, '20732');
  assert.deepEqual(
    pm('Avoimet pm-kävelyt, 3-loikka ja keihäs'),
    { ages: null, events: ['kävelyt'] },
    '20654: the comma ends it',
  );
  assert.deepEqual(pm('Avoimet pm-kävelyt, keihäs'), { ages: null, events: ['kävelyt'] }, 'even before an event word');
  assert.deepEqual(pm('DM 14-15 år'), { ages: [14, 15], events: null }, '20285: the Swedish "v"');
  assert.deepEqual(
    pm('Hannun heitot ja Piirinmestaruuskilpailut 9-17 v'),
    { ages: from(9, 17), events: null },
    '20123: what comes before "ja" is not bound',
  );
  assert.deepEqual(
    pm('12-13-sarjojen pm kakkosottelu ja 14-15-sarjojen pm-ottelu'),
    { ages: from(12, 15), events: ['kakkosottelu', 'ottelu'] },
    '20551: two words unite',
  );
  assert.deepEqual(
    pm('Avoimet M/N, M/N17 ja M/N15-14 pm-kilpailut'),
    { ages: [14, 15, 17, 0], events: null },
    'the adult class is 0',
  );
  assert.deepEqual(pm('Kymenlaakson PM-huipentumat osa 4, pikajuoksut, aidat'), null, '"osa 4" names no class');
  assert.deepEqual(pm('Lasyn pm-moukari'), { ages: null, events: ['moukari'] }, '20228');
  assert.deepEqual(pm('Kisat 2 pm-kilpailut'), null, 'a bare number is no class');
  // (Break on purpose: read the run after the word to the first comma, and
  // 18897 keeps 17 of its 96 medals.)
  assert.deepEqual(
    pm('Kymenlaakson pm-hallikilpailut M/N 19-17, P/T15, P/T13, P/T11, P/T9'),
    { ages: [9, 11, 13, 15, 17, 18, 19], events: null },
    '18897: commas between classes',
  );
  assert.deepEqual(
    pm('Kymenlaakson avoimet pm-hallikilpailut T/P9, 11, 13 ja 15, N/M17'),
    { ages: [9, 11, 13, 15, 17], events: null },
    '16524',
  );
  assert.deepEqual(
    pm('Helsyn pm-moniottelut 1 9-11-v.'),
    { ages: from(9, 11), events: ['moniottelut'] },
    '16957: a part number before the run is no class',
  );
  assert.deepEqual(
    pm('Helsyn pm-viestit, 30 v. juhlakisat'),
    { ages: null, events: ['viestit'] },
    'nor an age alone before a spaced "v", which names an anniversary. (Break on purpose: shift only a number before a number.)',
  );
  assert.deepEqual(
    pm('Helsyn Pm-moniottelut II 12-13v'),
    { ages: [12, 13], events: ['moniottelut'] },
    '20828: nor is a roman one',
  );
  assert.deepEqual(
    pm('HämSY:n pm-sisulisäottelut 1 T/P10, T/P12, P13, N14-15'),
    { ages: [10, 12, 13, 14, 15], events: ['sisulisäottelut'] },
    '19874',
  );
  assert.deepEqual(
    pm('Pm-sisuhuipentumat T/P 9-15 v'),
    { ages: from(9, 15), events: null },
    '20054: "T/P" before a number is its prefix, not the adult class',
  );
  assert.deepEqual(pm('Pm-sisulisähuipentuma Jämsä'), null, '19956: nothing after a meet word is an event');
  assert.deepEqual(pm('Uudy:n pm-junnut 9-13-v.'), { ages: from(9, 13), events: null }, '20527');
  assert.deepEqual(pm('Helsyn pm-maastot'), null, "19166: a cross-country meet's starts are distances");
  assert.deepEqual(pm('Helsyn 9-15v pm-maantiejuoksut ja katumaili'), { ages: from(9, 15), events: null }, '19145');
  assert.deepEqual(
    pm('LaSY ja KymY pm-viestit, 9-15'),
    { ages: from(9, 15), events: ['viestit'] },
    '20251: a comma before classes goes on',
  );

  // The am word's alue is the one its stem names, else the organiser's.
  const am = (name, org = 'Mittalan Veikot') => off(name, org);
  assert.deepEqual(
    am('Toukokuun Kisat, ja Aluemestaruus 10 000 m'),
    [{ id: 'etelainen', cover: { ages: null, events: ['10000m'] } }],
    '19350',
  );
  assert.deepEqual(
    am('KUY Games ja Aluemestaruuskilpailu 14-15v.'),
    [{ id: 'etelainen', cover: { ages: [14, 15], events: null } }],
    '19970',
  );
  assert.deepEqual(
    am('Aluemestaruusviestit'),
    [{ id: 'etelainen', cover: { ages: null, events: ['viestit'] } }],
    '20510',
  );
  assert.deepEqual(
    am('Läntisen alueen ja ÖID:n aluemestaruuskilpailut', 'IF Prov'),
    whole('lantinen'),
    'a named piiri joins an am meet only with the pm word (20039)',
  );
  assert.deepEqual(
    am('Läntisen alueen, ÖID:n ja KeSY:n aluemestaruuskilpailut', 'IF Prov'),
    whole('lantinen'),
    'two named, the same',
  );
  assert.deepEqual(
    am('Läntisen alueen am- ja ÖID:n pm-kilpailut', 'IF Prov'),
    [
      { id: 'lantinen', cover: { ages: [...from(14, 22), 0], events: null } },
      { id: 'oid', cover: null },
    ],
    'with the pm word it joins',
  );
  assert.deepEqual(
    am('Lounaisen alueen am-kilpailut T/P13', 'Luonnoslahden Voima'),
    [{ id: 'lounainen', cover: { ages: [13], events: null } }],
    'the stem in any case',
  );
  assert.deepEqual(ids('PSM-viestit'), ['pohjoinen'], '20596: PSM names Pohjoinen whoever organises');
  assert.deepEqual(ids('Pohjois-Suomen mestaruuskilpailut'), ['pohjoinen']);
  assert.deepEqual(ids('Pohjois Suomen Mestaruus kilpailu'), ['pohjoinen'], '17763: without the hyphen');
  assert.deepEqual(
    am('Aluemestaruuskilpailut 14,15,17,19 v., Eteläinen alue'),
    [{ id: 'etelainen', cover: { ages: [14, 15, 17, 19], events: null } }],
    '17852',
  );
  assert.deepEqual(
    am('KUY Games ja Aluemestaruuskilpailu 14-15v. Eteläinen alue'),
    [{ id: 'etelainen', cover: { ages: [14, 15], events: null } }],
    '19970 as indexed',
  );
  assert.deepEqual(
    am('Pohjois-Karjalan aluemestaruuskilpailut'),
    whole('etelainen'),
    'a stem inside another name is not the alue',
  );
  assert.deepEqual(am('AM- ja Sisu-kisat'), whole('etelainen'), "the bare word, the organiser's alue");
  assert.deepEqual(
    am('Aluemestaruus / Piirinmestaruus maantiekävelyt'),
    [
      { id: 'etelainen', cover: { ages: [...from(14, 22), 0], events: null } },
      { id: 'helsy', cover: { ages: null, events: ['maantiekävelyt'] } },
    ],
    '19327: both words, the alue 14 and up and the piiri the rest',
  );
  assert.deepEqual(ids('Itäisen alueen aluehuipentuma'), [], '18303: an alue named without the word');
  for (const name of ['aluekisat', 'Aluekilpailut', 'Regiontävling'])
    assert.deepEqual(ids(name), [], `${name} holds no championship`);
  for (const name of ['SAUL:n aluemestaruus', 'Aikuisurheilijoiden pm', 'Piiriottelu ja pm-viestit'])
    assert.deepEqual(am(name), [], `${name} is no SUL scope's`);
  assert.deepEqual(
    ids('Aluemestaruuskilpailut', 'Luonnoslahden Voima / Mittalan Veikot'),
    [],
    'two organisers of two alueet',
  );
  assert.deepEqual(
    ids('Aluemestaruuskilpailut', 'Luonnoslahden Voima / Hahmolan Into'),
    ['lounainen'],
    'two organisers agree on the alue',
  );

  // An SM meet's scope is the country, over the classes its name gives and
  // never an event word.
  const sm = (name) => off(name, 'Mittalan Veikot');
  assert.deepEqual(sm('SM-kilpailut M/N 19-22'), [{ id: 'sm', cover: { ages: from(19, 22), events: null } }], '20424');
  assert.deepEqual(
    sm('Nuorten SM-kilpailut M/N16-17'),
    [{ id: 'sm', cover: { ages: [16, 17], events: null } }],
    '20224',
  );
  assert.deepEqual(
    sm('SM-moniottelut N/M14-15'),
    [{ id: 'sm', cover: { ages: [14, 15], events: null } }],
    '20350: the ottelut not bound',
  );
  // (Break on purpose: keep nameCover's events, and 19949's walks go
  // uncovered.)
  assert.deepEqual(sm('SM-maantiekävelyt'), whole('sm'), '19949');
  // SAUL's SM is its masters' classes alone, so an adult start at one is no SM.
  // (Break on purpose: give SAUL's SM the whole meet, and 16602's N Paino
  // takes an SM medal.)
  const masters = [{ id: 'sm', cover: { ages: from(30, 100), events: null } }];
  assert.deepEqual(sm('SAUL SM heitto5-ottelu'), masters, '20711: SAUL cancels a pm, not an SM');
  assert.deepEqual(sm('SAULin SM-Maastojuoksu'), masters, '18642');
  assert.deepEqual(sm('SAUL SM -viestit 2025'), masters, '17792: its adult relay outside');
  assert.deepEqual(sm('SAUL SM-hallit'), masters, '16602: N Paino outside');
  assert.ok(
    !coversStart(masters[0].cover, { EventName: 'N Paino', Age: '0' }) &&
      coversStart(masters[0].cover, { EventName: 'N35 Paino', Age: '35' }),
  );
  assert.deepEqual(sm('Nuorten SM-hallit'), whole('sm'), '16645: the youth word, no class');
  // (Break on purpose: read "22-19-17" as a range, and 18, 20 and 21 join it.)
  assert.deepEqual(
    sm('SM-moniottelut M/N 22-19-17'),
    [{ id: 'sm', cover: { ages: [17, 19, 22], events: null } }],
    '20363: a chain of three is three classes',
  );
  assert.deepEqual(
    sm('Nuorten SM-hallit M/N17-19-22'),
    [{ id: 'sm', cover: { ages: [17, 19, 22], events: null } }],
    '18913',
  );
  // (Break on purpose: drop SM_RESULTS_RE, and the adults' SM-hallit is a
  // year's row with no medal.)
  for (const name of [
    'SM-hallit',
    'SM-maastot',
    'SM-Maraton',
    'SM-maantiejuoksut',
    'Superpainonheiton SM-kilpailut',
    'Koululiikuntaliiton SM yleisurheilukilpailut',
    'Parayleisurheilun SM-kisat',
    'Para PM/SM juoksut',
    'Vakka-Suomen mestaruuskilpailut',
    'PSM-viestit',
    'Kalevan kisat',
  ]) {
    assert.ok(!ids(name, 'Mittalan Veikot').includes('sm'), `${name} is no SM here`);
  }
  // The long throws' winter championship names the throw and the season
  // (16525, 19227, 18961). (Break on purpose: drop THROW_SM_RE from
  // defaultScopes' sm, and none of the three is an SM meet.)
  for (const name of [
    'Kiekon talvimestaruuskilpailut',
    'Keihäänheiton kevätmestaruuskilpailut',
    'Aikuisurheilijoiden keihäänheiton talvimestaruuskilpailut',
  ]) {
    assert.deepEqual(sm(name), whole('sm'), name);
  }
  // A meet in elsewhere.json is an SM whatever its name says (17868, 16637).
  // (Break on purpose: drop `listed` from defaultScopes' sm, and both
  // answer [].)
  for (const name of ['Kalevan kisat', 'SM-hallit']) {
    assert.deepEqual(
      defaultScopes(name, 'Mittalan Veikot', inventedDistricts, () => null, null, true),
      whole('sm'),
      `${name}, listed`,
    );
  }
});
