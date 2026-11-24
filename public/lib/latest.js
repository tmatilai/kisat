// --- The followed lines' latest changes (docs/views.md, "Uusimmat") ---

import { allocKey } from './results.js';

// A line that changed this recently is marked as new.
const LATEST_FRESH_MS = 5 * 60_000;
// A meet day's snapshot is dropped this long after its last write.
const LATEST_TTL_MS = 2 * 24 * 60 * 60_000;

function latestLineKey(round, alloc) {
  return `${round?.Id}:${allocKey(alloc) ?? `x${alloc?.Id}`}`;
}

// Returns the part of a line that a render compares with the previous render
// (docs/views.md, "Uusimmat"), or '' before the line has a result.
function latestFingerprint(alloc, mark) {
  const attempts = (alloc?.Attempts || []).map((a) => `${a.Line1 ?? ''}/${a.Line2 ?? ''}`).join(',');
  const qual = `${alloc?.QRank ? 'Q' : ''}${alloc?.QResult ? 'q' : ''}`;
  return mark || attempts || qual ? [mark || '', attempts, qual].join('|') : '';
}

// Returns a meet day's snapshot updated with one render's lines. `modifiedAt`
// is the event document's `Last-Modified` in ms, or null. A change gets
// `modifiedAt` as its time, capped at `now` in case the device's clock is
// behind. The time is a guess, marked `approx`, on the day's first render and
// for a new line in an event not written since the previous render, such as an
// athlete just added to the Watch. A guess stored without a time takes the
// first `modifiedAt` that a later render brings. A line that this render
// missed keeps its entry, so a failed fetch doesn't make the line new again.
function updateLatest(prev, lines, now) {
  const before = prev?.lines || {};
  const savedAt = prev?.savedAt ?? null;
  const out = { ...before };
  for (const { key, fp, modifiedAt } of lines) {
    if (!fp) continue;
    const old = before[key];
    if (old?.fp === fp) {
      if (old.at == null && modifiedAt != null) out[key] = { ...old, at: modifiedAt };
      continue;
    }
    const unseenWrite = !old && modifiedAt != null && savedAt != null && modifiedAt <= savedAt;
    out[key] =
      savedAt == null || unseenWrite
        ? { fp, at: modifiedAt ?? null, approx: true }
        : { fp, at: Math.min(now, modifiedAt ?? now) };
  }
  return { savedAt: now, seenAt: prev?.seenAt ?? null, lines: out };
}

function latestFresh(entry, now) {
  return !!entry && !entry.approx && entry.at != null && now - entry.at < LATEST_FRESH_MS;
}

// `seenAt` is when Uusimmat was last on screen (trackLatest, app/meet.js).
function latestUnseen(snapshot) {
  const seenAt = snapshot?.seenAt ?? -Infinity;
  return Object.values(snapshot?.lines || {}).some((e) => !e.approx && e.at != null && e.at > seenAt);
}

// Returns the starts that have a snapshot entry, newest change first, each with
// `at`, the time of that change. `starts` is in the day's order.
function latestStarts(starts, snapshot) {
  const lines = snapshot?.lines || {};
  return starts
    .map((start, i) => {
      const times = start.items.filter((x) => lines[x.key]).map((x) => lines[x.key].at);
      const known = times.filter((t) => t != null);
      return { start, i, listed: times.length > 0, at: known.length ? Math.max(...known) : null };
    })
    .filter((x) => x.listed)
    .sort((a, b) => {
      if (a.at == null || b.at == null) return a.at == null && b.at == null ? b.i - a.i : a.at == null ? 1 : -1;
      return b.at - a.at || a.i - b.i;
    })
    .map(({ start, at }) => ({ ...start, at }));
}

// Returns how long ago a change was, in Finnish, such as "5 min sitten".
function latestAge(at, now) {
  const min = Math.floor(Math.max(0, now - at) / 60_000);
  if (min < 1) return 'juuri nyt';
  return min < 60 ? `${min} min sitten` : `${Math.floor(min / 60)} t sitten`;
}

function putLatest(store, dayKey, snapshot, now) {
  const kept = Object.entries(store && typeof store === 'object' ? store : {}).filter(
    ([, s]) => now - (s?.savedAt ?? 0) < LATEST_TTL_MS,
  );
  return Object.fromEntries([...kept, [dayKey, snapshot]]);
}

export {
  LATEST_FRESH_MS,
  LATEST_TTL_MS,
  latestAge,
  latestFingerprint,
  latestFresh,
  latestLineKey,
  latestStarts,
  latestUnseen,
  putLatest,
  updateLatest,
};
