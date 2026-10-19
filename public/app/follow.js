import { ageChipLabel, ageChipRows } from '../lib/ages.js';
import { confirmCloses } from '../lib/confirmation.js';
import { coverOfTicks, coverTicks, coverWords, meetCoverChoices, scopeTree, tickedScopes } from '../lib/districts.js';
import { isFollowableOrgId } from '../lib/indexes.js';
import { athleteCard, qualBadge, qualPending } from '../lib/results.js';
import { compViewMode, cupPath, focusLink, keyringLinkHash, pastedLink, watchLink } from '../lib/routes.js';
import { SEARCH_MIN_CHARS } from '../lib/search.js';
import {
  copyWatchLabel,
  focusTargets,
  watchConflictMerge,
  watchEntriesWith,
  watchEntryForAthlete,
  watchTargets,
} from '../lib/watch.js';
import {
  HOME_VIEW_KEY,
  activeFollow,
  activeWatchSeen,
  cupMeetSeen,
  fetchJson,
  fetchSchedule,
  forgetWatch,
  forgetWatchEditToken,
  loadActiveWatch,
  loadDistricts,
  piiriDefaults,
  registerWatch,
  rememberWatchEditToken,
  setActiveFollow,
  setViewCats,
  setViewMode,
  updateViewState,
  viewStateFor,
  watchEditToken,
  watchLabel,
  watchRegistry,
} from './data.js';
import {
  SITE_MODE,
  appEl,
  closeTopLayer,
  copyText,
  currentRoute,
  el,
  layers,
  menuRow,
  navigate,
  openLayer,
  openMenu,
  openSheet,
  render,
  renderSeq,
  saveScroll,
  segControl,
  setBack,
  setFlash,
  setHelp,
  timeFmt,
  titleEl,
} from './shell.js';

// --- The filter ---

// Turns the quick-filter on. focus is {kind, id, name}, where id is a person's
// roster athlete id or a club's Organization.Id. On the schedule view the
// filter is a layer. Elsewhere this navigates there.
function openFocusFilter(compId, focus) {
  updateViewState(compId, { focus: { ...focus, id: String(focus.id), mode: 'watched' } });
  const route = currentRoute();
  if (route.view !== 'comp' || route.compId !== compId) {
    // The replace uses up the closed sheet's history entry, or one back press
    // would do nothing (dev/probe-layers.js).
    navigate(`/c/${compId}`, { replace: true });
    return;
  }
  // Several names tapped in a row share one layer. Closing it clears whichever
  // focus is on by then.
  if (!layers.some((l) => l.kind === 'filter')) {
    openLayer(() => {
      saveScroll();
      updateViewState(compId, { focus: null });
      render();
    }, 'filter');
  }
  saveScroll();
  render();
}

// Every exit from the quick-filter comes here (docs/architecture.md,
// "Back targets and scroll"). After an activation link or a reload there is no
// filter layer, so this clears the state directly.
function closeFocusFilter(compId) {
  if (layers[layers.length - 1]?.kind === 'filter') closeTopLayer();
  else {
    saveScroll();
    updateViewState(compId, { focus: null });
    render();
  }
}

// Resolves the quick-filter, or with none set the active Watch, into one shape,
// and returns null for neither (docs/architecture.md, "View state"). A miss
// gets a notice and keeps local state, as the failure may be temporary.
async function resolveFilter(compId, state) {
  if (state.focus?.kind === 'club') {
    const roster = await fetchJson(`/api/roster/${compId}`).catch(() => null);
    const found = roster?.organizations?.find((o) => String(o.id) === state.focus.id);
    const label = found?.name || state.focus.name || 'Seura';
    if (!found) {
      return {
        kind: 'club',
        label,
        entries: [],
        roster: null,
        notice: roster ? 'Seuralla ei ole osallistujia tässä kilpailussa.' : 'Seuran tietojen haku epäonnistui.',
      };
    }
    // This is the entry a Watch following only this club would store.
    const entries = [{ type: 'club', id: state.focus.id, name: label, enabled: true }];
    return { kind: 'club', label, roster, entries, targets: focusTargets(state.focus, roster) };
  }
  if (state.focus) {
    const roster = await fetchJson(`/api/roster/${compId}`).catch(() => null);
    const found = roster?.athletes.find((a) => String(a.id) === state.focus.id);
    if (!found) {
      return {
        kind: 'athlete',
        label: state.focus.name || 'Urheilija',
        entries: [],
        roster: null,
        notice: roster ? 'Urheilijaa ei löytynyt kilpailun osallistujista.' : 'Urheilijan tietojen haku epäonnistui.',
      };
    }
    // The entry uses the licence, as a Watch's entry does, so the person's
    // relay teams match too (namedAthleteIds, lib/watch.js).
    return {
      kind: 'athlete',
      label: found.name,
      roster,
      targets: focusTargets(state.focus, roster),
      entries: [{ type: 'athlete', id: String(found.licenseId || found.id), name: found.name, enabled: true }],
    };
  }
  if (state.watchId) {
    const [watch, roster] = await Promise.all([
      loadActiveWatch(state.watchId),
      fetchJson(`/api/roster/${compId}`).catch(() => null),
    ]);
    if (!watch) {
      const label = watchLabel(state.watchId);
      return {
        kind: 'watch',
        label,
        entries: [],
        roster: null,
        watch: null,
        notice: 'Seurannan haku epäonnistui. Se voi olla poistettu tai vanhentunut.',
      };
    }
    registerWatch(watch.id, watch.label);
    return {
      kind: 'watch',
      label: watch.label,
      entries: watch.entries,
      roster,
      watch,
      targets: roster ? watchTargets(watch.entries, roster) : null,
      notice: !watch.entries.some((e) => e.enabled)
        ? 'Seurannassa ei ole yhtään aktiivista urheilijaa tai seuraa.'
        : roster
          ? null
          : 'Urheilijoiden ja seurojen haku epäonnistui.',
    };
  }
  return null;
}

