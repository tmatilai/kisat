import { TABLE_PAGE_TITLE, TABLE_TABS, tablePageHash } from '../lib/routes.js';
import {
  hurdleTableSections,
  implementDimText,
  implementTableSections,
  implementWeightRows,
  implementWeightText,
  tableClassAges,
  tableClassName,
  tablePageSheet,
} from '../lib/tables.js';
import { venueFullName, venueGroups, venueTable } from '../lib/venues.js';
import { fetchJson } from './data.js';
import { ageChips } from './follow.js';
import {
  hurdleSettingRow,
  hurdleTapeFigure,
  loadHurdleTable,
  loadVenue,
  loadVenues,
  setupHeadRow,
  sheetFigures,
  shuttleFigure,
  shuttleSettingRows,
  steepleSettingRow,
} from './hurdles.js';
import {
  SITE_NAME,
  appEl,
  el,
  navigate,
  render,
  renderSeq,
  setBack,
  setHelp,
  setScrollKey,
  setTitleMenu,
} from './shell.js';

// --- The table page and its two tabs (TABLE_PAGE_PATH, lib/routes.js) ---

const TABLE_PAGE_HELP = {
  title: TABLE_PAGE_TITLE,
  items: [
    ['Sarjat', 'Valitse sarjat, jotka haluat nähdä. Ilman valintaa näytetään kaikki.'],
    ['Aidat-välilehdellä'],
    [
      'Kenttä',
      'Sisä- ja ulkoradoilla on omat taulukkonsa. Valitulle kentälle näytetään vain sen omat ratamerkinnät ja matkat.',
    ],
    ['Aitakuvat', 'Näyttää aitojen paikat kuvana, jos ratamerkintää ei ole.'],
    ['Heittovälineet-välilehdellä'],
    ['Kaikki mitat', 'Näyttää välineiden kaikki mitat.'],
  ],
};

function tablePageSwitch(tab, ages, venueId) {
  return el(
    'div',
    { class: 'seg table-switch no-print', role: 'group', 'aria-label': 'Taulukko' },
    Object.entries(TABLE_TABS).map(([t, label]) =>
      el(
        'a',
        {
          class: 'seg-btn',
          href: tablePageHash(t, ages, venueId),
          'aria-current': t === tab ? 'page' : null,
        },
        label,
      ),
    ),
  );
}

// Paper shows no chips or select, so the printed heading names the chosen
// classes and the kenttä.
function tablePageHeading(gender, ages, extra = null) {
  return el(
    'h2',
    {},
    HURDLE_GROUP_TITLES[gender],
    el(
      'span',
      { class: 'aidat-print' },
      [ages.length ? ages.map((a) => tableClassName(gender, a)).join(', ') : null, extra]
        .filter(Boolean)
        .map((t) => ` · ${t}`)
        .join(''),
    ),
  );
}

// Starts a tab of the table page and loads its files, the tab's own first.
// It returns null when the render is stale, or when the first file did not
// load and the page shows `failed`.
async function openTablePage(tab, failed, loads) {
  const seq = renderSeq;
  setBack(`/${location.search}#/`);
  setTitleMenu(TABLE_PAGE_TITLE, [{ label: SITE_NAME, href: `/${location.search}#/` }]);
  setScrollKey(tab);
  const files = await Promise.all(loads);
  if (seq !== renderSeq) return null;
  if (!files[0]) {
    appEl.replaceChildren(el('div', { class: 'notice error' }, failed));
    return null;
  }
  setHelp(TABLE_PAGE_HELP);
  return files;
}

// Builds one of the table page's tables. `cls` adds the tab's own class.
function tablePageTable(cls, ...kids) {
  return el(
    'div',
    { class: 'tbl-wrap' },
    el('table', { class: `tbl setup-tbl aidat-tbl aidat-all${cls ? ` ${cls}` : ''}` }, ...kids),
  );
}

// --- The hurdle table ---

const HURDLE_GROUP_TITLES = { Female: 'Tytöt ja naiset', Male: 'Pojat ja miehet' };

// Whether the table page draws the individual settings' taping figures. They
// are off until chosen, and the choice lasts until the page reloads. The
// relays always draw theirs.
let hurdleTableFigures = false;

