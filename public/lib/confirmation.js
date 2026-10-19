import { combinedAthleteKey, combinedEventStarts, multiEventLeg } from './combined.js';
import { tsKey } from './dates.js';
import { roundAllocated } from './results.js';
import { hasEarlierRound } from './schedule.js';
import { matchedEntries } from './watch.js';

// --- Varmistus (confirmation) --------------------------------------------
// Most meets carry Confirmed: false for everybody, so the setting is the only
// signal before anyone confirms (docs/tuloslista-api.md).

// The Settings[].Type of the confirmation switch, whose IntValue is the
// deadline in minutes before the start (observed at the track). The setting's
// presence decides, and its "on" or "off" does not (docs/tuloslista-api.md).
const CONFIRM_SETTING_TYPE = 1;

function confirmSetting(properties) {
  const setting = (properties?.Settings || []).find((s) => s?.Type === CONFIRM_SETTING_TYPE);
  if (!setting) return null;
  return { minutes: Number(setting.IntValue) || 0 };
}

// Returns, per schedule row, the instant its deadline counts back from. A
// multi-event confirms once before its first leg (observed at the track), so
// all its legs count back from the earliest.
function confirmStartAt(schedule) {
  const first = new Map(combinedEventStarts(schedule).map((s) => [s.key, s.legs[0]?.ts]));
  return (schedRound) => first.get(multiEventLeg(schedRound?.EventName)?.label) || schedRound?.BeginDateTimeWithTZ;
}

// Counts one class's confirmations. Returns null where the meet has no setting
// and nobody here has confirmed, as a meet that never confirms would read 0/n
// (docs/tuloslista-api.md). closesTs is null with no deadline.
function confirmNote(enrollments, setting, ts, now = Date.now()) {
  const list = enrollments || [];
  if (!list.length) return null;
  const confirmed = list.filter((e) => e?.Confirmed).length;
  if (!setting && !confirmed) return null;
  const starts = tsKey(ts);
  const closesTs = setting?.minutes && Number.isFinite(starts) ? starts - setting.minutes * 60000 : null;
  return {
    confirmed,
    total: list.length,
    closesTs,
    closed: closesTs != null && now >= closesTs,
  };
}

// Writes the count in the one wording that the entry list, the day's own list
// and a multi-event's page share.
function confirmCount(v) {
  return `Varmistaneita ${v.confirmed}/${v.total}`;
}

// Writes the half after the count. `fmt` is the clock formatter that
// app/follow.js passes. A closed deadline prints as words, not a time, and no
// deadline gets no half. `short` leaves out the subject that the count names.
function confirmCloses(v, fmt, short = false) {
  if (v?.closesTs == null) return null;
  if (!v.closed) return `sulkeutuu ${fmt(v.closesTs)}`;
  return short ? 'sulkeutunut' : 'Varmistus sulkeutunut';
}

// Returns one class's rows for watchConfirmations and whether its field has a
// confirmation. Only an undrawn first round counts. A leg counts as its
// ottelu's row, with the tick read from the root's entries (docs/views.md,
// "Varmistus").
async function confirmRows(d, event, targets, team, ts, store) {
  if (roundAllocated(d.round) || hasEarlierRound(d.data?.Rounds, d.round)) return { rows: [], confirmsHere: false };
  const leg = d.data?.RootId ? multiEventLeg(d.schedRound?.EventName) : null;
  const ticks = leg
    ? new Map(
        ((await store.get(d.data.RootId))?.data?.Enrollments || []).map((e) => [combinedAthleteKey(e), !!e.Confirmed]),
      )
    : null;
  const rows = matchedEntries(d.round, d.data?.Enrollments, targets, team).map((m) => ({
    name: m.alloc?.Name || '',
    label: leg ? leg.label : event,
    key: leg ? `${leg.label}|${combinedAthleteKey(m.alloc)}` : null,
    ts,
    confirmed: ticks?.get(combinedAthleteKey(m.alloc)) ?? !!m.alloc?.Confirmed,
  }));
  return { rows, confirmsHere: (d.data?.Enrollments || []).some((e) => e?.Confirmed) };
}

// Returns the followed entries' confirmations, or null. The gate asks the whole
// field (`confirmsHere`) and not the entries. Rows sort unconfirmed first, then
// by deadline and name, and a multi-event's legs fold on `key`.
function watchConfirmations(entries, setting, confirmsHere, now = Date.now()) {
  const list = entries || [];
  if (!setting && !confirmsHere) return null;
  const folded = new Set();
  const rows = list
    .filter((e) => {
      if (!e?.key || folded.has(e.key)) return !e?.key;
      folded.add(e.key);
      return true;
    })
    .map((e) => {
      const starts = tsKey(e.ts);
      // `setting` can be null, as the gate can fire on the data alone.
      const closesTs = setting?.minutes && Number.isFinite(starts) ? starts - setting.minutes * 60000 : null;
      return {
        name: e.name,
        label: e.label,
        confirmed: !!e.confirmed,
        closesTs,
        closed: closesTs != null && now >= closesTs,
      };
    });
  if (!rows.length) return null;
  rows.sort(
    (a, b) =>
      Number(a.confirmed) - Number(b.confirmed) ||
      (a.closesTs == null) - (b.closesTs == null) ||
      (a.closesTs ?? 0) - (b.closesTs ?? 0) ||
      String(a.name).localeCompare(String(b.name), 'fi'),
  );
  return { rows, confirmed: rows.filter((r) => r.confirmed).length, total: rows.length };
}

export { confirmCloses, confirmCount, confirmNote, confirmRows, confirmSetting, confirmStartAt, watchConfirmations };