// The schedule view's filter row carries the chip and the watched/all toggle
// (docs/architecture.md, "The filter bar"). Home passes filterActive false and
// no track picker, so only the chip renders there.
function filterBar(compId, state, filter, filterActive, trackPick = null) {
  const bar = el('div', { class: 'filter-bar' });
  // Juoksut mode has no follow-lists (viewStateFor), so this slot picks
  // categories. The meet's track picker goes at the far end of the same row.
  if (SITE_MODE === 'juoksut') {
    const setCats = (c) => () => {
      setViewCats(compId, c);
      render();
    };
    bar.append(
      // The label is Ratalajit (RUN_CATEGORIES), as "Juoksut" names the mode.
      segControl('Näytä', [
        { label: 'Ratalajit', pressed: state.cats === 'run', onclick: setCats('run') },
        { label: 'Kaikki', pressed: state.cats === 'all', onclick: setCats('all') },
      ]),
    );
    if (trackPick) bar.append(trackPick);
    return bar;
  }
  if (state.focus) {
    // A person and a club get the same chip, and only the ×'s aria-label names
    // the kind.
    const club = state.focus.kind === 'club';
    bar.append(
      el(
        'span',
        { class: 'watch-chip filter-focus' },
        el('span', { class: 'watch-chip-prefix' }, 'Näytä:'),
        filter?.label || state.focus.name || (club ? 'Seura' : 'Urheilija'),
        el(
          'button',
          {
            class: 'watch-chip-remove',
            type: 'button',
            'aria-label': club ? 'Poista seuran valinta' : 'Poista urheilijan valinta',
            onclick: () => closeFocusFilter(compId),
          },
          '×',
        ),
      ),
    );
    bar.append(
      el(
        'button',
        {
          class: 'btn btn-secondary',
          onclick: () => copyAppLink(focusLink(compId, state.focus)),
        },
        'Jaa linkki',
      ),
    );
  } else {
    // The ▾ promises a menu, not a dialog (docs/style.md,
    // "A menu is not a dialog"). The menu opens at the chip (openMenu).
    const chip = el(
      'button',
      {
        class: 'btn btn-secondary',
        onclick: () => watchMenu(chip, compId, state, filter?.watch),
      },
      state.watchId ? filter?.label || 'Seuranta' : 'Ei seurantaa',
      ' ▾',
    );
    bar.append(chip);
  }
  if (filterActive) {
    // The toggle shows the quick-filter's own mode while one is set, and the
    // Watch's otherwise (compViewMode, lib/routes.js).
    const mode = compViewMode(state);
    const setMode = (m) => () => {
      setViewMode(compId, m);
      render();
    };
    bar.append(
      segControl('Näytä', [
        { label: 'Seuratut', pressed: mode === 'watched', onclick: setMode('watched') },
        { label: 'Koko päivä', pressed: mode === 'all', onclick: setMode('all') },
      ]),
    );
  }
  return bar;
}

// The chips form the rows ageChipRows gives. A row's first chip ticks the
// whole row. The others show only the age, so a row fits on a phone.
function ageChips(classAges, ages, go) {
  const lead = (label, row) => {
    const all = row.every((a) => ages.includes(a));
    return el(
      'button',
      {
        class: `chip chip-toggle aidat-chip-lead${all ? ' on' : ''}`,
        'aria-pressed': String(all),
        'aria-label': `${label}, kaikki`,
        onclick: () => go(all ? ages.filter((x) => !row.includes(x)) : [...new Set([...ages, ...row])]),
      },
      label,
    );
  };
  return el(
    'div',
    { class: 'aidat-chips no-print' },
    ageChipRows(classAges).map(({ label, ages: row }) =>
      el(
        'div',
        { class: 'aidat-chip-row' },
        lead(label, row),
        row.map((a) => {
          const on = ages.includes(a);
          return el(
            'button',
            {
              class: `chip chip-toggle${on ? ' on' : ''}`,
              'aria-pressed': String(on),
              'aria-label': ageChipLabel(a),
              onclick: () => go(on ? ages.filter((x) => x !== a) : [...ages, a]),
            },
            a === 0 ? 'yleinen' : String(a),
          );
        }),
      ),
    ),
  );
}

// --- The lists ---

// The picker waits this long after a keystroke before it searches (runSearch).
// The figure is a guess at a typist's pause between letters.
const SEARCH_DEBOUNCE_MS = 200;

// The link keeps the page's query string, which picks the mode on a dev host.
// There a link opened in the wrong mode falls back to home
// (docs/architecture.md, "The two modes").
async function copyAppLink(href, copied = 'Linkki kopioitu', prompt = 'Kopioi linkki:') {
  const url = new URL(href, location.origin);
  url.search = location.search;
  return copyText(url.href, copied, prompt);
}
// Each write sends the `updatedAt` of the record the caller loaded, and the
// Worker answers 409 if the stored one has changed (docs/backend.md,
// "Watches").
function putWatch(watchId, { editToken, label, entries, ifUpdatedAt }) {
  return fetchJson(`/api/watch/${watchId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ editToken, label, entries, ifUpdatedAt }),
  });
}

// The token goes in the body, as a query string would leave it in logs
// (docs/backend.md, "Watches").
function deleteWatch(watchId, editToken) {
  return fetchJson(`/api/watch/${watchId}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ editToken }),
  });
}

// The recipient lands on the meet the link was shared from
// (docs/architecture.md, "The route table").
function copyWatchLink(watchId, compId) {
  return copyAppLink(watchLink(watchId, compId));
}
// The token in this link can never be revoked (docs/backend.md, "Watches").
function copyWatchEditLink(watchId, compId, editToken) {
  return copyAppLink(watchLink(watchId, compId, editToken), 'Muokkauslinkki kopioitu', 'Kopioi muokkauslinkki:');
}
// The pairing link carries every list this device knows, with every token it
// holds (keyringLinkHash, lib/routes.js). The help sheet says not to share it.
function copyKeyringLink() {
  return copyAppLink(
    keyringLinkHash(
      watchRegistry().map((w) => ({
        watchId: w.watchId,
        editToken: watchEditToken(w.watchId) || null,
      })),
    ),
    'Siirtolinkki kopioitu',
    'Kopioi siirtolinkki:',
  );
}

