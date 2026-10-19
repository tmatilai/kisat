// --- What a render cost (docs/architecture.md) ---

// The log is kept on the device, so a meet's renders can be read the evening
// after it. It is derived data: a change of shape bumps the storage key, with
// no shim.
const RENDER_LOG_MAX = 300;
// The page lists this many one by one. Its summary is over all of them.
const RENDER_LOG_RECENT = 20;

function logRender(log, row) {
  return [row, ...(Array.isArray(log) ? log : [])].slice(0, RENDER_LOG_MAX);
}

// A stored log, or garbage, becomes the one shape the page reads.
function normalizeRenderLog(log) {
  return (Array.isArray(log) ? log : [])
    .filter((r) => r && typeof r.view === 'string' && Number.isFinite(r.ms) && Number.isFinite(r.fetches))
    .map((r) => ({
      view: r.view,
      refresh: r.refresh === true,
      at: Number.isFinite(r.at) ? r.at : 0,
      ms: r.ms,
      fetches: r.fetches,
      fetchMs: Number.isFinite(r.fetchMs) ? r.fetchMs : 0,
    }))
    .slice(0, RENDER_LOG_MAX);
}

// Returns the log as tab-separated rows for a spreadsheet, newest first. No
// view name holds a tab, so nothing needs quoting.
function renderLogTsv(log) {
  const rows = (log || []).map((r) =>
    [new Date(r.at).toISOString(), r.view, r.refresh ? 1 : 0, Math.round(r.ms), r.fetches, Math.round(r.fetchMs)].join(
      '\t',
    ),
  );
  return ['time\tview\trefresh\tms\trequests\tslowest_ms', ...rows].join('\n');
}

// Takes a median, as over a handful of renders one cold open would dominate a
// mean.
function median(ns) {
  const sorted = [...ns].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0;
}

// Returns a row per view, worst first. A refresh is counted apart from an
// open, because it re-renders a view already on screen over documents the
// render before it may have fetched.
function renderStats(log) {
  const byView = new Map();
  for (const r of log || []) {
    const key = `${r.view}${r.refresh ? ' (refresh)' : ''}`;
    if (!byView.has(key)) byView.set(key, { view: key, ms: [], fetches: [] });
    const v = byView.get(key);
    v.ms.push(r.ms);
    v.fetches.push(r.fetches);
  }
  return [...byView.values()]
    .map((v) => ({
      view: v.view,
      renders: v.ms.length,
      ms: median(v.ms),
      msWorst: Math.max(...v.ms),
      fetches: median(v.fetches),
      fetchesWorst: Math.max(...v.fetches),
    }))
    .sort((a, b) => b.msWorst - a.msWorst);
}

function msText(ms) {
  const n = Math.round(Number(ms) || 0);
  return n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1).replace('.', ',')} s`;
}

export { RENDER_LOG_MAX, RENDER_LOG_RECENT, logRender, msText, normalizeRenderLog, renderLogTsv, renderStats };