async function renderHurdleTable({ ages, venueId, open }) {
  const pick = venueId || '';
  const sheetNames = { ulkoradat: 'Ulkoradat', sisaradat: 'Sisäradat' };
  const files = await openTablePage('aidat', 'Aitataulukot eivät latautuneet.', [
    loadHurdleTable(),
    loadImplementTable(),
    loadVenues(),
    pick && !tablePageSheet(pick) ? loadVenue(pick) : null,
  ]);
  if (!files) return;
  const [table, implTable, venues, venue] = files;
  const entry = venues.find((v) => v.id === pick) || null;
  const sheet = tablePageSheet(pick, entry);
  // The select and the printed heading already name the kenttä, so the table
  // rows do not repeat it.
  const vtable = venueTable(table, venue);
  const venueName = venueFullName(entry);
  const sections = hurdleTableSections(
    { ...vtable, marks: vtable.marks.map((m) => ({ ...m, venue: false })) },
    ages,
    sheet,
    entry?.length ?? null,
  );
  const go = (nextAges, nextVenue = venueId) => {
    navigate(tablePageHash('aidat', nextAges, nextVenue, open), { redraw: true });
  };
  const chips = ageChips(tableClassAges(table, implTable), ages, go);
  const sel = el(
    'select',
    {
      'aria-label': 'Kenttä',
      onchange: () => go(ages, sel.value.startsWith('v:') ? sel.value.slice(2) : sel.value || null),
    },
    el(
      'optgroup',
      { label: 'Yleiset' },
      el('option', { value: '' }, 'Kaikki'),
      Object.entries(sheetNames).map(([v, name]) => el('option', { value: v }, name)),
    ),
    venueGroups(venues).map((g) =>
      el(
        'optgroup',
        { label: g.locality },
        g.venues.map((v) => el('option', { value: `v:${v.id}` }, v.name)),
      ),
    ),
  );
  sel.value = entry ? `v:${entry.id}` : sheet ? pick : '';
  const figureChip = el(
    'button',
    {
      class: `chip chip-toggle aidat-figures${hurdleTableFigures ? ' on' : ''}`,
      'aria-pressed': String(hurdleTableFigures),
      onclick: () => {
        hurdleTableFigures = !hurdleTableFigures;
        render();
      },
    },
    'Aitakuvat',
  );
  const bar = el(
    'div',
    { class: 'filter-bar no-print' },
    tablePageSwitch('aidat', ages, venueId),
    figureChip,
    el('label', { class: 'track-pick' }, sel),
  );

  let flip = false;
  const figures = sheetFigures(
    () => flip,
    () => {
      flip = !flip;
    },
  );
  const caption = (names) => el('div', { class: 'shuttle-legend' }, names.join(', '));
  const titleRow = (text) => el('tr', { class: 'aidat-title' }, el('th', { colspan: '5', scope: 'rowgroup' }, text));

  const pages = sections.hurdles.map((s) =>
    el(
      'section',
      { class: 'aidat-page' },
      tablePageHeading(s.gender, ages, venueName || sheetNames[pick]),
      s.distances.length
        ? tablePageTable(
            null,
            el('thead', {}, setupHeadRow('Sarja')),
            s.distances.map((d) =>
              el(
                'tbody',
                {},
                titleRow(`${d.distance} m aidat`),
                d.rows.map((r) => hurdleSettingRow(false, r, venueName, false)),
                hurdleTableFigures
                  ? d.figures.map((f) =>
                      figures.row((fl, fn) => [caption(f.categories), hurdleTapeFigure(d.distance, f.tapes, fl, fn)]),
                    )
                  : null,
              ),
            ),
          )
        : el('div', { class: 'notice' }, 'Ei sarjoja.'),
    ),
  );

  const relays =
    sections.relays.length &&
    el(
      'details',
      { class: 'fold hurdles aidat-extra', open: open === 'viestit' },
      el('summary', {}, 'Aitaviestit'),
      tablePageTable(
        null,
        el('thead', {}, setupHeadRow('Sarja')),
        sections.relays.map((d) =>
          el(
            'tbody',
            {},
            titleRow(`4x${d.distance} m aitaviesti`),
            d.groups.flatMap((g) => {
              const rows = g.rows.map((r) => ({ ...r, categories: g.categories, lanes: [] }));
              const { lead, trs } = shuttleSettingRows(rows, [], venueName, true);
              // Only the mixed relay's group has a title. Its rows start with
              // the legs, so it gets a header row of its own.
              return g.title ? [titleRow(g.title), setupHeadRow(lead), ...trs] : trs;
            }),
            d.figures.map((f) =>
              figures.row((fl, fn) => [
                caption(f.categories),
                ...shuttleFigure({ distance: d.distance, rows: f.rows, tapes: f.tapes }, fl, fn),
              ]),
            ),
          ),
        ),
      ),
    );

  const steeples =
    sections.steeples.length &&
    el(
      'details',
      { class: 'fold hurdles aidat-extra', open: open === 'esteet' },
      el('summary', {}, 'Esteet'),
      tablePageTable(
        null,
        el('thead', {}, setupHeadRow('Sarja', true)),
        el('tbody', {}, sections.steeples.map(steepleSettingRow)),
      ),
    );

  appEl.replaceChildren(chips, bar, ...pages, ...[relays, steeples].filter(Boolean));
}