// The Watch chip's menu picks a list and shows the picked list's actions under
// its row (docs/architecture.md, "The filter bar"). `viewKey` is a meet's id
// or HOME_VIEW_KEY. `watch` is the active record, where the view has one.
function watchMenu(anchor, viewKey, state, watch) {
  const compId = viewKey === HOME_VIEW_KEY ? null : viewKey;
  const pick = (watchId) => {
    setActiveFollow(watchId);
    closeTopLayer();
    render();
  };

  // Actions render only on the selected row, so `watch` is always their record.
  // Each stops its click from reaching the row, whose tap selects the list.
  const action = (label, onclick) =>
    el(
      'button',
      {
        class: 'menu-action',
        type: 'button',
        onclick: (e) => {
          e.stopPropagation();
          onclick();
        },
      },
      label,
    );

  // "Muokkaa" and the copy need the list's entries. Where the view has no
  // record, as on home, the tap fetches it. A failure shows on the button.
  const recordAction = (watchId, label, failed, onRecord) => {
    const btn = el(
      'button',
      {
        class: 'menu-action',
        type: 'button',
        onclick: async (e) => {
          e.stopPropagation();
          let w = watch;
          if (!w) {
            btn.disabled = true;
            btn.textContent = 'Ladataan…';
            w = await fetchJson(`/api/watch/${watchId}`).catch(() => null);
            if (!w) {
              btn.disabled = false;
              btn.textContent = failed;
              return;
            }
          }
          closeTopLayer();
          onRecord(w);
        },
      },
      label,
    );
    return btn;
  };

  const actionsFor = (watchId, label) => {
    const editToken = watchEditToken(watchId);
    const items = [
      editToken
        ? recordAction(watchId, 'Muokkaa', 'Muokkaus epäonnistui, yritä uudelleen', (w) =>
            openEditWatchSheet(w, watchId, editToken, compId),
          )
        : recordAction(watchId, 'Kopioi omaksi seurannaksi', 'Kopiointi epäonnistui, yritä uudelleen', (w) =>
            openCopyWatchSheet(viewKey, w),
          ),
      // A menu carries no prose, so each link's own name says which link it is
      // (docs/style.md, "A menu is not a dialog").
      action(editToken ? 'Jaa katselulinkki' : 'Jaa linkki', () => {
        closeTopLayer();
        copyWatchLink(watchId, compId);
      }),
      editToken
        ? action('Jaa muokkauslinkki', () => {
            closeTopLayer();
            copyWatchEditLink(watchId, compId, editToken);
          })
        : null,
      // Forgets the list on this device only (forgetWatch).
      action('Unohda tältä laitteelta', () => {
        forgetWatch(watchId);
        closeTopLayer();
        render();
      }),
      // This row comes last, as the only one that changes what others see.
      editToken
        ? action('Poista kaikilta', () => {
            closeTopLayer();
            openDeleteWatchSheet(watchId, label, editToken);
          })
        : null,
    ].filter(Boolean);
    // The actions stack one per line (dev/probe.js, "each action is on a line
    // of its own").
    return el('div', { class: 'menu-actions' }, items);
  };

  const pickRow = (label, watchId) => {
    const picked = state.watchId === watchId;
    return menuRow(picked ? '✓' : '', label, () => pick(watchId), picked ? actionsFor(watchId, label) : null);
  };

  const known = watchRegistry();
  openMenu(
    'Seuranta',
    anchor,
    el(
      'div',
      { class: 'list menu' },
      known.map((w) => pickRow(w.label || 'Seuranta', w.watchId)),
      menuRow(state.watchId ? '' : '✓', 'Ei seurantaa', () => pick(null)),
      menuRow('+', 'Uusi seuranta', () => {
        closeTopLayer();
        openCreateWatchSheet(viewKey);
      }),
      // The rows about all the lists at once act on no one list, so they go at
      // the foot, below every list (dev/probe.js).
      known.length
        ? menuRow('⇄', 'Siirrä toiseen laitteeseen', () => {
            closeTopLayer();
            copyKeyringLink();
          })
        : null,
      // Always offered, since an empty device is the one being set up.
      menuRow('⇤', 'Ota linkki käyttöön', () => {
        closeTopLayer();
        openPasteLinkSheet();
      }),
    ),
  );
}

// Takes a pasted link where there is no address bar, as in an app added to the
// home screen. It only navigates to the route pastedLink (lib/routes.js)
// returns, so a pasted link lands where the same link tapped would.
function openPasteLinkSheet() {
  const status = el(
    'div',
    { class: 'sheet-hint' },
    'Katselu-, muokkaus- tai siirtolinkki. Voit liittää koko viestin, jossa linkki on.',
  );
  const submit = () => {
    const link = pastedLink(input.value);
    if (!link) {
      status.textContent = 'Tästä ei löytynyt seurantalinkkiä. Kopioi linkki uudelleen ja liitä se kokonaan.';
      return;
    }
    // The sheet closes first, because closeTopLayer gives back its history
    // entry only while nothing has navigated. The replace keeps the used link
    // out of the back history.
    closeTopLayer();
    navigate(link, { replace: true });
  };
  const input = el('input', {
    class: 'search',
    type: 'text',
    placeholder: 'Liitä linkki tähän',
    // Stops a phone keyboard capitalising or correcting the link's ids.
    autocapitalize: 'none',
    autocorrect: 'off',
    spellcheck: 'false',
    onkeydown: (e) => {
      if (e.key === 'Enter') submit();
    },
  });
  openSheet(
    'Ota linkki käyttöön',
    el(
      'div',
      { class: 'watch-create' },
      input,
      status,
      el('button', { class: 'btn', onclick: submit }, 'Ota käyttöön'),
    ),
  );
}

