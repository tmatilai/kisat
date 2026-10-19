import { fiToIsoDay } from '../lib/dates.js';
import { anchorMoved, layerCloseAction, layerPopAction, menuAnchorPos, parseRoute, siteMode } from '../lib/routes.js';
import { STATUS_FI } from '../lib/schedule.js';

// --- The mode and the page's elements ---

// The mode is decided once at boot (siteMode, lib/routes.js). Everything else
// reads SITE_MODE, so no second call to siteMode can give another answer.
const SITE_MODE = siteMode(location.hostname, location.search);
const SITE_NAME = SITE_MODE === 'juoksut' ? 'Juoksut' : 'Kisat';
document.title = SITE_NAME;

const appEl = document.getElementById('app');
const titleEl = document.getElementById('title');
const backEl = document.getElementById('back');
const updatedEl = document.getElementById('updated');
const helpEl = document.getElementById('help');

// Juoksut-only routes live on this origin. The counter's taps are stored per
// origin, so the Kisat host would show an empty counter (docs/juoksut.md).
const JUOKSUT_ORIGIN = 'https://juoksut.matilainen.fi';

// Kisat-only routes live on this origin (docs/architecture.md,
// "The two modes").
const KISAT_ORIGIN = 'https://kisat.matilainen.fi';

// --- Building the page ---

