import { parseTs } from '../lib/dates.js';
import {
  BAND_MIN_FIELD,
  BAND_SLOTS,
  BOARD_SWAP_METRES,
  SPLIT_MIN_FIELD,
  anchorStart,
  bandQueue,
  bandSlots,
  boardLeader,
  correctedStart,
  crossingsFor,
  crossingsOf,
  deriveLaps,
  dropIndex,
  finishText,
  fmtShift,
  handTimeMs,
  isCrossing,
  isShuttleRelay,
  lapPrompts,
  lapsBehind,
  lapsHelp,
  legCrossings,
  movedOrder,
  myRows,
  nextCall,
  packCrossings,
  raceDistance,
  raceOrder,
  refreshesSnapshot,
  reorderCrossing,
  reorderSpans,
  repairTime,
  sortTiles,
  startNote,
  startsClock,
  tapGuardMs,
  tileAnchor,
  tileDensity,
} from '../lib/lap-counter.js';
import { isRelayEventType, mergeHeats, parseResult, relayLegCount } from '../lib/results.js';
import { startKeyOf } from '../lib/schedule.js';
import { loadGroup } from './data.js';
import { storedTrack } from './hurdles.js';
import {
  anySheetOpen,
  appEl,
  backEl,
  clockFmt,
  closeTopLayer,
  currentRoute,
  el,
  onLeave,
  openSheet,
  renderSeq,
  setHelp,
  titleEl,
  wrap,
} from './shell.js';

// The lap counter (Juoksut mode). docs/lap-counter.md is the specification,
// and its numbers are measured off real races. The view never re-renders on
// its own (dev/probe-laps.js).

// --- The screen staying awake, and starting the clock without the screen ---

// The counter holds a wake lock while it is open, and takes it again when the
// page comes back (docs/lap-counter.md, "Clock, keys and the screen staying on").
let wakeLock = null;

async function holdWakeLock() {
  if (wakeLock || !navigator.wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener?.('release', () => {
      wakeLock = null;
    });
  } catch {
    // A refused lock goes unmentioned, as the counter works without it.
    wakeLock = null;
  }
}

function dropWakeLock() {
  const held = wakeLock;
  wakeLock = null;
  held?.release?.().catch(() => {});
}

// The counter sets this while it is open, so a key can start the clock.
// startsClock (lib/lap-counter.js) says which keys count.
let startClockFromKey = null;

// The counter's render sets this. It restarts the tick after the page was
// hidden, without a re-render.
let resumeLapTick = null;

window.addEventListener('keydown', (e) => {
  if (!startClockFromKey) return;
  if (
    !startsClock({
      key: e.key,
      repeat: e.repeat,
      meta: e.metaKey,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      sheetOpen: anySheetOpen(),
      targetTag: e.target?.tagName ?? '',
    })
  )
    return;
  e.preventDefault();
  startClockFromKey();
});

// --- Taps, holds and the counter's sheets ---

// The prompts move with the clock, so the tick re-applies them between presses.
const LIVE_TICK_MS = 250;
// How long a tile keeps its flash class. Each is at least its animation's
// duration in index.html, or the flash is cut off mid-fade.
const TAP_FLASH_MS = 450;
const TAP_FLASH_BIG_MS = 600;
const TAP_REJECT_MS = 520;
let lastTap = { id: null, at: 0, big: false };
// lastReject is the last press refused as a double tap. Its tile shakes, so
// the press does not read as one that landed.
let lastReject = { id: null, at: 0 };
let lastClockTap = 0;
// A tile's hold is longer than the clock's, because tiles are pressed all race
// and leaning on one must not open its sheet.
const TILE_HOLD_MS = 800;
let tileHoldTimer = null;
let tileHeld = false;

// A competitor out of the race carries one of these marks.
const MARKS = [
  ['DNS', 'DNS — ei lähtenyt'],
  ['DNF', 'DNF — keskeytti'],
  ['DQ', 'DQ — hylätty'],
];

// A long press on a tile or on the clock opens this sheet. Nothing happens
// until a named button is tapped (docs/lap-counter.md, "A held tile or clock
// opens a dialog of action buttons"). Each action is { label, primary, run }.
function actionSheet(title, actions) {
  const body = el(
    'div',
    { class: 'sheet-actions' },
    actions.map(({ label, primary, run }) =>
      el(
        'button',
        {
          class: `btn${primary ? '' : ' btn-secondary'}`,
          onclick: () => {
            closeTopLayer();
            run();
          },
        },
        label,
      ),
    ),
    el('button', { class: 'btn btn-secondary sheet-cancel', onclick: () => closeTopLayer() }, 'Peruuta'),
  );
  openSheet(title, body);
}

// The clock's nudges are whole seconds (docs/lap-counter.md,
// "Correcting a clock started late, early, or not at all"). Each is labelled by
// what it does to the times, so a clock pressed late is fixed with a plus.
const NUDGES = [
  [-5000, '−5 s'],
  [-1000, '−1 s'],
  [1000, '+1 s'],
  [5000, '+5 s'],
];

// This sheet corrects the heat's zero by a nudge or from one known time. It
// applies nothing until Valmis. Each anchor is { id, label, crossingT },
// where crossingT is the crossing that the known time is for.
function adjustSheet({ startTs, firstCrossing, anchors, note, onDone }) {
  let proposed = startTs;
  let limited = false;
  let badTime = false;

  const set = (ts) => {
    const r = correctedStart(ts, { firstCrossing, now: Date.now() });
    if (r) {
      proposed = r.ts;
      limited = r.limited;
    }
    paint();
  };

  const startEl = el('div', { class: 'adj-start' });
  const shiftEl = el('div', { class: 'adj-shift' });
  const warnEl = el('div', { class: 'adj-warn' });
  // A plus moves the zero back, which makes every time longer.
  const nudgeEls = NUDGES.map(([ms, label]) =>
    el(
      'button',
      {
        class: 'btn btn-secondary',
        onclick: () => set(proposed - ms),
      },
      label,
    ),
  );

  const sel = el(
    'select',
    { class: 'adj-select' },
    el('option', { value: '' }, 'Valitse kilpailija'),
    anchors.map((a) => el('option', { value: String(a.id) }, a.label)),
  );
  const timeEl = el('input', {
    class: 'adj-time',
    type: 'text',
    inputmode: 'decimal',
    placeholder: 'esim. 2.05,3',
    'aria-label': 'Tunnettu aika',
  });

  const applyAnchor = () => {
    const a = anchors.find((x) => String(x.id) === sel.value);
    const typed = timeEl.value.trim();
    badTime = !!typed && handTimeMs(typed) == null;
    if (!a || !typed || badTime) {
      paint();
      return;
    }
    set(anchorStart(a.crossingT, typed));
  };
  sel.addEventListener('change', applyAnchor);
  timeEl.addEventListener('input', applyAnchor);

  const doneEl = el(
    'button',
    {
      class: 'btn',
      onclick: () => {
        closeTopLayer();
        onDone(proposed);
      },
    },
    'Valmis',
  );

  function paint() {
    const known = proposed != null;
    startEl.textContent = known ? `Lähtö ${clockFmt.format(new Date(proposed))}` : 'Kelloa ei ole käynnistetty';
    const shift = startTs == null || !known ? null : startTs - proposed;
    shiftEl.className = `adj-shift${shift ? '' : ' none'}`;
    shiftEl.textContent = shift
      ? `Kaikki ajat ${shift > 0 ? '+' : ''}${fmtShift(shift)}`
      : known
        ? 'Ajat ennallaan'
        : 'Anna tunnettu aika alta';
    warnEl.textContent = badTime
      ? 'Aika muodossa 2.05,3 tai 26,14.'
      : limited === 'crossing'
        ? 'Lähtö ei voi olla ensimmäisen ylityksen jälkeen.'
        : limited === 'now'
          ? 'Lähtö ei voi olla tulevaisuudessa.'
          : '';
    for (const b of nudgeEls) b.disabled = !known;
    doneEl.disabled = !known || proposed === startTs;
  }

  openSheet(
    'Säädä kelloa',
    el(
      'div',
      { class: 'adj' },
      el(
        'div',
        { class: 'adj-readout' },
        startEl,
        shiftEl,
        note ? el('div', { class: 'adj-note' }, `Aiemmin: ${note}`) : null,
      ),
      warnEl,
      el('div', { class: 'adj-nudges' }, nudgeEls),
      el('div', { class: 'adj-label' }, 'tai aseta tunnetusta ajasta'),
      sel,
      timeEl,
      doneEl,
      el('button', { class: 'btn btn-secondary sheet-cancel', onclick: () => closeTopLayer() }, 'Peruuta'),
    ),
  );
  paint();
}

