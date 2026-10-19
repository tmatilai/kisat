import { hurdleMarkGlyph } from './hurdles.js';
import { isTrackLength } from './lap-counter.js';
import { markCoverProblems } from './tables.js';

// --- Kentät (Juoksut mode) -----------------------------------------------
// venues/index.json is the select's list, and venues/<id>.json is a kenttä's
// board (docs/venues.md).

// Locality and name are separate fields, as the select groups by locality.
function venueFullName(entry) {
  return entry ? `${entry.locality}, ${entry.name}` : '';
}

// The id names the file and follows from locality and name (venueProblems).
function venueSlug(entry) {
  const part = (s) =>
    (s || '')
      .toLowerCase()
      .replace(/[äå]/g, 'a')
      .replace(/ö/g, 'o')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  return `${part(entry?.locality)}-${part(entry?.name)}`;
}

// Returns the select's optgroups in order, one per locality, so two groups
// cannot share a heading.
function venueGroups(venues) {
  const fi = (a, b) => a.localeCompare(b, 'fi');
  const places = new Map();
  for (const v of venues) places.set(v.locality, [...(places.get(v.locality) || []), v]);
  return [...places.keys()].sort(fi).map((locality) => ({
    locality,
    venues: places
      .get(locality)
      .slice()
      .sort((a, b) => fi(a.name, b.name)),
  }));
}

// A kenttä's `marks` are its whole board and replace the sheet's, so a setting
// the board does not mark has no mark. `venue` flags a mark that differs from
// every mark of the sheet (docs/venues.md, "A board").
function venueTable(table, venue) {
  const own = venue?.marks;
  if (!own) return table;
  const sheet = table?.marks || [];
  return {
    ...table,
    marks: own.map((m) => ({
      ...m,
      venue: !sheet.some(
        (s) =>
          s.distance === m.distance &&
          s.toFirst === m.toFirst &&
          s.interval === m.interval &&
          s.count === m.count &&
          s.colour === m.colour &&
          s.symbol === m.symbol,
      ),
    })),
  };
}

// Returns the problems in a kenttä's files, none when they are sound. `entry`
// is its index row, and `venue` is its own file, which exists once its board is
// read.
function venueProblems(entry, venue, table) {
  const problems = [];
  const id = entry?.id || '?';
  const say = (msg) => problems.push(`${id}: ${msg}`);
  // Neither field holds a comma, as venueFullName joins the two with one.
  for (const k of ['locality', 'name']) {
    if (!entry?.[k]) say(`no ${k}`);
    else if (entry[k].trim() !== entry[k] || entry[k].includes(',')) say(`${k}: ${JSON.stringify(entry[k])}`);
  }
  // A row copied from another kenttä's and left with its id loads that board.
  if (entry?.locality && entry?.name && id !== venueSlug(entry)) say(`id is not ${venueSlug(entry)}`);
  // storedTrack (app/hurdles.js) hands this to the lap counter's arithmetic.
  if (!isTrackLength(entry?.length)) say(`${entry?.length} m track`);
  // A kenttä with no file has a board nobody has read, and the sheet's marks
  // stand (venueTable). An empty `marks` would claim the board paints none.
  if (!venue) return problems;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(venue.checked || '')) say('no checked date');

  const seen = new Set();
  for (const m of venue.marks || []) {
    const at = `${m.distance} ${m.toFirst}|${m.interval}`;
    if (seen.has(at)) say(`${at}: two marks`);
    seen.add(at);
    if (!hurdleMarkGlyph(m)) say(`${m.distance} ${m.colour} ${m.symbol}: no shape to draw it as`);
    if (!(m.count >= 1)) say(`${at}: ${m.count} hurdles`);
    if (
      !(table?.setups || []).some(
        (s) => s.distance === m.distance && s.toFirst === m.toFirst && s.interval === m.interval,
      ) &&
      !(table?.relays || []).some(
        (r) => r.distance === m.distance && r.toFirst === m.toFirst && r.interval === m.interval,
      )
    )
      say(`${at}: no setup stands there`);
  }
  for (const msg of markCoverProblems(venue.marks || [], table?.setups || [])) say(msg);
  return problems;
}

export { venueFullName, venueGroups, venueProblems, venueTable };