const timeFmt = new Intl.DateTimeFormat('fi-FI', { hour: '2-digit', minute: '2-digit' });
const clockFmt = new Intl.DateTimeFormat('fi-FI', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// An unparseable date would print "Invalid Date", so it prints nothing.
function fmtDate(d) {
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fi-FI');
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    // These are set as properties. A checkbox reads only whether the attribute
    // is present, so setAttribute('checked', false) would leave it checked.
    else if (k === 'checked' || k === 'disabled' || k === 'open') node[k] = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
}

function statusChip(status) {
  return el('span', { class: `chip chip-${status}` }, STATUS_FI[status] || status);
}

async function copyText(text, copied, prompt) {
  try {
    await navigator.clipboard.writeText(text);
    setUpdated(true, copied);
  } catch {
    window.prompt(prompt, text);
  }
}

// Prints points to one decimal, with a Finnish decimal comma. A shared place in
// a final splits its points, so they can be a fraction.
function cupPointsText(points) {
  return String(Math.round(points * 10) / 10).replace('.', ',');
}

function wrap(table) {
  return el('div', { class: 'tbl-wrap' }, table);
}

// Draws a segmented control of buttons, each {label, pressed, onclick}. An
// item that is already a node is used as it is, such as a year's link that the
// caller keeps to rewrite its href. A null is left out.
function segControl(ariaLabel, items) {
  return el(
    'div',
    { class: 'seg', role: 'group', 'aria-label': ariaLabel },
    items.map((item) =>
      item?.nodeType || item == null
        ? item
        : el('button', { class: 'seg-btn', 'aria-pressed': String(!!item.pressed), onclick: item.onclick }, item.label),
    ),
  );
}

// --- The header: back, title, help and the status line ---

let helpTopics = null;
// Holds a status line for the next render only. A redirect or a re-render
// would otherwise overwrite the message with its own "Päivitetty …".
let flashMessage = null;

// A module can read another's variable but not assign it, so a view sets the
// page's state through these.
function setHelp(topics) {
  helpTopics = topics;
}
function setFlash(message) {
  flashMessage = message;
}

// The header's `‹` is a link to another view, or an action that closes a layer
// such as the quick-filter (docs/architecture.md, "Back targets and scroll").
// An action keeps a real href for the browser's long-press and middle-click.
let backAction = null;
function setBack(href, action = null) {
  backEl.hidden = false;
  backEl.href = href;
  backAction = action;
}
function hideBack() {
  backEl.hidden = true;
  backAction = null;
}

// Makes the title a menu. The caret is the menu's only sign, so a long title
// shortens and keeps it (dev/probe-aidat.js). A view that sets
// titleEl.textContent removes the button.
function setTitleMenu(text, rows) {
  const btn = el(
    'button',
    { class: 'title-menu', type: 'button', 'aria-haspopup': 'menu' },
    el('span', { class: 'title-text' }, text),
    el('span', { class: 'title-caret no-print' }, ' ▾'),
  );
  btn.addEventListener('click', () =>
    openMenu(
      text,
      btn,
      el(
        'div',
        { class: 'list menu' },
        rows.map(({ label, href, onclick, external }) =>
          href
            ? el(
                'a',
                { class: 'row', href, ...(external ? { target: '_blank', rel: 'noopener' } : {}) },
                el('span', { class: 'menu-check' }),
                el('div', { class: 'row-main' }, el('div', { class: 'row-title' }, label)),
              )
            : menuRow('', label, () => {
                closeTopLayer();
                onclick();
              }),
        ),
      ),
    ),
  );
  titleEl.replaceChildren(btn);
}
backEl.addEventListener('click', (e) => {
  if (!backAction) return;
  e.preventDefault();
  backAction();
});

function setUpdated(ok, msg) {
  updatedEl.textContent = msg || (ok ? `Päivitetty ${clockFmt.format(new Date())}` : 'Päivitys epäonnistui');
  updatedEl.classList.toggle('error', !ok);
}

function showError(err) {
  appEl.replaceChildren(
    el('div', { class: 'notice error' }, 'Tietojen haku epäonnistui. ', String(err.message || err)),
  );
}

helpEl.addEventListener('click', () => {
  if (helpTopics?.items) helpSheet(helpTopics.title, helpTopics.items);
  else if (helpTopics?.text) textSheet(helpTopics.title, helpTopics.text);
});

// --- Scroll positions ---

// Scroll positions are keyed by the rendered view (scrollKey), since two URLs
// can show one list. render() restores a position once the content is in,
// because the header's `‹` never calls history.back().
const scrollPositions = new Map();
let scrollKey = null;
function setScrollKey(key) {
  scrollKey = key;
}
// Returns the offset a refresh or a save should keep. A reader at the bottom of
// a page shorter than the remembered offset was clamped there by the browser,
// so the remembered offset wins (docs/views.md, "The refresh").
function wantedScroll() {
  const y = window.scrollY;
  const wanted = scrollKey ? scrollPositions.get(scrollKey) : null;
  const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  return wanted != null && wanted > y && y >= max ? wanted : y;
}
// Stores the position of the view being left under that view's key. Anything
// that swaps one rendered view for another calls it, the quick-filter's open
// and close included (docs/architecture.md, "Back targets and scroll").
function saveScroll() {
  if (scrollKey) scrollPositions.set(scrollKey, wantedScroll());
}

// Keeps the browser from racing render()'s own restore on back and forward.
history.scrollRestoration = 'manual';

// --- Layers ---

// A layer is a sheet or the quick-filter, stacked over a view at the same URL.
// Every exit goes through closeTopLayer() (docs/architecture.md, "Layers").
// A route change closes a 'sheet', but the 'filter' stays on in its view.
const layers = [];
// One history entry, the sentinel, stands for the whole stack (layerPopAction,
// layerCloseAction, lib/routes.js). layerHere is the sentinel id of the entry
// the browser is on. pendingBack counts this file's own history.back() calls.
let layerSentinel = null;
let layerHere = null;
let layerSeq = 0;
let pendingBack = 0;
let rewindQueued = false;
let sentinelHref = null;

// The refresh skips a tick while a sheet is open, but runs under the
// quick-filter (docs/architecture.md, "Layers").
function anySheetOpen() {
  return layers.some((l) => l.kind === 'sheet');
}

function pushSentinel() {
  layerSentinel = ++layerSeq;
  layerHere = layerSentinel;
  sentinelHref = location.href;
  history.pushState({ layer: layerSentinel }, '', location.href);
}

function openLayer(close, kind) {
  // A sheet that closes itself to open another cancels the queued rewind here,
  // so the new sheet takes over the sentinel (dev/probe-layers.js).
  rewindQueued = false;
  if (layerSentinel == null) pushSentinel();
  layers.push({ close, kind });
}

// Every gesture that closes a layer comes through here.
function closeTopLayer() {
  const layer = layers.pop();
  if (!layer) return;
  layer.close();
  const action = layerCloseAction(layerSentinel, layerHere, layers.length);
  if (action === 'keep') return;
  if (action === 'drop') {
    layerSentinel = null;
    return;
  }
  // The rewind waits a microtask, so an openLayer later in the same handler
  // can still cancel it.
  rewindQueued = true;
  queueMicrotask(() => {
    if (!rewindQueued) return;
    rewindQueued = false;
    layerSentinel = null;
    // A changed URL means the same handler has navigated since the close.
    // Going back would undo that navigation. navigate's pushState changes the
    // URL synchronously, before this runs.
    if (location.href !== sentinelHref) return;
    pendingBack += 1;
    history.back();
  });
}

// On a route change, closes every sheet and drops the quick-filter's layer
// but not its state. By then the navigation's entry sits above the sentinel,
// so nothing here goes back.
function clearLayers() {
  rewindQueued = false;
  for (let i = layers.length - 1; i >= 0; i--) {
    if (layers[i].kind === 'sheet') layers[i].close();
  }
  layers.length = 0;
  layerSentinel = null;
  layerHere = null;
}

// Escape closes the top layer wherever focus is, even in a search field,
// because the listener is on document.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && layers.length) closeTopLayer();
});