// Builds the competitor rows of pickSheet and packSheet. A tap ticks one in or
// out of chosen and then calls onToggle.
function pickList(rows, chosen, onToggle, noteOf = null) {
  return el(
    'div',
    { class: 'pick-list' },
    rows.map((r) => {
      const row = el(
        'button',
        {
          class: `pick-row${chosen.has(r.id) ? ' on' : ''}`,
          onclick: () => {
            if (chosen.has(r.id)) chosen.delete(r.id);
            else chosen.add(r.id);
            row.classList.toggle('on', chosen.has(r.id));
            onToggle();
          },
        },
        el('span', { class: 'pick-tick' }, '✓'),
        el('span', { class: 'pick-num' }, r.bib != null ? `#${r.bib}` : `R${r.lane}`),
        el('span', { class: 'pick-name' }, r.name),
        noteOf ? el('span', { class: 'pick-note' }, noteOf(r)) : null,
      );
      return row;
    }),
  );
}

// This sheet picks the competitors this phone counts (docs/lap-counter.md,
// "Splitting the field"). It applies nothing until Valmis, so the grid
// re-renders only at a moment the operator chose.
function pickSheet(title, rows, selected, onDone) {
  const chosen = new Set(selected);
  const countEl = el('div', { class: 'pick-count' });
  const paint = () => {
    countEl.textContent = chosen.size ? `${chosen.size}/${rows.length} valittu` : `Koko erä (${rows.length})`;
  };
  openSheet(
    title,
    el(
      'div',
      { class: 'pick' },
      countEl,
      pickList(rows, chosen, paint),
      el(
        'button',
        {
          class: 'btn',
          onclick: () => {
            closeTopLayer();
            onDone([...chosen]);
          },
        },
        'Valmis',
      ),
      el(
        'button',
        {
          class: 'btn btn-secondary',
          onclick: () => {
            closeTopLayer();
            onDone([]);
          },
        },
        'Näytä koko erä',
      ),
      el('button', { class: 'btn btn-secondary sheet-cancel', onclick: () => closeTopLayer() }, 'Peruuta'),
    ),
  );
  paint();
}

// Confirms a pack, with everyone ticked on the way in (docs/lap-counter.md,
// "Recording a pack"). Nobody ticked records nobody, where in pickSheet it
// means the whole heat. noteOf(row) gives the note beside a name.
function packSheet(rows, noteOf, excluded, onDone) {
  const chosen = new Set(rows.map((r) => r.id));
  const countEl = el('div', { class: 'pick-count' });
  const doneEl = el('button', {
    class: 'btn',
    onclick: () => {
      closeTopLayer();
      onDone([...chosen]);
    },
  });
  const paint = () => {
    countEl.textContent = `${chosen.size}/${rows.length} valittu`;
    doneEl.textContent = chosen.size ? `＋ Kirjaa ${chosen.size} ylitystä` : 'Ei kirjattavaa';
    doneEl.disabled = !chosen.size;
  };
  openSheet(
    'Kirjaa ohitetut ylitykset',
    el(
      'div',
      { class: 'pick' },
      countEl,
      pickList(rows, chosen, paint, noteOf),
      el(
        'div',
        { class: 'laps-info' },
        'Ajat arvioidaan siitä, milloin pakka ohitti maalilinjan.' +
          (excluded ? ' Maaliintuloa ei kirjata näin — se on napautettava.' : ''),
      ),
      doneEl,
      el('button', { class: 'btn btn-secondary sheet-cancel', onclick: () => closeTopLayer() }, 'Peruuta'),
    ),
  );
  paint();
}

function callText(call) {
  if (!call) return '🏁';
  if (call.kind === 'finish') return '🏁';
  // A handover shows the number of the leg about to start
  // (docs/lap-counter.md, "The changeover").
  if (call.kind === 'exchange') return `🤝${call.next}`;
  if (call.kind === 'bell') return '🔔';
  return String(call.laps);
}

// Returns the time to a competitor's next crossing as a tile words it.
function awayText(p) {
  if (p.state === 'overdue') return 'myöhässä';
  if (p.msAway == null) return null;
  const s = Math.round(p.msAway / 1000);
  // A due competitor two seconds out, or past the estimate, is at the line.
  if (p.state === 'due') return s <= 2 ? 'nyt' : `${s} s`;
  return s <= 90 ? `${s} s` : null;
}

// Returns the class of the flash a press left on a competitor's tile or slot,
// while the flash lasts.
function flashClass(id) {
  const now = Date.now();
  if (lastReject.id === id && now - lastReject.at < TAP_REJECT_MS) return 'rejected';
  if (lastTap.id === id && now - lastTap.at < (lastTap.big ? TAP_FLASH_BIG_MS : TAP_FLASH_MS)) {
    return lastTap.big ? 'tapped-big' : 'tapped';
  }
  return null;
}

// Writes one tile's call, colour and pulse on each tick. It changes only the
// nodes that differ and never rebuilds the tile (dev/probe-laps.js).
function applyTile({ row, tileEl, callEl, metaEl, pos, st }, p, hs, total) {
  const cls = ['tile'];
  let call = '';
  let meta = '';
  if (!p) {
    // A competitor with no prompt yet keeps a plain tile.
  } else if (p.state === 'out') {
    cls.push('out');
    call = '–';
    meta = p.reason;
  } else if (p.state === 'finished') {
    cls.push('finished');
    call = '🏁';
    meta = [st?.pos ? `${st.pos}.` : null, finishText(hs.startTs, st)].filter(Boolean).join(' · ');
  } else {
    cls.push(`call-${p.call?.kind || 'laps'}`);
    if (p.state === 'due') cls.push('due');
    else if (p.state === 'overdue') cls.push('overdue');
    call = total > 1 ? callText(p.call) : '';
    meta = [pos ? `${pos}.` : null, awayText(p)].filter(Boolean).join(' · ');
  }
  const flash = flashClass(row.id);
  if (flash) cls.push(flash);
  const next = cls.join(' ');
  if (tileEl.className !== next) tileEl.className = next;
  if (callEl.textContent !== call) callEl.textContent = call;
  if (metaEl.textContent !== meta) metaEl.textContent = meta;
}