// The sheet that creates, copies and edits a Watch searches GET /api/search
// (docs/backend.md, "The picker's search") and hands the picked entries to
// onSubmit. With `editing`, as in the edit and copy sheets, a picked entry's
// checkbox switches it off and on, and its × removes it for good.
function watchPickerSheet({
  title,
  compId,
  initialLabel = '',
  initialEntries = [],
  editing = false,
  submitLabel,
  onSubmit,
}) {
  let entries = initialEntries.map((e) => ({ ...e }));
  // `found` holds the Worker's last answer, which a pick re-renders without a
  // new request. `compId` only lists that meet's own entrants first.
  let found = { clubs: [], athletes: [] };
  let asked = 0;
  let timer = null;

  const labelInput = el('input', {
    class: 'search',
    type: 'text',
    placeholder: 'Seurannan nimi (esim. oma seura)',
    value: initialLabel,
  });
  const pickedEl = el('div', { class: 'watch-picks' });
  const search = el('input', {
    class: 'search',
    type: 'search',
    placeholder: 'Hae urheilijaa tai seuraa…',
    oninput: () => {
      clearTimeout(timer);
      timer = setTimeout(runSearch, SEARCH_DEBOUNCE_MS);
    },
  });
  const resultsEl = el('div', { class: 'list watch-search-results' });
  const status = el('div', { class: 'notice' });
  const submitBtn = el('button', { class: 'btn', onclick: submit }, submitLabel);

  function isPicked(type, id) {
    return entries.some((e) => e.type === type && e.id === id);
  }

  function renderPicked() {
    pickedEl.replaceChildren(
      ...entries.map((e) =>
        el(
          'span',
          { class: `watch-chip${e.enabled === false ? ' watch-chip-off' : ''}` },
          editing
            ? el(
                'label',
                { class: 'watch-chip-label' },
                el('input', {
                  type: 'checkbox',
                  checked: e.enabled !== false,
                  onchange: (ev) => {
                    e.enabled = ev.target.checked;
                    renderPicked();
                  },
                }),
                e.name || e.id,
              )
            : e.name || e.id,
          el(
            'button',
            {
              class: 'watch-chip-remove',
              type: 'button',
              'aria-label': 'Poista',
              onclick: () => {
                entries = entries.filter((x) => x !== e);
                renderPicked();
                renderResults();
              },
            },
            '×',
          ),
        ),
      ),
    );
  }

  function pickRow(type, id, name, sub) {
    const already = isPicked(type, id);
    return el(
      'div',
      {
        class: 'row',
        onclick: already
          ? null
          : () => {
              entries.push({ type, id, name, enabled: true });
              renderPicked();
              renderResults();
            },
      },
      el('div', { class: 'row-main' }, el('div', { class: 'row-title' }, name), el('div', { class: 'row-sub' }, sub)),
      already ? el('span', { class: 'chip' }, 'Lisätty') : null,
    );
  }

  function renderResults() {
    if (search.value.trim().length < SEARCH_MIN_CHARS) {
      resultsEl.replaceChildren(el('div', { class: 'notice' }, 'Kirjoita hakuun nimi.'));
      return;
    }
    const rows = [
      ...(found.clubs || []).map((c) => pickRow('club', String(c.id), c.name, 'Seura')),
      ...(found.athletes || []).map((a) => pickRow('athlete', String(a.licenseId), a.name, a.club)),
    ];
    resultsEl.replaceChildren(...(rows.length ? rows : [el('div', { class: 'notice' }, 'Ei osumia.')]));
  }

  // An answer to a query the reader has already typed past is dropped (`asked`).
  async function runSearch() {
    const q = search.value.trim();
    const mine = ++asked;
    if (q.length < SEARCH_MIN_CHARS) {
      found = { clubs: [], athletes: [] };
      renderResults();
      return;
    }
    let answer;
    try {
      answer = await fetchJson(
        `/api/search?q=${encodeURIComponent(q)}${compId ? `&comp=${encodeURIComponent(compId)}` : ''}`,
      );
    } catch {
      if (mine === asked) resultsEl.replaceChildren(el('div', { class: 'notice error' }, 'Haku epäonnistui.'));
      return;
    }
    if (mine !== asked) return;
    found = answer;
    renderResults();
  }

  // Swaps the label and entries under the reader after a save that came back
  // 409 (openEditWatchSheet). The caller then throws to keep the sheet open.
  function replace(nextLabel, nextEntries) {
    labelInput.value = nextLabel;
    entries = nextEntries.map((e) => ({ ...e }));
    renderPicked();
    renderResults();
  }

  async function submit() {
    status.textContent = '';
    status.classList.remove('error');
    if (!entries.length) {
      status.textContent = 'Valitse ainakin yksi urheilija tai seura.';
      status.classList.add('error');
      return;
    }
    submitBtn.disabled = true;
    try {
      await onSubmit({ label: labelInput.value, entries, replace });
      closeTopLayer();
    } catch (err) {
      status.textContent = String(err.message || err);
      status.classList.add('error');
      submitBtn.disabled = false;
    }
  }

  renderPicked();
  renderResults();
  openSheet(
    title,
    el('div', { class: 'watch-create' }, labelInput, pickedEl, search, resultsEl, status, submitBtn),
    '',
    () => clearTimeout(timer),
  );
}

// `viewKey` is a meet's id or HOME_VIEW_KEY. The athlete sheet's
// "Uusi seuranta" passes `initialEntries`, so the list opens with that person
// on it.
function openCreateWatchSheet(viewKey, initialEntries = []) {
  watchPickerSheet({
    title: 'Uusi seuranta',
    compId: viewKey === HOME_VIEW_KEY ? null : viewKey,
    initialEntries,
    submitLabel: 'Luo seuranta',
    onSubmit: (result) => createWatch(viewKey, result),
  });
}

// Makes somebody else's list this device's own. Its submit posts a new record
// with the same entries (createWatch), so the copy is independent from the
// start. `editing` is on
// because the entries keep the sharer's on and off switches.
function openCopyWatchSheet(viewKey, watch) {
  watchPickerSheet({
    title: 'Kopioi seuranta',
    compId: viewKey === HOME_VIEW_KEY ? null : viewKey,
    // The original stays in the menu, so the copy gets a name of its own.
    initialLabel: copyWatchLabel(
      watch.label,
      watchRegistry().map((w) => w.label),
    ),
    initialEntries: watch.entries,
    editing: true,
    submitLabel: 'Luo kopio',
    onSubmit: (result) => createWatch(viewKey, result),
  });
}