// A traversal fires popstate and nothing else, so this handler takes a layer
// off or renders the entry it landed on (layerPopAction, lib/routes.js).
window.addEventListener('popstate', () => {
  const action = layerPopAction(layerSentinel, layerHere, pendingBack);
  if (action === 'settle') {
    pendingBack -= 1;
  } else if (action === 'close') {
    layers.pop()?.close();
    layerSentinel = null;
    // The history entry that went with the closed layer stood for the others
    // too. A fresh sentinel lets the next back press close the next layer.
    if (layers.length) {
      pushSentinel();
      return;
    }
  }
  layerHere = history.state?.layer ?? null;
  if (action === 'route') leaveView();
});

// Opens a dialog under a cover (docs/style.md, "A menu is not a dialog"). Only
// closeTopLayer() may close it. openMenu measures the returned node's card.
function openSheet(title, body, extraClass = '', onClose = null) {
  const sheet = el(
    'div',
    {
      class: `sheet${extraClass ? ` ${extraClass}` : ''}`,
      onclick: (e) => {
        if (e.target === sheet) closeTopLayer();
      },
    },
    el(
      'div',
      { class: 'sheet-card' },
      el(
        'div',
        { class: 'sheet-head' },
        el('div', { class: 'sheet-title' }, title),
        el('button', { class: 'sheet-close', 'aria-label': 'Sulje', onclick: () => closeTopLayer() }, '×'),
      ),
      body,
    ),
  );
  document.body.append(sheet);
  // openMenu's onClose removes the listeners it put outside the node, however
  // the layer closes.
  openLayer(() => {
    onClose?.();
    sheet.remove();
  }, 'sheet');
  return sheet;
}

