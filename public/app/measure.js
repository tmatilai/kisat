import { RENDER_LOG_RECENT, msText, renderLogTsv, renderStats } from '../lib/render-log.js';
import { renderLog, writeStore } from './data.js';
import { appEl, clockFmt, copyText, el, render, setBack, setScrollKey, titleEl } from './shell.js';

// --- The render cost page (/#/measure) ---

// The render-cost page (docs/architecture.md, "What a render cost") is a
// fragment that nothing links to, so a bookmark reaches it.
function renderMeasure() {
  setBack(`/${location.search}#/`);
  titleEl.textContent = 'Measure';
  setScrollKey('measure');
  const log = renderLog();
  const stats = renderStats(log);
  if (!stats.length) {
    appEl.replaceChildren(el('div', { class: 'notice' }, 'Nothing measured yet. Use the app and come back.'));
    return;
  }
  const cell = (n, worst) => `${msText(n)} (${msText(worst)})`;
  const table = el(
    'div',
    { class: 'tbl-wrap' },
    el(
      'table',
      { class: 'tbl measure' },
      el(
        'thead',
        {},
        el('tr', {}, el('th', {}, 'View'), el('th', {}, 'Renders'), el('th', {}, 'Time'), el('th', {}, 'Requests')),
      ),
      el(
        'tbody',
        {},
        stats.map((v) =>
          el(
            'tr',
            {},
            el('td', {}, v.view),
            el('td', {}, String(v.renders)),
            el('td', {}, cell(v.ms, v.msWorst)),
            el('td', {}, `${v.fetches} (${v.fetchesWorst})`),
          ),
        ),
      ),
    ),
  );
  const recent = el(
    'div',
    { class: 'tbl-wrap' },
    el(
      'table',
      { class: 'tbl measure' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', {}, 'Clock'),
          el('th', {}, 'View'),
          el('th', {}, 'Time'),
          el('th', {}, 'Requests'),
          el('th', {}, 'Slowest'),
        ),
      ),
      el(
        'tbody',
        {},
        log
          .slice(0, RENDER_LOG_RECENT)
          .map((r) =>
            el(
              'tr',
              {},
              el('td', {}, clockFmt.format(r.at)),
              el('td', {}, r.refresh ? `${r.view} (refresh)` : r.view),
              el('td', {}, msText(r.ms)),
              el('td', {}, String(r.fetches)),
              el('td', {}, r.fetches ? msText(r.fetchMs) : ''),
            ),
          ),
      ),
    ),
  );
  appEl.replaceChildren(
    el(
      'div',
      { class: 'notice' },
      `Median, worst in brackets. ${log.length} renders, on this device only — nothing is sent.`,
    ),
    el('h2', {}, 'Views'),
    table,
    el('h2', {}, `Last ${Math.min(log.length, RENDER_LOG_RECENT)}`),
    recent,
    el(
      'div',
      { class: 'filter-bar' },
      el(
        'button',
        {
          class: 'btn btn-secondary',
          onclick: () => copyText(renderLogTsv(log), 'Copied', 'Copy:'),
        },
        'Copy',
      ),
      el(
        'button',
        {
          class: 'btn btn-secondary',
          onclick: () => {
            writeStore('kisatRenderLog', []);
            render();
          },
        },
        'Clear',
      ),
    ),
  );
}

export { renderMeasure };