// Both the create and the copy sheet end here. It posts the list, keeps its
// token, registers it and makes it the active list on this device.
async function createWatch(viewKey, { label, entries }) {
  const watch = await fetchJson('/api/watch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label, entries }),
  });
  // Only the create response carries the token (worker.js), so it is kept now
  // or never.
  rememberWatchEditToken(watch.id, watch.editToken);
  registerWatch(watch.id, watch.label);
  setActiveFollow(watch.id);
  // The patch is keyed on the view, so on home it lands on home's own row.
  updateViewState(viewKey, { mode: 'watched', focus: null });
  render();
}

function openEditWatchSheet(watch, watchId, editToken, compId) {
  // `base` is the record the saves are checked against (putWatch). Each newer
  // record the sheet learns of replaces it, so a conflict is answered only once.
  let base = watch;
  watchPickerSheet({
    title: 'Muokkaa seurantaa',
    compId,
    initialLabel: watch.label,
    initialEntries: watch.entries,
    editing: true,
    submitLabel: 'Tallenna',
    onSubmit: async ({ label, entries, replace }) => {
      let updated;
      try {
        updated = await putWatch(watchId, { editToken, label, entries, ifUpdatedAt: base.updatedAt });
      } catch (err) {
        // A 403 means the stored token is wrong, as from a damaged edit link.
        // Dropping it stops the menu offering an edit that cannot save
        // (docs/backend.md, "Watches").
        if (err.status === 403) forgetWatchEditToken(watchId);
        if (err.status !== 409) throw err;
        // On a 409 the sheet takes in what arrived and names it, and a second
        // press then saves.
        const fresh = await fetchJson(`/api/watch/${watchId}`).catch(() => null);
        if (!fresh) throw err;
        const merged = watchConflictMerge(base, fresh, label, entries);
        replace(merged.label, merged.entries);
        base = fresh;
        throw new Error(
          merged.added.length
            ? `Listaa muutettiin toisaalla — lisätty: ${merged.added.map((e) => e.name || e.id).join(', ')}. Tarkista ja tallenna.`
            : 'Listaa muutettiin toisaalla. Tarkista ja tallenna.',
        );
      }
      registerWatch(watchId, updated.label);
      render(true);
    },
  });
}

// Deleting a list reaches every device and cannot be undone, so it asks first,
// in a dialog (docs/style.md, "A menu is not a dialog").
// A failure shows on the button.
function openDeleteWatchSheet(watchId, label, editToken) {
  const btn = el(
    'button',
    {
      class: 'btn',
      onclick: async () => {
        btn.disabled = true;
        btn.textContent = 'Poistetaan…';
        try {
          await deleteWatch(watchId, editToken);
        } catch (err) {
          // A 404 is the state that was asked for, so it counts as done
          // (docs/backend.md, "Watches").
          if (err.status !== 404) {
            // A 403 drops the token, which takes the edit actions off the menu.
            if (err.status === 403) forgetWatchEditToken(watchId);
            btn.textContent =
              err.status === 403 ? 'Muokkauslinkki ei kelpaa enää' : 'Poistaminen epäonnistui, yritä uudelleen';
            btn.disabled = err.status === 403;
            return;
          }
        }
        // Unlike "Unohda", this drops the token too, as nothing is left to edit.
        forgetWatchEditToken(watchId);
        forgetWatch(watchId);
        setFlash(`Seuranta "${label}" poistettu`);
        closeTopLayer();
        render();
      },
    },
    'Poista lopullisesti',
  );
  openSheet('Poista seuranta?', [
    el(
      'div',
      { class: 'help-text' },
      el(
        'p',
        {},
        `"${label}" poistuu lopullisesti — myös muilta laitteiltasi ja kaikilta, ` + 'joille olet jakanut linkin.',
      ),
      el('p', {}, 'Tätä ei voi perua. Muille seuranta näkyy kadonneena.'),
    ),
    btn,
    // The named way out beside the × undoes a mis-aimed tap.
    el('button', { class: 'btn btn-secondary', onclick: () => closeTopLayer() }, 'Peruuta'),
  ]);
}

// --- A list's link, opened ---

// Handles a Watch's share link (docs/architecture.md, "The route table"). It
// registers the list, makes it active, and replaces the URL with the meet the
// link names or with home. An edit token is stored only after the GET has found
// the Watch.
async function activateWatchLink(watchId, compId, editToken) {
  const seq = renderSeq;
  setBack('/');
  setHelp(null);

  let watch;
  try {
    watch = await fetchJson(`/api/watch/${watchId}`);
  } catch {
    if (seq !== renderSeq) return;
    titleEl.textContent = 'Seurantaa ei löytynyt';
    appEl.replaceChildren(
      el('div', { class: 'notice' }, 'Seurantaa ei löytynyt. Linkki voi olla väärä, tai seuranta on vanhentunut.'),
    );
    return;
  }
  if (seq !== renderSeq) return;
  registerWatch(watch.id, watch.label);
  setActiveFollow(watch.id);
  if (editToken) rememberWatchEditToken(watch.id, editToken);
  // No watchId here, because viewStateFor always takes it from activeFollow().
  if (compId) updateViewState(compId, { mode: 'watched', focus: null });
  // The message waits in flashMessage because the redirect's render rewrites
  // the status line. That line is one nowrap row, so it says only what the
  // landing page cannot show. On a meet the chip already names the list.
  const name = watch.label || 'Seuranta';
  if (compId) setFlash(editToken ? 'Voit muokata tätä seurantaa' : null);
  else setFlash(`Seuranta "${name}" otettu käyttöön${editToken ? ' — voit muokata' : ''}`);
  navigate(compId ? `/c/${compId}` : '/', { replace: true });
}

