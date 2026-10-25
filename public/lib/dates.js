// --- Dates and times ---

// Turns a day key such as "31.7.2026" into a number that sorts.
function dateSortKey(fi) {
  const [d, m, y] = fi.split('.').map(Number);
  return y * 10000 + m * 100 + d;
}

// Writes ascending day keys as a span, so "7.8.2026" to "9.8.2026" reads
// "7.8.–9.8.2026" with the shared year once. A single day stays as it is.
function dateRange(dates) {
  if (!dates.length) return '';
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first === last) return first;
  const year = last.slice(last.lastIndexOf('.') + 1);
  const shortFirst = first.endsWith(`.${year}`) ? first.slice(0, -year.length) : first;
  return `${shortFirst}–${last}`;
}

// Parses an API timestamp without its 7-digit fractional second, which not
// every Date parser accepts.
function parseTs(ts) {
  return new Date(String(ts).replace(/\.\d+/, ''));
}

// Returns a timestamp's instant for sorting, as one meet's rows can carry two
// UTC offsets (docs/tuloslista-api.md). An unparseable one sorts last.
function tsKey(ts) {
  const t = parseTs(ts).getTime();
  return Number.isFinite(t) ? t : Infinity;
}

// Counts whole days from ISO day b to a. Both parse as UTC midnights, so a DST
// change cannot make a day 23 or 25 hours long and round the wrong way.
function dayDiff(a, b) {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  return Number.isNaN(ta) || Number.isNaN(tb) ? null : Math.round((ta - tb) / 86_400_000);
}

// Returns the day as written, YYYY-MM-DD, whatever the offset. The API writes
// one instant under two offsets (docs/tuloslista-api.md).
function isoDay(ts) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(ts ?? ''));
  return m ? m[1] : '';
}

// Turns a schedule's day key such as "8.8.2026" into "2026-08-08".
function fiToIsoDay(fi) {
  const [d, m, y] = String(fi ?? '').split('.');
  if (!d || !m || !y) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Returns a moment's day on the device's own clock, as "2026-08-08". The
// listing's dates are Finnish days, so the UTC day would light yesterday's
// meets in the small hours.
function localIsoDay(date) {
  return fiToIsoDay(date.toLocaleDateString('fi-FI'));
}

function shiftIsoDay(iso, days) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return '';
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

// Returns the days a schedule covers in ascending order.
function scheduleDays(schedule) {
  return Object.keys(schedule || {}).sort((a, b) => dateSortKey(a) - dateSortKey(b));
}

// Turns "2026-08-07" into "7.8.2026", the schedule's own day shape.
function isoToFiDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  return m ? `${Number(m[3])}.${Number(m[2])}.${m[1]}` : '';
}

// Picks today, else the next day still to come, else the last day. dates holds
// day keys in ascending order.
function defaultDay(dates, today) {
  const key = dateSortKey(today);
  return dates.find((d) => dateSortKey(d) >= key) || dates[dates.length - 1] || null;
}

export {
  dateRange,
  dateSortKey,
  dayDiff,
  defaultDay,
  fiToIsoDay,
  isoDay,
  isoToFiDay,
  localIsoDay,
  parseTs,
  scheduleDays,
  shiftIsoDay,
  tsKey,
};