// This strip mirrors the lap board at the track (docs/lap-counter.md,
// "The lap board"). Inside BOARD_SWAP_METRES of the leader's pass, its two
// numbers swap sizes.
function applyBoard(boardEl, rows, byId, prompts, total) {
  const { numEl, nextEl, subEl } = boardEl;
  const leader = boardLeader(rows, byId, prompts);
  if (!leader) {
    // Finishers count as leaders (boardLeader, lib/lap-counter.js). No leader
    // means that everyone is out of the race.
    boardEl.className = 'board done';
    numEl.textContent = '0';
    nextEl.textContent = '';
    subEl.textContent = 'ei ketään radalla';
    return;
  }
  const p = leader.prompt;
  const showing = Math.max(0, total - p.count);
  const home = p.state === 'finished';
  const started = p.count > 0;
  const due = !home && (p.state === 'due' || p.state === 'overdue');
  const swap = !home && p.metresAway != null && p.metresAway <= BOARD_SWAP_METRES;
  boardEl.className = `board${due ? ' due' : ''}${home ? ' done' : ''}${swap ? ' swap' : ''}`;
  numEl.textContent = String(showing);
  nextEl.textContent = !home && showing > 0 ? `→ ${showing - 1}` : '';
  const who = tileAnchor(leader.row, total);
  subEl.textContent = home ? `${who} maalissa` : started ? [who, awayText(p)].filter(Boolean).join(' · ') : '';
}
// Writes the next-up band's slots, which never sort (docs/lap-counter.md,
// "The next-up band"). A slot shows what a tile shows and takes the same press.
function applyBand(cells, slots, prompts, rowOf, total) {
  cells.forEach((cell, i) => {
    const id = slots?.[i]?.id ?? null;
    const p = id == null ? null : prompts.get(id);
    const row = id == null ? null : rowOf(id);
    const cls = ['band-slot'];
    let who = '';
    let call = '';
    let away = '';
    if (!p || !row) {
      cls.push('empty');
    } else {
      cls.push(`call-${p.call?.kind || 'laps'}`);
      if (p.state === 'due') cls.push('due');
      else if (p.state === 'overdue') cls.push('overdue');
      who = tileAnchor(row, total);
      call = callText(p.call);
      away = awayText(p) || '';
      const flash = flashClass(id);
      if (flash) cls.push(flash);
    }
    const next = cls.join(' ');
    if (cell.el.className !== next) cell.el.className = next;
    // An empty slot is disabled, so a press aimed at the runner who just left
    // it does nothing.
    if (cell.el.disabled !== !id) cell.el.disabled = !id;
    if (cell.whoEl.textContent !== who) cell.whoEl.textContent = who;
    if (cell.callEl.textContent !== call) cell.callEl.textContent = call;
    if (cell.awayEl.textContent !== away) cell.awayEl.textContent = away;
  });
}

// --- Dragging a standings row into its right place ---

// The move and the release are taken on the window, because a finger leaves
// its row within a few pixels and listeners on the row would miss the rest.
let rowDrag = null;

// The row may move inside span, which is [start, end) of trs. index is the
// dragged row's place in trs. onDrop(from, to) gets positions inside the
// span once the finger lifts somewhere else.
function startRowDrag(ev, { trs, span, index, onDrop }) {
  if (rowDrag || ev.button > 0) return;
  const rows = trs.slice(span[0], span[1]);
  const from = index - span[0];
  const heights = rows.map((tr) => tr.offsetHeight);
  const sum = (a, b) => a + b;
  rowDrag = {
    rows,
    heights,
    from,
    to: from,
    onDrop,
    y0: ev.clientY,
    moved: false,
    // up and down are how far the row may travel without leaving its span.
    up: heights.slice(0, from).reduce(sum, 0),
    down: heights.slice(from + 1).reduce(sum, 0),
  };
  rows[from].classList.add('row-dragging');
  addEventListener('pointermove', moveRowDrag);
  addEventListener('pointerup', endRowDrag);
  // A cancelled drag puts the rows back and corrects nothing.
  addEventListener('pointercancel', clearRowDrag);
  // This stops text selection under the finger and the caret on a desktop.
  ev.preventDefault();
}

function moveRowDrag(ev) {
  const d = rowDrag;
  if (!d) return;
  // The row stays in its run of equal counts (reorderSpans, lib/lap-counter.js).
  const dy = Math.max(-d.up, Math.min(d.down, ev.clientY - d.y0));
  if (Math.abs(dy) > 3) d.moved = true;
  d.to = dropIndex(d.from, d.heights, dy);
  const h = d.heights[d.from];
  d.rows.forEach((tr, i) => {
    const shift = i === d.from ? dy : i > d.from && i <= d.to ? -h : i < d.from && i >= d.to ? h : 0;
    tr.style.transform = shift ? `translateY(${shift}px)` : '';
  });
}

function endRowDrag() {
  const d = rowDrag;
  if (!d) return;
  clearRowDrag();
  if (!d.moved) return;
  // The click that follows this release must not open the mark sheet. A
  // capturing listener swallows clicks until the next task only. A drag that
  // ends over another row brings no click, and the next real tap must land.
  addEventListener('click', swallowClick, true);
  setTimeout(() => removeEventListener('click', swallowClick, true));
  if (d.to !== d.from) d.onDrop(d.from, d.to);
}

function swallowClick(ev) {
  ev.stopPropagation();
  ev.preventDefault();
}

function clearRowDrag() {
  const d = rowDrag;
  rowDrag = null;
  removeEventListener('pointermove', moveRowDrag);
  removeEventListener('pointerup', endRowDrag);
  removeEventListener('pointercancel', clearRowDrag);
  if (!d) return;
  // The rows go back to where the layout has them, so a cancelled drag
  // leaves no trace (dev/probe-laps.js).
  for (const tr of d.rows) tr.style.transform = '';
  d.rows[d.from].classList.remove('row-dragging');
}

// --- The counter ---

// The clock's hold is long enough that a reset cannot be brushed against, and
// short enough to hold with cold hands.
const CLOCK_HOLD_MS = 700;
let lapClockTimer = null;
let clockHoldTimer = null;
let clockHeld = false;
let toastTimer = null;

// A hidden counter stops its tick (LIVE_TICK_MS), since the OS never freezes a
// desktop tab and the device must last the meet. Back in front, it takes the
// wake lock again and resumes the tick, as the counter never re-renders.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearInterval(lapClockTimer);
  else if (currentRoute().view === 'laps') {
    holdWakeLock();
    resumeLapTick?.();
  }
});

// Away from the counter, no key may start a clock and no held press may fire.
// The screen may sleep again. It runs on every refresh too, as leaveView
// closes a sheet over the counter.
function leaveLaps(route) {
  if (route.view === 'laps') return;
  clearInterval(lapClockTimer);
  clearTimeout(clockHoldTimer);
  clearTimeout(tileHoldTimer);
  clockHeld = false;
  tileHeld = false;
  startClockFromKey = null;
  resumeLapTick = null;
  dropWakeLock();
}
onLeave(leaveLaps);