// Handles the pairing link (docs/architecture.md, "The route table"). Each list
// is fetched before it is registered, and one that does not answer is dropped.
// The first list becomes active only on a device that follows none yet.
async function activatePairLink(pairs) {
  const seq = renderSeq;
  setBack('/');
  setHelp(null);

  const found = (
    await Promise.all(
      pairs.map(async ({ watchId, editToken }) => {
        const watch = await fetchJson(`/api/watch/${watchId}`).catch(() => null);
        return watch ? { watch, editToken } : null;
      }),
    )
  ).filter(Boolean);
  if (seq !== renderSeq) return;

  if (!found.length) {
    titleEl.textContent = 'Seurantoja ei löytynyt';
    appEl.replaceChildren(
      el(
        'div',
        { class: 'notice' },
        'Yhtään seurantaa ei löytynyt. Linkki voi olla väärä, tai seurannat ovat vanhentuneet.',
      ),
    );
    return;
  }
  // Registered last-first, because watchRegistryAdd (lib/watch.js) puts each
  // at the front.
  for (const { watch, editToken } of [...found].reverse()) {
    registerWatch(watch.id, watch.label);
    if (editToken) rememberWatchEditToken(watch.id, editToken);
  }
  if (!activeFollow()) setActiveFollow(found[0].watch.id);
  setFlash(
    found.length === 1
      ? `Seuranta "${found[0].watch.label || 'Seuranta'}" otettu käyttöön`
      : `${found.length} seurantaa otettu käyttöön`,
  );
  navigate('/', { replace: true });
}

// Handles the quick-filter's share link for a person or a club
// (docs/architecture.md, "The route table"). A link outlives the meet it names,
// so an id missing from this meet's roster gets a notice and sets no filter.
async function activateFocusLink(compId, kind, id) {
  const seq = renderSeq;
  setBack('/');
  setHelp(null);

  const roster = await fetchJson(`/api/roster/${compId}`).catch(() => null);
  if (seq !== renderSeq) return;
  const found =
    kind === 'club'
      ? roster?.organizations?.find((o) => String(o.id) === id)
      : roster?.athletes.find((a) => String(a.id) === id);
  if (!found) {
    titleEl.textContent = kind === 'club' ? 'Seuraa ei löytynyt' : 'Urheilijaa ei löytynyt';
    appEl.replaceChildren(
      el(
        'div',
        { class: 'notice' },
        kind === 'club'
          ? 'Seuralla ei ole osallistujia tässä kilpailussa. Linkki voi olla väärä.'
          : 'Urheilijaa ei löytynyt kilpailun osallistujista. Linkki voi olla väärä.',
      ),
    );
    return;
  }
  updateViewState(compId, { focus: { kind, id: String(found.id), name: found.name, mode: 'watched' } });
  navigate(`/c/${compId}`, { replace: true });
}

// --- A name, and its sheet ---

// The deadline links to the portal only while it is ahead.
function confirmDeadline(compId, v, short = false) {
  const text = confirmCloses(v, (ts) => timeFmt.format(ts), short);
  return !text || v.closed
    ? text
    : el(
        'a',
        {
          href: `https://www.tuloslista.com/varmistus/#!/${compId}`,
          target: '_blank',
          rel: 'noopener',
        },
        text,
      );
}

// Lists a relay's runners and marks the one followed by name (relayLegParts,
// lib/results.js).
function relayLegEls(parts) {
  return parts.flatMap((p, i) => [
    i ? ', ' : null,
    p.followed ? el('span', { class: 'leg-followed' }, p.name) : p.name,
  ]);
}

// Returns the athlete id of a row that names exactly one athlete, and null
// otherwise. A relay team therefore gets no athlete link.
function soleAthleteId(a) {
  return a?.Athletes?.length === 1 ? String(a.Athletes[0].Id) : null;
}

// A tapped name opens the athlete sheet (docs/views.md,
// "The athlete and club sheets").
// With `nested` the name is a role=link span, because a day-list line sits
// inside its row's <a>. Otherwise its href is the quick-filter's link, which a
// long-press can copy.
function athleteNameLink(compId, athleteId, alloc, { nested = false, marks = [] } = {}) {
  const name = alloc?.Name || '';
  const open = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openAthleteSheet(compId, athleteId, alloc, marks);
  };
  const attrs = { class: 'athlete-link', onclick: open };
  if (!nested) return el('a', { ...attrs, href: focusLink(compId, { kind: 'athlete', id: athleteId }) }, name);
  return el(
    'span',
    {
      ...attrs,
      role: 'link',
      tabindex: '0',
      onkeydown: (e) => {
        if (e.key === 'Enter') open(e);
      },
    },
    name,
  );
}

// A tapped club opens the club sheet (docs/views.md,
// "The athlete and club sheets"). Id 0 (docs/tuloslista-api.md,
// "Categories, names and identity") and Juoksut mode (docs/juoksut.md) get
// plain text. `nested` works as in
// athleteNameLink. `text` is what the caller draws, such as the day list's
// NameShort.
function clubNameLink(compId, org, text, { nested = false } = {}) {
  if (!text || !compId || SITE_MODE === 'juoksut' || !isFollowableOrgId(org?.Id)) return text;
  const name = org.Name || org.NameShort || String(text);
  const id = String(org.Id);
  const open = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openClubSheet(compId, id, name);
  };
  const attrs = { class: 'club-link', onclick: open };
  if (!nested) return el('a', { ...attrs, href: focusLink(compId, { kind: 'club', id }) }, text);
  return el(
    'span',
    {
      ...attrs,
      role: 'link',
      tabindex: '0',
      onkeydown: (e) => {
        if (e.key === 'Enter') open(e);
      },
    },
    text,
  );
}

// Opens the club sheet for a tapped club name (docs/views.md,
// "The athlete and club sheets").
function openClubSheet(compId, orgId, name) {
  openSheet(
    name,
    el(
      'div',
      { class: 'club-sheet' },
      ...clubActions(compId, orgId, name),
      // The cup link shows only when the last meet body fetched was a cup meet
      // (cupMeetSeen).
      cupMeetSeen === compId
        ? el(
            'button',
            {
              class: 'btn btn-secondary',
              onclick: () => {
                closeTopLayer();
                navigate(cupPath(compId, orgId), { replace: true });
              },
            },
            'Näytä seuran Seuracup-pisteet',
          )
        : null,
    ),
  );
}

