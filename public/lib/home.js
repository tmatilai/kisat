import { dayDiff, fiToIsoDay, isoDay, isoToFiDay, shiftIsoDay } from './dates.js';

// --- A meet against today ---------------------------------------

// Places a meet against today, for home's sort, its highlight and its split of
// recent meets from older ones. It reads the schedule's days, else the
// listing's Date (docs/tuloslista-api.md). `running` is true only on one of
// the meet's days, so a rest day between them is not running. Returns null,
// not a meet that ended today, where the meet's dates or today cannot be read.
function meetWhen(days, date, todayIso) {
  const known = (days || []).map(fiToIsoDay).filter(Boolean).sort();
  const list = known.length ? known : [isoDay(date)].filter(Boolean);
  if (!list.length) return null;
  const last = list[list.length - 1];
  const ended = dayDiff(todayIso, last);
  if (ended == null) return null;
  return {
    first: list[0],
    last,
    running: list.includes(todayIso),
    endedDaysAgo: Math.max(0, ended),
  };
}

// A finished meet stays in the default listing this many days, which covers the
// weekend just gone. The scan's window reaches as far back, since worker.js
// sets CAL_WINDOW_PAST_DAYS to it.
const RECENT_DAYS = 7;

function meetIsRecent(when, maxAgeDays = RECENT_DAYS) {
  // A meet whose date cannot be read stays listed.
  if (!when) return true;
  return when.endedDaysAgo <= maxAgeDays;
}

// Home sorts newest first by this value. It is today clamped into the meet's
// days, so a meet in progress sorts as today. A meet whose date cannot be read
// sorts last.
function meetSortValue(when, todayIso) {
  if (!when) return -Infinity;
  const day = (iso) => Date.parse(`${iso}T00:00:00Z`);
  return Math.min(Math.max(day(todayIso), day(when.first)), day(when.last));
}

// --- Cross-meet front page ------------------------------------

// The listing's Date gets this slack, as a meet can start days before the
// window with its Date after its first day (docs/tuloslista-api.md).
const CAL_SLACK_BEFORE_DAYS = 5;
const CAL_SLACK_AFTER_DAYS = 2;

// Returns the listing's competitions to fetch a schedule for.
function calendarCandidates(comps, fromIso, toIso) {
  const lo = shiftIsoDay(fromIso, -CAL_SLACK_BEFORE_DAYS);
  const hi = shiftIsoDay(toIso, CAL_SLACK_AFTER_DAYS);
  if (!lo || !hi) return [];
  return (comps || []).filter((c) => {
    const day = isoDay(c?.Date);
    return day && day >= lo && day <= hi;
  });
}

// Splits meets into the window, sorted by first day, and the rest in its own
// order. A meet with days [] has no schedule and is never in the window.
function calendarWindow(entries, fromIso, toIso) {
  const inWindow = [];
  const others = [];
  for (const e of entries || []) {
    const days = (e?.days || []).map(fiToIsoDay).filter(Boolean).sort();
    if (days.some((d) => d >= fromIso && d <= toIso)) inWindow.push({ ...e, firstDay: days[0] });
    else others.push(e);
  }
  inWindow.sort(
    (a, b) => a.firstDay.localeCompare(b.firstDay) || String(a.name ?? '').localeCompare(String(b.name ?? ''), 'fi'),
  );
  return { inWindow, others };
}

// Returns the window's meets with somebody followed in them, newest first as
// home sorts. A meet not scanned yet has no row here, and the fill-in loop's
// status line counts it (renderFillStatus, app/shell.js).
function scanHits(scan, todayIso) {
  const value = (c) => meetSortValue(meetWhen(c.days, null, todayIso), todayIso);
  return (scan?.comps || []).filter((c) => c.matches?.length).sort((a, b) => value(b) - value(a));
}

// Writes the window's first day as Seuratut's heading does, as "19.9.".
function scanSince(scan) {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(scan?.from ?? ''));
  return m ? `${Number(m[2])}.${Number(m[1])}.` : '';
}

// The listing puts this in a venue left blank (docs/tuloslista-api.md).
const PLACEHOLDER_LOCATION = 'Kilpailupaikka';

function meetPlace(location, organizationName) {
  const loc = location && location !== PLACEHOLDER_LOCATION ? location : '';
  return [loc, organizationName || ''].filter(Boolean).join(' · ');
}

// --- Meets that stand alone ------------------------------------

// Returns the rows of elsewhere.json that stand alone, in the listing's shape
// and with their days. Tuloslista's listing never has them.
function aloneListingRows(file) {
  return (file?.meets || [])
    .filter((m) => m?.id != null)
    .map((m) => {
      const days = [];
      for (let d = m.date; d && d <= (m.last || m.date); d = shiftIsoDay(d, 1)) days.push(isoToFiDay(d));
      return { Id: m.id, Name: m.name, Date: m.date, Location: m.location || '', OrganizationName: '', days };
    });
}

// Returns the listing's first day. It serves about a month back
// (docs/tuloslista-api.md, "It serves a live window and ignores every
// parameter"), and a row that stands alone joins it from that day on.
function listingFirstDay(listing) {
  return (
    (listing || [])
      .map((c) => isoDay(c?.Date))
      .filter(Boolean)
      .sort()[0] ?? ''
  );
}

export {
  RECENT_DAYS,
  aloneListingRows,
  calendarCandidates,
  calendarWindow,
  listingFirstDay,
  meetIsRecent,
  meetPlace,
  meetSortValue,
  meetWhen,
  scanHits,
  scanSince,
};