// --- The implement table ---

// The `Kaikki mitat` chip toggles this. The choice lasts until the page
// reloads.
let implementTableDims = false;

let implementTable = null;
async function loadImplementTable() {
  if (!implementTable) implementTable = await fetchJson('/data/implements.json').catch(() => null);
  return implementTable;
}

// Renders the federations' implement table (docs/implements.md).
async function renderImplementTable({ ages, venueId }) {
  const files = await openTablePage('valineet', 'Välinetaulukot eivät latautuneet.', [
    loadImplementTable(),
    loadHurdleTable(),
  ]);
  if (!files) return;
  const [table, hurdles] = files;
  // This tab ignores the kenttä. The link keeps it for the switch back to Aidat.
  const go = (nextAges) => {
    navigate(tablePageHash('valineet', nextAges, venueId), { redraw: true });
  };
  const dimsChip = el(
    'button',
    {
      class: `chip chip-toggle valineet-dims${implementTableDims ? ' on' : ''}`,
      'aria-pressed': String(implementTableDims),
      onclick: () => {
        implementTableDims = !implementTableDims;
        render();
      },
    },
    'Kaikki mitat',
  );
  const catsCell = (categories) => el('td', {}, el('span', { class: 'hurdle-cats-cell' }, categories.join(', ')));
  const weightPages = implementWeightRows(table, ages).map((s) =>
    el(
      'section',
      { class: 'aidat-page' },
      tablePageHeading(s.gender, ages),
      s.rows.length
        ? tablePageTable(
            'valineet-tbl',
            el(
              'thead',
              {},
              el(
                'tr',
                { class: 'setup-cols' },
                el('th', {}, 'Sarja'),
                s.columns.map((c) => el('th', { class: 'num' }, c.name)),
              ),
            ),
            el(
              'tbody',
              {},
              s.rows.map((r) =>
                el(
                  'tr',
                  {},
                  catsCell(r.categories),
                  s.columns.map((c) =>
                    el('td', { class: 'num' }, r.weights[c.id] == null ? '–' : implementWeightText(r.weights[c.id])),
                  ),
                ),
              ),
            ),
          )
        : el('div', { class: 'notice' }, 'Ei sarjoja.'),
    ),
  );
  const dimPages = () =>
    implementTableSections(table, ages).map((s) =>
      el(
        'section',
        { class: 'aidat-page' },
        tablePageHeading(s.gender, ages),
        s.implements.length
          ? s.implements.map((i) =>
              tablePageTable(
                'valineet-tbl',
                el(
                  'thead',
                  {},
                  el(
                    'tr',
                    { class: 'aidat-title' },
                    el('th', { colspan: String(i.columns.length + 2), scope: 'colgroup' }, i.name),
                  ),
                  el(
                    'tr',
                    { class: 'setup-cols' },
                    el('th', {}, 'Sarja'),
                    el('th', { class: 'num' }, 'Paino'),
                    i.columns.map((c) => el('th', { class: 'num' }, `${c.label} (${c.unit})`)),
                  ),
                ),
                el(
                  'tbody',
                  {},
                  i.rows.map((r) =>
                    el(
                      'tr',
                      {},
                      catsCell(r.categories),
                      el('td', { class: 'num' }, implementWeightText(r.weight)),
                      i.columns.map((c) => el('td', { class: 'num' }, implementDimText(r.spec?.[c.key]))),
                    ),
                  ),
                ),
              ),
            )
          : el('div', { class: 'notice' }, 'Ei sarjoja.'),
      ),
    );
  appEl.replaceChildren(
    ageChips(tableClassAges(hurdles, table), ages, go),
    el('div', { class: 'filter-bar no-print' }, tablePageSwitch('valineet', ages, venueId), dimsChip),
    ...(implementTableDims ? dimPages() : weightPages),
  );
}

export { renderHurdleTable, renderImplementTable };