// Opens a menu as a sheet placed at its button (menuAnchorPos,
// lib/routes.js). It closes when the button moves (anchorMoved).
function openMenu(title, anchor, body) {
  const closed = new AbortController();
  const sheet = openSheet(title, body, 'sheet-menu', () => closed.abort());
  if (!anchor) return sheet;
  sheet.classList.add('sheet-anchored');
  const card = sheet.firstChild;
  // The card is measured with sheet-anchored on, which gives it its final size.
  const at = anchor.getBoundingClientRect();
  const { left, top } = menuAnchorPos(at, card.getBoundingClientRect(), {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
  // The page and a sheet under the menu can both scroll (addToWatchMenu), so
  // check watches the anchor. Scrolling the menu's own card leaves it still.
  const check = () => {
    if (anchorMoved(at, anchor.getBoundingClientRect())) closeTopLayer();
  };
  // The menu stays the top layer, because addToWatchMenu closes it before it
  // opens a sheet. So closeTopLayer in check always closes this menu.
  window.addEventListener('scroll', check, { capture: true, passive: true, signal: closed.signal });
  window.addEventListener('resize', check, { signal: closed.signal });
  return sheet;
}

// An item without a meaning is drawn as a sub-heading over the items after it.
function helpSheet(title, items) {
  openSheet(
    title,
    el(
      'div',
      { class: 'help-list' },
      items.map(([term, what]) =>
        what == null
          ? el('div', { class: 'help-sub' }, term)
          : el(
              'div',
              { class: 'help-item' },
              el('span', { class: 'help-term' }, term),
              el('span', { class: 'help-what' }, what),
            ),
      ),
    ),
  );
}

function textSheet(title, paragraphs) {
  openSheet(
    title,
    el(
      'div',
      { class: 'help-text' },
      paragraphs.map((p) => el('p', {}, p)),
    ),
  );
}

// Builds one row of any menu (openMenu). Every row keeps the check column,
// ticked or not, so the labels line up (docs/style.md, "Components").
// `actions` go under the one row they act on (watchMenu), and most rows have
// none.
function menuRow(mark, label, onclick, actions = null) {
  return el(
    'div',
    { class: 'row', onclick },
    el('span', { class: 'menu-check' }, mark),
    el('div', { class: 'row-main' }, el('div', { class: 'row-title' }, label), actions),
  );
}

// --- Navigation ---

// Counts renders. A view keeps the count it started with and stops after an
// await once a newer render has begun.
let renderSeq = 0;
function nextRenderSeq() {
  renderSeq += 1;
  return renderSeq;
}

function currentRoute() {
  return parseRoute(location.pathname, location.hash);
}

// Holds the router's render and scheduleRefresh (app.js). The router imports
// the views, so a view reaches it through these and not by importing app.js.
let router = null;
function setRouter(hooks) {
  router = hooks;
}
function render(isRefresh = false) {
  return router.render(isRefresh);
}

// Holds what each module drops when the route changes. A module registers it
// as it loads, and the router runs them all before every render.
const leaves = [];
function onLeave(leave) {
  leaves.push(leave);
}
function runLeaves(route) {
  for (const leave of leaves) leave(route);
}

// Keeps which <details> the reader opened or closed while `view` stays on
// screen, since a refresh rebuilds them. A route of another view forgets them.
// The result spreads into a <details>'s attributes.
function keptOpen(view) {
  const kept = new Map();
  onLeave((route) => {
    if (route.view !== view) kept.clear();
  });
  return (key, fallback) => ({
    open: kept.has(key) ? kept.get(key) : fallback,
    ontoggle: (e) => kept.set(key, e.currentTarget.open),
  });
}

// Leaves the current view. Every layer belongs to the view it opened over, so
// all layers close. The scroll position is saved before render() runs.
function leaveView() {
  clearLayers();
  saveScroll();
  render();
  router.scheduleRefresh();
}

// The way to another view; replaceAddress writes a choice the view already
// shows. pushState fires no event, so this renders itself.
// `replace` reuses the current entry (openFocusFilter). `redraw` swaps the
// view in place as a refresh does, with no loading placeholder.
function navigate(href, { replace = false, redraw = false } = {}) {
  history[replace ? 'replaceState' : 'pushState'](null, '', addressUrl(href));
  if (!redraw) leaveView();
  else {
    render(true);
    router.scheduleRefresh();
  }
}

// Carries the query string over, as ?mode= picks a dev host's mode (siteMode).
function addressUrl(href) {
  const url = new URL(href, location.href);
  if (!url.search && location.search) url.search = location.search;
  return url;
}

// Writes a choice into the page's address, with no render and no history entry.
function replaceAddress(href) {
  history.replaceState(null, '', addressUrl(href));
}

// --- A page that fills in over rounds ---

function scanTodayIso() {
  return fiToIsoDay(new Date().toLocaleDateString('fi-FI'));
}

// Fills in pending or stale rows for home's scan and the championship and cup
// year pages (docs/home.md, "Filling the scan in"). While left(data) is above
// zero it builds a round at a time and hands each answer to onUpdate. One loop
// runs per key.
const MAX_BUILD_ROUNDS = 30;
// A round the limiter refuses (429) waits out the limiter's window and goes
// on. Any other failure retries after a short wait. A loop that stops with
// rows left, after four waits in a row or its last round, offers a retry.
const ROUND_RATE_WAIT_MS = 20_000;
const ROUND_RETRY_WAIT_MS = 3_000;
const MAX_ROUND_WAITS = 4;
const autoRefreshing = new Set();
function renderFillStatus(container, key, data, { left, build, onUpdate }) {
  let unfinished = false;
  const count = () => (data ? left(data) : 0);

  function render() {
    if (autoRefreshing.has(key)) {
      container.replaceChildren(
        el('div', { class: 'notice scan-pending' }, `Päivitetään taustalla… (${count()} jäljellä)`),
      );
      return;
    }
    if (unfinished) {
      container.replaceChildren(
        el(
          'button',
          {
            class: 'btn btn-secondary scan-pending',
            onclick: startRefresh,
          },
          'Haku jäi kesken. Yritä uudelleen.',
        ),
      );
      return;
    }
    container.replaceChildren();
  }

  async function startRefresh() {
    if (autoRefreshing.has(key)) return;
    autoRefreshing.add(key);
    unfinished = false;
    render();
    let waits = 0;
    for (let round = 0; count() > 0 && round < MAX_BUILD_ROUNDS;) {
      const result = await build();
      if (!result.data) {
        if (waits >= MAX_ROUND_WAITS) break;
        waits += 1;
        await new Promise((r) => setTimeout(r, result.status === 429 ? ROUND_RATE_WAIT_MS : ROUND_RETRY_WAIT_MS));
        continue;
      }
      waits = 0;
      round += 1;
      data = result.data;
      onUpdate(data);
      render();
    }
    autoRefreshing.delete(key);
    unfinished = count() > 0;
    render();
  }

  if (count() > 0 && !autoRefreshing.has(key)) startRefresh();
  else render();
}

export {
  JUOKSUT_ORIGIN,
  KISAT_ORIGIN,
  SITE_MODE,
  SITE_NAME,
  anySheetOpen,
  appEl,
  backEl,
  clockFmt,
  closeTopLayer,
  copyText,
  cupPointsText,
  currentRoute,
  el,
  flashMessage,
  fmtDate,
  helpEl,
  helpTopics,
  hideBack,
  keptOpen,
  layers,
  menuRow,
  navigate,
  nextRenderSeq,
  onLeave,
  openLayer,
  openMenu,
  openSheet,
  render,
  renderFillStatus,
  renderSeq,
  replaceAddress,
  runLeaves,
  saveScroll,
  scanTodayIso,
  scrollKey,
  scrollPositions,
  segControl,
  setBack,
  setFlash,
  setHelp,
  setRouter,
  setScrollKey,
  setTitleMenu,
  setUpdated,
  showError,
  statusChip,
  svgEl,
  textSheet,
  timeFmt,
  titleEl,
  wantedScroll,
  wrap,
};