function clubActions(compId, orgId, name) {
  const entry = { type: 'club', id: orgId, name, enabled: true };
  const add = el(
    'button',
    {
      class: 'btn',
      onclick: () => addToWatchMenu(add, compId, entry),
    },
    'Lisää seurantaan ▾',
  );
  return [
    add,
    el(
      'button',
      {
        class: 'btn btn-secondary',
        onclick: () => {
          closeTopLayer();
          openFocusFilter(compId, { kind: 'club', id: orgId, name });
        },
      },
      'Näytä seuran kaikki lajit',
    ),
  ];
}

// The sheet a tapped name opens costs no fetch (athleteCard, lib/results.js;
// docs/views.md, "The athlete and club sheets"). "Näytä kaikki lajit" closes
// the sheet first, so the filter layer takes over its history entry
// (openLayer).
function openAthleteSheet(compId, athleteId, alloc, marks) {
  const card = athleteCard(alloc, marks);
  const meta = [card.club, card.bib ? `Nro ${card.bib}` : null].filter(Boolean).join(' · ');
  openSheet(
    card.name,
    el(
      'div',
      { class: 'athlete-sheet' },
      meta ? el('div', { class: 'sheet-hint' }, meta) : null,
      card.marks.length
        ? el(
            'div',
            { class: 'athlete-marks' },
            card.marks.map((m) =>
              el(
                'div',
                { class: 'athlete-mark' },
                el('span', { class: 'athlete-mark-round' }, m.label),
                el('span', { class: 'athlete-mark-result' }, m.result),
              ),
            ),
          )
        : null,
      addToWatchButton(compId, athleteId),
      el(
        'button',
        {
          class: 'btn btn-secondary',
          onclick: () => {
            closeTopLayer();
            openFocusFilter(compId, { kind: 'athlete', id: athleteId, name: card.name });
          },
        },
        'Näytä kaikki lajit',
      ),
    ),
  );
}

// The add button fetches the roster when tapped, because a Watch entry stores
// the licence and the row does not carry it (watchEntryForAthlete,
// lib/watch.js). A failed fetch, or a person with no licence, is reported on
// the button.
function addToWatchButton(compId, athleteId) {
  const label = 'Lisää seurantaan ▾';
  const btn = el(
    'button',
    {
      class: 'btn',
      onclick: async () => {
        btn.disabled = true;
        btn.textContent = 'Ladataan…';
        const roster = await fetchJson(`/api/roster/${compId}`).catch(() => null);
        btn.disabled = false;
        const entry = roster ? watchEntryForAthlete(roster, athleteId) : null;
        if (!entry) {
          btn.textContent = roster ? 'Tätä urheilijaa ei voi seurata' : 'Haku epäonnistui, yritä uudelleen';
          return;
        }
        btn.textContent = label;
        addToWatchMenu(btn, compId, entry);
      },
    },
    label,
  );
  return btn;
}

// Opens the menu that picks the list the entry goes into (docs/views.md,
// "The athlete and club sheets"). It offers only the lists this device holds
// an editToken for. Only the active list can show a tick (activeWatchSeen).
function addToWatchMenu(anchor, compId, entry) {
  const editable = watchRegistry().filter((w) => watchEditToken(w.watchId));
  const seen = activeWatchSeen?.id === activeFollow() ? activeWatchSeen : null;
  openMenu(
    'Lisää seurantaan',
    anchor,
    el(
      'div',
      { class: 'list menu' },
      editable.map((w) => {
        const on = seen?.id === w.watchId && !watchEntriesWith(seen.entries, entry).changed;
        const row = menuRow(on ? '✓' : '', w.label || 'Seuranta', () =>
          addToWatch(w.watchId, entry, (text) => {
            row.querySelector('.row-title').textContent = text;
          }),
        );
        return row;
      }),
      menuRow('+', 'Uusi seuranta', () => {
        // This closes both the menu and the sheet under it. The create sheet then
        // takes over their history entry (openLayer).
        closeTopLayer();
        closeTopLayer();
        openCreateWatchSheet(compId, [entry]);
      }),
    ),
  );
}

// Adds the entry by fetching the Watch, merging and PUTting it back, because a
// Watch's PUT takes the whole entries array (docs/views.md,
// "The athlete and club sheets"). `say` reports into the tapped row. A 403
// drops the edit token, as openEditWatchSheet does.
async function addToWatch(watchId, entry, say) {
  const editToken = watchEditToken(watchId);
  say('Lisätään…');
  // A 409 is retried once. A second one within seconds means something is wrong.
  let updated;
  for (let attempt = 0; ; attempt++) {
    const watch = await fetchJson(`/api/watch/${watchId}`).catch(() => null);
    if (!watch) {
      say('Haku epäonnistui, yritä uudelleen');
      return;
    }
    const merged = watchEntriesWith(watch.entries, entry);
    if (!merged.changed) {
      addDone(watchId, watch.label, 'Jo seurannassa');
      return;
    }
    try {
      updated = await putWatch(watchId, {
        editToken,
        label: watch.label,
        entries: merged.entries,
        ifUpdatedAt: watch.updatedAt,
      });
      break;
    } catch (err) {
      if (err.status === 409 && attempt === 0) continue;
      if (err.status === 403) forgetWatchEditToken(watchId);
      say(err.status === 403 ? 'Muokkauslinkki ei kelpaa enää' : 'Lisääminen epäonnistui, yritä uudelleen');
      return;
    }
  }
  addDone(watchId, updated.label, 'Lisätty seurantaan');
}

// Closes the menu and the sheet. The status line names the list through the
// flash an activation link uses, since a render paints over a plain one. The
// render also shows the added person when this list is the active one.
function addDone(watchId, label, said) {
  registerWatch(watchId, label);
  setFlash(`${said} "${label || 'Seuranta'}"`);
  closeTopLayer();
  closeTopLayer();
  render(true);
}