// This key and track:<compId> (trackKey, app/hurdles.js) keep their exact
// format, or a count in progress is orphaned (docs/juoksut.md,
// "What the counter requires of the rest").
function lapsKey(compId, groupKey) {
  return `laps:${compId}:${groupKey}`;
}

function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function toast(msg, kind) {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  const t = el('div', { class: `toast toast-${kind}` }, msg);
  document.body.append(t);
  toastTimer = setTimeout(() => t.remove(), 4000);
}

async function renderLaps(compId, groupKey) {
  const seq = renderSeq;
  holdWakeLock();
  backEl.hidden = false;
  backEl.href = `/c/${compId}/g/${encodeURIComponent(groupKey)}`;

  const storeKey = lapsKey(compId, groupKey);
  let state;
  try {
    // Temporary: a count in progress stored under the key its row's own offset
    // wrote moves to this one (docs/shims.md).
    if (localStorage.getItem(storeKey) == null) {
      const prefix = lapsKey(compId, '');
      const old = Object.keys(localStorage).find(
        (k) => k.startsWith(prefix) && startKeyOf(k.slice(prefix.length)) === startKeyOf(groupKey),
      );
      if (old) {
        localStorage.setItem(storeKey, localStorage.getItem(old));
        localStorage.removeItem(old);
      }
    }
    state = JSON.parse(localStorage.getItem(storeKey)) || {};
  } catch {
    state = {};
  }
  state.heats ||= {};

  function save() {
    state.t = Date.now();
    // A full store must not stop the counting. The taps then last only until
    // a reload.
    try {
      localStorage.setItem(storeKey, JSON.stringify(state));
    } catch {
      /* The store is full. */
    }
  }

  // The roster snapshot is refreshed when tuloslista answers. Otherwise the
  // counter runs from the stored one, and the header says so.
  let fresh = false;
  try {
    const loaded = await loadGroup(compId, groupKey);
    // An empty heat is an undrawn shell (roundAllocated, lib/results.js). It
    // would open the counter on a grid with no tiles.
    const heats = loaded ? mergeHeats(loaded.detailed).filter((h) => h.rows.length) : [];
    if (loaded && refreshesSnapshot(loaded.detailed, heats, state.roster)) {
      fresh = true;
      // A lone category goes in the title, as on the group page.
      const singleCat = loaded.detailed.length === 1;
      state.title = singleCat ? `${loaded.detailed[0].label} ${loaded.group.event}` : loaded.group.event;
      // The start's time lets the season pick the track when offline.
      state.ts = loaded.group.ts;
      // The snapshot holds all that the counter reads, as it opens offline.
      state.roster = {
        length: Math.max(0, ...loaded.detailed.map((d) => raceDistance(d.data?.EventType, d.data?.Name))),
        relay: loaded.detailed.some((d) => isRelayEventType(d.data?.EventType)),
        // A shuttle relay is one crossing whatever its distance
        // (isShuttleRelay, lib/lap-counter.js).
        shuttle: loaded.detailed.some((d) => isShuttleRelay(d.data?.EventType, d.data?.Name)),
        legs: Math.max(1, ...loaded.detailed.map((d) => relayLegCount(d.data?.EventType, d.data?.Name))),
        singleCat,
        heats: heats.map((h) => ({
          index: h.index,
          rows: h.rows.map(({ lane, alloc: a, label }) => ({
            id: a.Id,
            lane,
            bib: a.Number,
            name: a.Name,
            label,
            org: a.Organization?.NameShort || a.Organization?.Name || '',
            sb: a.SB || '',
            pb: a.PB || '',
            // sbMs and pbMs seed the pace. lapPrompts takes the SB, or the PB
            // without one.
            sbMs: parseResult(a.SB) != null ? parseResult(a.SB) * 10 : null,
            pbMs: parseResult(a.PB) != null ? parseResult(a.PB) * 10 : null,
          })),
        })),
      };
      save();
    }
  } catch {
    /* Offline, the counter runs from the stored snapshot. */
  }
  if (seq !== renderSeq) return;

  const roster = state.roster;
  if (!roster?.heats?.length) {
    titleEl.textContent = state.title || 'Kierroslaskuri';
    appEl.replaceChildren(
      el('div', { class: 'notice' }, 'Eräjakoa ei ole saatavilla, eikä tallennettua kokoonpanoa löytynyt.'),
    );
    return;
  }

  // The counter reads the meet's track and never sets it (docs/lap-counter.md,
  // "Distance, crossings and the track").
  const track = storedTrack(compId, parseTs(state.ts));
  const total = crossingsFor(roster.length, track, roster.shuttle);
  // perLeg is 0 where the handovers are not all at the finish line
  // (docs/lap-counter.md, "The changeover").
  const perLeg = roster.shuttle ? 0 : legCrossings(roster.length, track, roster.legs || 1);
  setHelp({
    title: 'Kierroslaskurin ohje',
    items: lapsHelp({
      total,
      perLeg,
      biggestHeat: Math.max(...roster.heats.map((h) => h.rows.length)),
    }),
  });
  const setTitle = () => {
    titleEl.textContent = state.title || 'Kierroslaskuri';
  };
  setTitle();
  if (!roster.heats.some((h) => h.index === state.activeHeat)) {
    state.activeHeat = roster.heats[0].index;
  }

  const heatState = () => {
    const hs = (state.heats[state.activeHeat] ||= { startTs: null, events: [] });
    hs.done ||= {};
    return hs;
  };

  // mineFor gives who this phone counts in a heat. It lives outside the heat's
  // state, so resetting a heat keeps it.
  const mineFor = (heatIndex) => (state.mine ||= {})[heatIndex] || [];
  const setMine = (heatIndex, ids) => {
    (state.mine ||= {})[heatIndex] = ids;
  };

  function rowFor(id) {
    const heat = roster.heats.find((h) => h.index === state.activeHeat);
    return heat.rows.find((r) => r.id === id);
  }

  // The band's slots live outside body(), because a slot is held until its
  // crossing is recorded and must survive each press's re-render
  // (dev/probe-laps.js). A change of heat starts them over.
  const band = { heat: null, slots: null };

  // Derives one heat's standings. A competitor out of the race trails the field
  // and takes no position (docs/lap-counter.md, "Who still needs an action").
  function standingsFor(heat) {
    const hs = state.heats[heat.index] || { startTs: null, events: [] };
    const done = hs.done || {};
    const { byId } = deriveLaps(hs.events, total);
    const ranked = raceOrder(heat.rows, byId);
    const order = [...ranked.filter((r) => !done[r.id]), ...ranked.filter((r) => done[r.id])];
    const posById = new Map();
    let place = 0;
    for (const r of order) {
      if (done[r.id]) continue;
      if ((byId.get(r.id)?.count ?? 0) > 0) posById.set(r.id, (place += 1));
    }
    return { hs, byId, order, posById, done };
  }

  // Writes every counted heat as plain text, for an email or a chat.
  function exportText() {
    const lines = [state.title || 'Kierroslaskuri'];
    for (const heat of roster.heats) {
      const { hs, byId, order, posById, done } = standingsFor(heat);
      if (!hs.events.length && !Object.keys(done).length) continue;
      lines.push('');
      if (roster.heats.length > 1) lines.push(`Erä ${heat.index}:`);
      // A corrected zero is noted per heat, as each heat has its own clock.
      const note = startNote(hs);
      if (note) lines.push(`(${note})`);
      // A split phone exports only its own competitors (docs/lap-counter.md,
      // "Splitting the field").
      const mine = mineFor(heat.index);
      const counted = myRows(order, mine);
      if (counted.length < order.length) {
        lines.push(`(vain osa erästä: ${counted.length}/${order.length})`);
      }
      for (const r of counted) {
        const st = byId.get(r.id);
        const count = st?.count ?? 0;
        const info = roster.singleCat ? r.org : [r.label, r.org].filter(Boolean).join(', ');
        const who = `${tileAnchor(r, total)} ${r.name}${info ? ` (${info})` : ''}`;
        if (done[r.id]) {
          lines.push(`—  ${who} — ${done[r.id]}`);
        } else if (count >= total) {
          const time = finishText(hs.startTs, st);
          lines.push(`${posById.get(r.id)}. ${who}${time ? ` — ${time}` : ''}`);
        } else if (count) {
          lines.push(`${posById.get(r.id)}. ${who} — ${total - count} kierrosta jäljellä`);
        } else {
          lines.push(`—  ${who} — ei kirjauksia`);
        }
      }
    }
    lines.push('');
    lines.push(
      lines.some((l) => l.includes('~'))
        ? 'Epäviralliset käsiajat · ~ = arvioitu ohitetusta ylityksestä · juoksut.matilainen.fi'
        : 'Epäviralliset käsiajat · juoksut.matilainen.fi',
    );
    return lines.join('\n');
  }

  async function shareResults() {
    const text = exportText();
    try {
      if (navigator.share) {
        // The text opens with its own heading, so a `title` would show it
        // twice.
        await navigator.share({ text });
      } else {
        await navigator.clipboard.writeText(text);
        toast('📋 Kopioitu leikepöydälle', 'undo');
      }
    } catch (err) {
      // An AbortError means the share sheet was closed, which is no failure.
      if (err.name !== 'AbortError') toast('Jakaminen epäonnistui', 'undo');
    }
  }

  // A held tile or a tapped row opens this sheet. It records a missed
  // crossing, sets a mark, or takes a mark back.
  function openMark(row) {
    const hs = heatState();
    const mark = hs.done[row.id];
    const st = deriveLaps(hs.events, total).byId.get(row.id);
    const count = st?.count ?? 0;
    const setMark = (value) => {
      if (value) hs.done[row.id] = value;
      else delete hs.done[row.id];
      save();
      body();
    };
    const actions = [];
    if (!mark && total > 1 && count < total) {
      actions.push({
        label: '＋ Kirjaa ohitettu ylitys',
        primary: true,
        run: () => addMissedCrossing(row),
      });
    }
    if (mark) actions.push({ label: '↩︎ Palauta kilpailuun', primary: true, run: () => setMark(null) });
    for (const [code, label] of MARKS) {
      if (code !== mark) actions.push({ label, run: () => setMark(code) });
    }
    actionSheet(`${tileAnchor(row, total)} ${row.name}`, actions);
  }

  // Records a missed crossing at the time the pace puts it (repairTime,
  // lib/lap-counter.js). docs/lap-counter.md, "Not losing a press", says why.
  function addMissedCrossing(row) {
    const hs = heatState();
    const { byId } = deriveLaps(hs.events, total);
    const st = byId.get(row.id);
    const now = Date.now();
    const heat = roster.heats.find((h) => h.index === state.activeHeat);
    // The prompts cover the whole heat, because a competitor with no pace of
    // their own falls back to the field's (heatLapMs, lib/lap-counter.js).
    const opts = {
      total,
      distance: roster.length,
      track,
      perLeg,
      startTs: hs.startTs,
      now,
      done: hs.done,
    };
    const p = lapPrompts(heat.rows, byId, opts).get(row.id);
    hs.events.push({
      id: row.id,
      t: repairTime({ lastT: st?.times.at(-1) ?? null, eta: p?.eta ?? null, startTs: hs.startTs, now }),
      est: true,
    });
    lastTap = { id: row.id, at: now, big: false };
    navigator.vibrate?.(25);
    save();
    body();
    // One repair puts in one crossing. A tile still overdue after it gets a
    // toast asking for another.
    const after = lapPrompts(heat.rows, deriveLaps(hs.events, total).byId, opts).get(row.id);
    if (after?.state === 'overdue') toast('Vielä ainakin yksi ylitys kirjaamatta', 'undo');
  }

  // Returns the overdue competitors a pack would record, less anyone a
  // crossing from the finish (docs/lap-counter.md, "Recording a pack").
  // packCrossings leaves them out too, so the chip counts what gets recorded.
  function missingIn(rows, byId, prompts) {
    const late = rows.filter((r) => prompts.get(r.id)?.state === 'overdue');
    return {
      rows: late.filter((r) => (byId.get(r.id)?.count ?? 0) < total - 1),
      excluded: late.some((r) => (byId.get(r.id)?.count ?? 0) >= total - 1),
    };
  }

  // Appends a pack as one log entry, so one undo takes it all back. Where its
  // times land is packCrossings' job (lib/lap-counter.js).
  function recordPack(ids) {
    const hs = heatState();
    const heat = roster.heats.find((h) => h.index === state.activeHeat);
    const now = Date.now();
    const crossings = packCrossings(myRows(heat.rows, mineFor(heat.index)), deriveLaps(hs.events, total).byId, {
      ids,
      total,
      distance: roster.length,
      track,
      perLeg,
      startTs: hs.startTs,
      now,
      done: hs.done,
    });
    if (!crossings.length) return;
    hs.events.push({ pack: crossings, t: now });
    // A pack buzzes like a bell or a finish, since it moves several counts.
    navigator.vibrate?.([30, 60, 30]);
    save();
    body();
    toast(`＋ Kirjattu ${crossings.length} ylitystä`, 'undo');
  }

  // Logs a corrected tap order as an entry of its own, so undo takes it back
  // like a press (reorderCrossing, lib/lap-counter.js). docs/lap-counter.md,
  // "Correcting the order the boxes were tapped in", says what it may change.
  function reorderAt(ids, n) {
    const hs = heatState();
    // A swap reorderCrossing refuses would never apply, so it is not logged.
    if (!reorderCrossing(deriveLaps(hs.events, total).byId, ids, n)) {
      toast('Järjestystä ei voi vaihtaa', 'undo');
      return;
    }
    hs.events.push({ order: ids, n, t: Date.now() });
    navigator.vibrate?.(25);
    save();
    body();
  }

  function tapAthlete(id) {
    const hs = heatState();
    const prev = deriveLaps(hs.events, total).byId.get(id);
    const now = Date.now();
    if (prev?.count >= total) return;
    if (hs.done?.[id]) return;
    // A press inside the tap guard (tapGuardMs, lib/lap-counter.js) records
    // nothing (docs/lap-counter.md, "Not losing a press"), and the tile shakes.
    if (prev?.times.length && now - prev.times[prev.times.length - 1] < tapGuardMs(prev.times)) {
      lastReject = { id, at: now };
      body();
      return;
    }
    const count = (prev?.count ?? 0) + 1;
    // The tile flashes and the device buzzes (docs/lap-counter.md, "Saying it
    // without a sound"), both bigger for a bell or a finish.
    const big = total > 1 && count >= total - 1;
    lastTap = { id, at: now, big };
    navigator.vibrate?.(big ? [30, 60, 30] : 25);
    hs.events.push({ id, t: now });
    save();
    body();
  }

  function body() {
    // A re-render ends any drag on the rows it replaces.
    clearRowDrag();
    const heat = roster.heats.find((h) => h.index === state.activeHeat);
    const hs = heatState();
    const { byId, order, posById, done } = standingsFor(heat);
    const parts = [];
    // These hold the nodes applyLive writes to, so the tick never searches
    // the DOM.
    const liveTiles = [];
    const bandCells = [];
    let boardEl = null;
    let packChipEl = null;
    if (band.heat !== state.activeHeat) {
      band.heat = state.activeHeat;
      band.slots = null;
    }

    // The lap board strip sits in the clock's row from the start, relays
    // included (docs/lap-counter.md, "The lap board").
    if (total > 1) {
      const numEl = el('span', { class: 'board-num' });
      const nextEl = el('span', { class: 'board-next' });
      const subEl = el('span', { class: 'board-sub' });
      // The strip has no visible label. The row cannot spare ~35 px for one
      // without cutting the bib short.
      boardEl = el('div', { class: 'board', 'aria-label': 'Kierrostaulun luku' }, numEl, nextEl, subEl);
      Object.assign(boardEl, { numEl, nextEl, subEl });
    }

    const isHome = (r) => (byId.get(r.id)?.count ?? 0) >= total;
    // A split phone shows only the competitors it counts, in everything below
    // (docs/lap-counter.md, "Splitting the field").
    const mine = mineFor(heat.index);
    const heatRows = myRows(heat.rows, mine);
    const split = heatRows.length < heat.rows.length;
    const finishedCount = heatRows.filter((r) => !hs.done[r.id] && isHome(r)).length;
    // The tiles leave out marked competitors, and finishers once hidden. Their
    // count sets the density (tileDensity, lib/lap-counter.js).
    const racing = heatRows.filter((r) => !hs.done[r.id] && !(state.hideFinished && isHome(r)));
    const density = tileDensity(racing.length);
    const dense = density > 2;

    if (roster.heats.length > 1) {
      parts.push(
        el(
          'div',
          { class: 'heat-tabs' },
          roster.heats.map((h) =>
            el(
              'button',
              {
                class: `tab${h.index === state.activeHeat ? ' active' : ''}`,
                onclick: () => {
                  state.activeHeat = h.index;
                  save();
                  body();
                },
              },
              `Erä ${h.index}`,
            ),
          ),
        ),
      );
    }

    const startClock = () => {
      if (hs.startTs) return;
      hs.startTs = Date.now();
      // startTs0 keeps the zero as pressed, so a correction can say how far
      // it moved. Without it the export says the zero was set afterwards
      // (startNote, lib/lap-counter.js).
      hs.startTs0 = hs.startTs;
      lastClockTap = hs.startTs;
      navigator.vibrate?.(25);
      save();
      body();
    };

    // The heat's crossing times, earliest first, are the floor for a
    // correction of the zero. They are read through crossingsOf
    // (lib/lap-counter.js), or a pack's crossings would escape the floor.
    const crossings = hs.events
      .flatMap(crossingsOf)
      .map((e) => e.t)
      .sort((a, b) => a - b);

    const openAdjust = () => {
      const anchors = [];
      for (const r of myRows(order, mine)) {
        const st = byId.get(r.id);
        const last = st?.times?.at(-1);
        if (last == null) continue;
        // An anchor names the crossing that the operator needs a time for.
        const what = st.count >= total ? 'maali' : `${st.count}. ylitys`;
        anchors.push({ id: r.id, label: `${r.name} — ${what}`, crossingT: last });
      }
      adjustSheet({
        startTs: hs.startTs ?? null,
        firstCrossing: crossings[0] ?? null,
        anchors,
        note: startNote(hs),
        onDone: (ts) => {
          if (ts == null || ts === hs.startTs) return;
          hs.startTs = ts;
          save();
          body();
        },
      });
    };
    // A key can start the clock too (startsClock, lib/lap-counter.js).
    startClockFromKey = startClock;

    // A tap on the clock starts it, and a hold opens a sheet that applies
    // nothing until a named button is tapped (docs/lap-counter.md, "A held
    // tile or clock opens a dialog of action buttons").
    const endHold = () => {
      clearTimeout(clockHoldTimer);
      document.getElementById('lapclock')?.classList.remove('holding');
    };
    const clockEl = el(
      'button',
      {
        // The clock flashes after a start, as a tile does after a press.
        class: `clock${Date.now() - lastClockTap < TAP_FLASH_MS ? ' tapped' : ''}`,
        id: 'lapclock',
        'aria-label': hs.startTs
          ? 'Kello käynnissä. Pidä pohjassa säätääksesi kelloa tai nollataksesi erän.'
          : 'Käynnistä kello. Pidä pohjassa säätääksesi kelloa tai nollataksesi erän.',
        // This stops the iOS text callout and the desktop menu on a long press.
        oncontextmenu: (e) => e.preventDefault(),
        onpointerdown: () => {
          clockHeld = false;
          clockEl.classList.add('holding');
          clearTimeout(clockHoldTimer);
          clockHoldTimer = setTimeout(() => {
            clockHeld = true;
            endHold();
            const actions = [];
            if (hs.startTs != null || crossings.length) {
              actions.push({ label: '⏱️ Säädä kelloa', primary: true, run: openAdjust });
            }
            actions.push({
              label: '🗑️ Nollaa erä',
              run: () => {
                state.heats[state.activeHeat] = { startTs: null, startTs0: null, events: [] };
                save();
                body();
              },
            });
            actionSheet('Kello', actions);
          }, CLOCK_HOLD_MS);
        },
        onpointerup: endHold,
        onpointercancel: endHold,
        onpointerleave: endHold,
        onclick: () => {
          // The release that ended a long press must not also start the clock.
          if (clockHeld) {
            clockHeld = false;
            return;
          }
          startClock();
        },
      },
      hs.startTs ? fmtClock(Date.now() - hs.startTs) : '0:00',
    );

    parts.push(
      el(
        'div',
        { class: `laps-toolbar${dense ? ' dense' : ''}` },
        clockEl,
        // Without a board, the slot says when the heat was started, and whether
        // the zero was corrected since.
        boardEl ||
          el(
            'div',
            { class: 'clock-hint' },
            hs.startTs
              ? [`käynnistetty ${clockFmt.format(new Date(hs.startTs))}`, startNote(hs)].filter(Boolean).join(' · ')
              : null,
          ),
        el(
          'button',
          {
            class: 'btn btn-secondary',
            disabled: hs.events.length ? undefined : true,
            onclick: () => {
              const ev = hs.events.pop();
              if (ev) {
                save();
                // A reorder or a pack names no single competitor, so its toast
                // says what it was.
                toast(
                  isCrossing(ev)
                    ? `↩︎ Kumottu: ${tileAnchor(rowFor(ev.id), total)}`
                    : ev.pack
                      ? `↩︎ Kumottu: ${ev.pack.length} ylitystä`
                      : '↩︎ Kumottu: järjestys',
                  'undo',
                );
                body();
              }
            },
          },
          '↩︎ Kumoa',
        ),
      ),
    );

    // A race with laps draws the chip row even when it is empty, so a chip
    // that appears mid-race does not push the grid down (docs/lap-counter.md,
    // "Nothing moves under the official's finger").
    if (total > 1) {
      const canSplit = heat.rows.length >= SPLIT_MIN_FIELD;
      // Each end of the row holds a toggle or an empty span, which
      // space-between pins, so the pack chip comes and goes between them on
      // the tick and moves neither toggle.
      packChipEl = el('button', {
        class: 'chip chip-pack',
        onclick: () => {
          const now = Date.now();
          const prompts = lapPrompts(heatRows, byId, {
            total,
            distance: roster.length,
            track,
            perLeg,
            startTs: hs.startTs,
            now,
            done: hs.done,
          });
          const { rows: late, excluded } = missingIn(heatRows, byId, prompts);
          if (!late.length) return;
          const behind = lapsBehind(heatRows, prompts, track);
          packSheet(
            late,
            (r) => {
              const p = prompts.get(r.id);
              // How late a competitor is tells a missed press from someone who
              // has left the track.
              const secs = p?.msAway == null ? null : `${Math.round(-p.msAway / 1000)} s myöhässä`;
              const down = behind.get(r.id) ? `−${behind.get(r.id)} kier.` : null;
              return [down, secs].filter(Boolean).join(' · ');
            },
            excluded,
            recordPack,
          );
        },
      });
      packChipEl.hidden = true;
      parts.push(
        el(
          'div',
          { class: 'laps-info-row' },
          canSplit
            ? el(
                'button',
                {
                  class: `chip chip-toggle${split ? ' on' : ''}`,
                  onclick: () =>
                    pickSheet('Valitse omat', heat.rows, mine, (ids) => {
                      setMine(heat.index, ids);
                      save();
                      body();
                    }),
                },
                split ? `👥 ${heatRows.length}/${heat.rows.length}` : '👥 Omat',
              )
            : el('span'),
          packChipEl,
          finishedCount
            ? el(
                'button',
                {
                  class: `chip chip-toggle${state.hideFinished ? ' on' : ''}`,
                  onclick: () => {
                    state.hideFinished = !state.hideFinished;
                    save();
                    body();
                  },
                },
                state.hideFinished
                  ? `🏁 ${finishedCount} piilotettu · näytä`
                  : `🏁 ${finishedCount} maalissa · piilota`,
              )
            : el('span'),
        ),
      );
    }

    // The band counts the whole field, finishers and marks included, so it
    // cannot come and go mid-race. It keeps its height when empty.
    if (total > 1 && heat.rows.length >= BAND_MIN_FIELD) {
      for (let i = 0; i < BAND_SLOTS; i += 1) {
        const whoEl = el('span', { class: 'band-who' });
        const callEl = el('span', { class: 'band-call' });
        const awayEl = el('span', { class: 'band-away' });
        const cell = el(
          'button',
          {
            class: 'band-slot empty',
            disabled: true,
            // A slot takes a tap and no hold, since it empties under the finger.
            onclick: () => {
              const id = band.slots?.[i]?.id;
              if (id != null) tapAthlete(id);
            },
          },
          whoEl,
          callEl,
          awayEl,
        );
        bandCells.push({ el: cell, whoEl, callEl, awayEl });
      }
      parts.push(
        el(
          'div',
          {
            class: `band${dense ? ' dense' : ''}`,
            'aria-label': 'Seuraavaksi maalilinjalle',
          },
          bandCells.map((c) => c.el),
        ),
      );
    }

    const tiles = sortTiles(racing, total);
    parts.push(
      el(
        'div',
        { class: `tile-grid d${density}` },
        tiles.map((r) => {
          const callEl = el('span', { class: 'call' });
          const metaEl = el('span', { class: 't-meta' });
          const endTileHold = () => clearTimeout(tileHoldTimer);
          const tileEl = el(
            'button',
            {
              class: 'tile',
              oncontextmenu: (e) => e.preventDefault(),
              onpointerdown: () => {
                tileHeld = false;
                clearTimeout(tileHoldTimer);
                tileHoldTimer = setTimeout(() => {
                  tileHeld = true;
                  navigator.vibrate?.(15);
                  openMark(r);
                }, TILE_HOLD_MS);
              },
              onpointerup: endTileHold,
              onpointercancel: endTileHold,
              onpointerleave: endTileHold,
              onclick: () => {
                // The release that ended a long press is not a lap.
                if (tileHeld) {
                  tileHeld = false;
                  return;
                }
                tapAthlete(r.id);
              },
            },
            el(
              'div',
              { class: 't-top' },
              el('span', { class: 'bib' }, tileAnchor(r, total)),
              // The small line holds a merged start's class, and the bib where
              // the lane names the tile.
              density <= 3 && (total === 1 || !roster.singleCat)
                ? el(
                    'span',
                    { class: 't-sub' },
                    [
                      total === 1 && r.lane != null && r.bib != null && r.bib !== '' ? `#${r.bib}` : null,
                      roster.singleCat ? null : r.label,
                    ]
                      .filter(Boolean)
                      .join(' · '),
                  )
                : null,
            ),
            el('div', { class: 't-name' }, r.name),
            density <= 2 ? el('div', { class: 't-sub' }, r.org) : null,
            el('div', { class: 't-laps' }, callEl, metaEl),
          );
          // Position and finish time change only on a press, which re-renders, so
          // the tick reuses them.
          liveTiles.push({ row: r, tileEl, callEl, metaEl, pos: posById.get(r.id), st: byId.get(r.id) });
          return tileEl;
        }),
      ),
    );

    // The list shows from the start. It turns from start list to standings
    // when the clock starts or the first crossing lands.
    {
      const started = hs.startTs != null || hs.events.length > 0;
      // The list keeps this phone's rows, marked ones too, to undo a mark here.
      const listAll = started ? order : [...heat.rows].sort((a, b) => a.lane - b.lane);
      const listRows = myRows(listAll, mine);
      // A competitor out of the race is done too, or a DNF keeps the heading.
      const allDone = started && listRows.every((r) => done[r.id] || (byId.get(r.id)?.count ?? 0) >= total);
      const showNext = started && total > 1 && !allDone;
      // Laps down cover only this phone's subset (lapsBehind,
      // lib/lap-counter.js), as a split phone has no crossings for anyone else.
      // The tick leaves them alone, since they change once a lap and a press
      // re-renders.
      const behind = started
        ? lapsBehind(
            listRows,
            lapPrompts(listRows, byId, {
              total,
              distance: roster.length,
              track,
              perLeg,
              startTs: hs.startTs,
              now: Date.now(),
              done,
            }),
            track,
          )
        : new Map();
      // A drag stays in a run of equal counts (reorderSpans, lib/lap-counter.js).
      const spans = started ? reorderSpans(listRows, byId, done) : [];
      const spanAt = new Map();
      for (const span of spans) {
        for (let i = span[0]; i < span[1]; i += 1) spanAt.set(i, span);
      }
      // trs is filled as the rows are built. Only a pointer handler reads it,
      // once the table is on screen.
      const trs = [];
      // A drop logs the span's ids in their new order, with the crossing being
      // handed round, which is the count they share.
      const dropped = (span, from, to) => {
        const block = listRows.slice(span[0], span[1]);
        reorderAt(movedOrder(block, from, to), byId.get(block[0].id)?.count ?? 0);
      };
      parts.push(el('h2', {}, allDone ? 'Maaliintulojärjestys' : started ? 'Tilanne' : 'Lähtölista'));
      parts.push(
        wrap(
          el(
            'table',
            { class: `tbl${spans.length ? ' reorderable' : ''}` },
            el(
              'thead',
              {},
              el(
                'tr',
                {},
                el('th', { class: 'num' }, started ? 'Sija' : 'Rata'),
                el('th', { class: 'num' }, 'Nro'),
                el('th', {}, 'Nimi'),
                started ? null : el('th', { class: 'result' }, 'PB'),
                // The next-call column has no visible heading, only an accessible
                // name.
                showNext ? el('th', { class: 'next', 'aria-label': 'Seuraavalla ylityksellä' }) : null,
                el('th', { class: 'result' }, started ? 'Aika' : 'SB'),
              ),
            ),
            el(
              'tbody',
              {},
              listRows.map((r, i) => {
                const st = byId.get(r.id);
                const count = st?.count ?? 0;
                const isFinished = count >= total;
                const mark = done[r.id];
                const span = spanAt.get(i);
                const place = mark ? '—' : !started ? String(r.lane) : count ? `${posById.get(r.id)}.` : '—';
                const tr = el(
                  'tr',
                  {
                    class: `row-tappable${span ? ' row-movable' : ''}${mark ? ' row-out' : isFinished ? ' row-finished' : ''}`,
                    onclick: () => openMark(r),
                  },
                  // The place is the drag handle (docs/lap-counter.md,
                  // "Correcting the order the boxes were tapped in").
                  el(
                    'td',
                    { class: 'num' },
                    span
                      ? el(
                          'button',
                          {
                            class: 'grip',
                            'data-id': r.id,
                            'aria-label': `${place} ${r.name} — vedä vaihtaaksesi järjestystä`,
                            onpointerdown: (e) =>
                              startRowDrag(e, {
                                trs,
                                span,
                                index: i,
                                onDrop: (from, to) => dropped(span, from, to),
                              }),
                            // Arrow keys move a focused handle by one place.
                            onkeydown: (e) => {
                              const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
                              const at = i - span[0];
                              if (!step || at + step < 0 || at + step >= span[1] - span[0]) return;
                              e.preventDefault();
                              dropped(span, at, at + step);
                              // The drop rebuilt the table, so focus goes
                              // back to this competitor's handle for the
                              // next key press.
                              [...appEl.querySelectorAll('.tbl .grip')]
                                .find((g) => g.dataset.id === String(r.id))
                                ?.focus();
                            },
                          },
                          el('span', { class: 'grip-mark' }, '↕'),
                          place,
                        )
                      : place,
                  ),
                  el('td', { class: 'num' }, tileAnchor(r, total)),
                  el(
                    'td',
                    { class: 'cell-name' },
                    el(
                      'div',
                      {},
                      isFinished ? '🏁 ' : '',
                      r.name,
                      behind.get(r.id) && !mark && !isFinished
                        ? el('span', { class: 'laps-down' }, `−${behind.get(r.id)} kier.`)
                        : null,
                    ),
                    el('div', { class: 'org' }, roster.singleCat ? r.org : `${r.label} · ${r.org}`),
                  ),
                  started ? null : el('td', { class: 'result' }, mark ? '' : r.pb || ''),
                  showNext
                    ? el(
                        'td',
                        { class: 'next' },
                        (() => {
                          if (mark || isFinished) return '';
                          const call = nextCall(count, total, perLeg);
                          // An ordinary lap is muted, so a bell or a
                          // handover stands out.
                          return call?.kind === 'laps'
                            ? el('span', { class: 'org' }, String(call.laps))
                            : callText(call);
                        })(),
                      )
                    : null,
                  el(
                    'td',
                    { class: 'result' },
                    mark
                      ? el('span', { class: 'mark' }, mark)
                      : !started
                        ? r.sb || ''
                        : isFinished
                          ? (finishText(hs.startTs, st) ?? '🏁')
                          : '',
                  ),
                );
                trs.push(tr);
                return tr;
              }),
            ),
          ),
        ),
      );
      if (started) {
        parts.push(
          el(
            'div',
            { class: 'laps-info' },
            'Ajat ovat epävirallisia käsiaikoja. Viralliset tulokset tulevat Tuloslistaan.',
          ),
        );
      }
    }

    // The share button exports every heat with taps, not only the active one.
    if (roster.heats.some((h) => state.heats[h.index]?.events?.length)) {
      parts.push(
        el(
          'button',
          { class: 'btn btn-secondary', onclick: shareResults },
          navigator.share ? '📤 Jaa tulokset' : '📋 Kopioi tulokset',
        ),
      );
    }

    appEl.replaceChildren(...parts);

    // The tick moves the prompts between presses. It waits for the clock or a
    // first press, and stops while the page is hidden and once everyone is home
    // or out. A re-render, such as an undo or a reset, starts it again.
    const allAccounted = heat.rows.every((r) => hs.done[r.id] || isHome(r));
    resumeLapTick = () => {
      clearInterval(lapClockTimer);
      applyLive();
      if (!document.hidden && !allAccounted && (hs.startTs != null || hs.events.length)) {
        lapClockTimer = setInterval(applyLive, LIVE_TICK_MS);
      }
    };
    resumeLapTick();

    function applyLive() {
      const now = Date.now();
      const clockNode = document.getElementById('lapclock');
      if (clockNode && hs.startTs != null) {
        // The text is written only on a change, as each write costs a layout.
        const text = fmtClock(now - hs.startTs);
        if (clockNode.textContent !== text) clockNode.textContent = text;
      }
      const prompts = lapPrompts(heat.rows, byId, {
        total,
        distance: roster.length,
        track,
        perLeg,
        startTs: hs.startTs,
        now,
        done: hs.done || {},
      });
      for (const lt of liveTiles) applyTile(lt, prompts.get(lt.row.id), hs, total);
      if (boardEl) applyBoard(boardEl, heat.rows, byId, prompts, total);
      if (bandCells.length) {
        // Each tick starts from the last tick's slots, so a slot holds still.
        band.slots = bandSlots(band.slots, bandQueue(heatRows, prompts), { now });
        applyBand(bandCells, band.slots, prompts, rowFor, total);
      }
      if (packChipEl) {
        const late = missingIn(heatRows, byId, prompts).rows.length;
        packChipEl.hidden = !late;
        const text = `⏱ ${late} kirjaamatta`;
        if (late && packChipEl.textContent !== text) packChipEl.textContent = text;
      }
    }
  }

  body();
  return fresh ? null : 'Tallennettu kokoonpano';
}

export { renderLaps };