// Draws the Q or q after a qualifier's result (qualBadge, lib/results.js). Pass
// `round` wherever it is at hand: it mutes a q that still stands (qualPending)
// and finds a tied qualifier. Without it only the API's own flags show.
function qualBadgeEl(a, round) {
  const q = qualBadge(a, round);
  if (!q) return null;
  const pending = q === 'q' && qualPending(round);
  return el('span', { class: pending ? 'q-badge q-badge-pending' : 'q-badge' }, ` ${q}`);
}

// --- The championships a page counts ---

// A scope's name on a row. A piiri's short name follows its name, muted.
function scopeTitle(scope) {
  return scope.kind === 'maa'
    ? scope.name
    : scope.kind === 'alue'
      ? scope.short
      : [scope.name, ' ', el('span', { class: 'scope-short' }, scope.short)];
}

const SCOPES_SHEET_TITLE = 'SM-, alue- ja piirinmestaruudet';

// Opens the sheet that picks which championships the meet counts as
// (docs/views.md, "Medals"). A tap stores the choice in the meet's
// view state (updateViewState) and redraws.
async function openPiiriSheet(compId) {
  const list = el('div', { class: 'list menu' }, el('div', { class: 'notice' }, 'Haetaan…'));
  openSheet(
    SCOPES_SHEET_TITLE,
    el(
      'div',
      { class: 'scope-sheet' },
      el('div', { class: 'sheet-hint' }, 'Suomi, alueet ja piirit, joiden erilliset mestaruuskilpailut nämä ovat.'),
      list,
    ),
  );
  const [fetched, districts] = await Promise.all([
    fetchJson(`/api/medals/${compId}`).catch(() => null),
    loadDistricts(compId),
  ]);
  const body = districts ? fetched : null;
  const scopes = body?.scopes || [];
  if (body) piiriDefaults.set(compId, body.defaults || []);
  const rows = () => {
    const stored = viewStateFor(compId).scopes;
    const ticked = tickedScopes(stored, body.defaults).filter((t) => scopes.some((p) => p.id === t.id));
    const store = (next) => {
      updateViewState(compId, { scopes: next });
      list.replaceChildren(...rows());
      render();
    };
    // Reads the stored scopes again, as a cover sheet calls set more than once.
    const set = (ids, changed = null) =>
      store(
        ids.map((id) =>
          changed?.id === id
            ? changed
            : ((viewStateFor(compId).scopes || []).find((s) => s.id === id) ?? { id, cover: null }),
        ),
      );
    const ids = ticked.map((t) => t.id);
    return [
      menuRow(stored ? '' : '✓', 'Automaattinen', () => store(null)),
      menuRow(stored && !ids.length ? '✓' : '', 'Ei valintaa', () => set([])),
      ...scopeTree(
        districts,
        scopes.map((p) => p.id),
      )
        .flatMap((t) => [t.alue, ...t.piirit])
        .map((s) => {
          const p = scopes.find((x) => x.id === s.id);
          if (!p) return null;
          const t = ticked.find((x) => x.id === p.id);
          const row = menuRow(
            t ? '✓' : '',
            scopeTitle(p),
            () => set(t ? ids.filter((id) => id !== p.id) : [...ids, p.id]),
            t
              ? el(
                  'div',
                  { class: 'menu-actions' },
                  el(
                    'button',
                    {
                      class: 'menu-action',
                      type: 'button',
                      onclick: (e) => {
                        e.stopPropagation();
                        openCoverSheet(compId, p, t.cover, (cover) => set(ids, { id: p.id, cover }));
                      },
                    },
                    coverWords(t.cover),
                  ),
                )
              : null,
          );
          if (p.kind === 'piiri') row.classList.add('scope-piiri');
          return row;
        })
        .filter(Boolean),
    ];
  };
  list.replaceChildren(
    ...(!body
      ? [el('div', { class: 'notice error' }, 'Piirien haku epäonnistui.')]
      : scopes.length
        ? rows()
        : [el('div', { class: 'notice' }, 'Kilpailun seuroista ei ole piiritietoa.')]),
  );
}

// Opens the sheet that sets which of the meet's classes and events a scope's
// championship covers (meetCoverChoices). A cover that names none ticks them
// all (coverTicks), and a fully ticked list is stored as null (coverOfTicks).
async function openCoverSheet(compId, scope, cover, onChange) {
  const body = el('div', {}, el('div', { class: 'notice' }, 'Haetaan…'));
  openSheet(scope.short, body);
  const schedule = await fetchSchedule(compId).catch(() => null);
  if (!schedule) {
    body.replaceChildren(el('div', { class: 'notice error' }, 'Aikataulun haku epäonnistui.'));
    return;
  }
  const choices = meetCoverChoices(schedule);
  const draw = () => {
    const ticks = coverTicks(cover, choices);
    const put = (next) => {
      cover = coverOfTicks(next, choices);
      onChange(cover);
      draw();
    };
    const toggle = (list, x) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
    body.replaceChildren(
      el(
        'div',
        { class: 'cover-chips' },
        choices.ages.map((a) => {
          const on = ticks.ages.includes(a);
          return el(
            'button',
            {
              class: `chip chip-toggle${on ? ' on' : ''}`,
              'aria-pressed': String(on),
              onclick: () => put({ ...ticks, ages: toggle(ticks.ages, a) }),
            },
            a === 0 ? 'yleinen' : String(a),
          );
        }),
      ),
      el(
        'div',
        { class: 'list menu' },
        choices.events.map((e) =>
          menuRow(ticks.events.includes(e) ? '✓' : '', e, () => put({ ...ticks, events: toggle(ticks.events, e) })),
        ),
      ),
    );
  };
  draw();
}

export {
  SCOPES_SHEET_TITLE,
  activateFocusLink,
  activatePairLink,
  activateWatchLink,
  ageChips,
  athleteNameLink,
  closeFocusFilter,
  clubNameLink,
  confirmDeadline,
  copyAppLink,
  filterBar,
  openPiiriSheet,
  qualBadgeEl,
  relayLegEls,
  resolveFilter,
  scopeTitle,
  soleAthleteId,
};
