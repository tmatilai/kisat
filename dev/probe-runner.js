// Loads the app in an iframe of a real phone size, runs one probe against
// it, and hands each line to the driver's probeLine (dev/probe.mjs).
// Its traps are in dev/AGENTS.md, "Writing a probe".
//
//   dev/probe.html?probe=probe-heats&w=402&h=787&url=c/demo&wait=1500
//
// `probe` picks the file, and probe.js is the default. The other keys are in
// dev/AGENTS.md, "Running a probe".
const params = new URLSearchParams(location.search);
const w = +params.get('w') || 402;
const h = +params.get('h') || 787;
const settle = +params.get('wait') || 1500;
const route = params.get('url') || '';

const lines = [];
const out = document.getElementById('out');
const log = (s) => {
  lines.push(s);
  out.textContent = lines.join('\n');
  window.probeLine?.(s);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Polls cond until it holds, and returns false once the time is up. A probe
// runs in real time, so a fixed wait can end before a slow load does.
const until = async (cond, ms = 15000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(50)) {
    try {
      if (cond()) return true;
    } catch {
      /* A frame between documents throws, and the poll goes on. */
    }
  }
  return false;
};
const ok = (name, cond) => log(`${name}: ${cond ? 'OK' : 'FAIL'}`);

// Builds a start's key for today, since a demo competition is always today
// (demoTs, demo.js), with its time in UTC as roundGroupKey writes it. A key
// with a date written into it matches no start the next morning, and every
// check then fails as though the view were broken.
const groupKey = (hour, min, event) => {
  const d = new Date();
  d.setHours(hour, min, 0, 0);
  return `${d.toISOString().slice(0, 19)}.0000000+00:00|${event}`;
};

const frame = document.createElement('iframe');
frame.width = w;
frame.height = h;
// The frame opens the root and navigates to a path once the app is up. Only
// the Worker answers a path, and most probes run with public/ served from disk.
const routeUrl = new URL(`/${route}`, location.origin);
const direct = routeUrl.pathname === '/';
frame.src = direct ? routeUrl.href : `/${routeUrl.search}`;
document.body.append(frame);

// A reload gives the frame new module instances, so each document it loads
// gets probe-modules.js. Each read through appJs, libJs or demoJs reaches the
// current document's, and a name a probe copies out keeps the old one's.
frame.addEventListener('load', () => {
  const script = frame.contentDocument.createElement('script');
  script.type = 'module';
  script.src = '/dev/probe-modules.js';
  frame.contentDocument.head.append(script);
});
const moduleOf = (name) => new Proxy({}, { get: (_, key) => frame.contentWindow.probeModules[name][key] });
const [appJs, demoJs, libJs] = ['app', 'demo', 'lib'].map(moduleOf);

// An error thrown outside the awaited probe would otherwise print nothing.
window.onerror = (m) => log(`ERROR ${m}`);

await wait(settle);
await until(() => frame.contentWindow.probeModules);
if (!direct) {
  appJs.navigate(`${routeUrl.pathname}${routeUrl.hash}`);
  await wait(settle);
}
try {
  const file = /^[\w-]+$/.test(params.get('probe') || '') ? params.get('probe') : 'probe';
  const { default: probe } = await import(`./${file}.js?${Date.now()}`);
  await probe({
    frame,
    W: frame.contentWindow,
    D: frame.contentDocument,
    appJs,
    demoJs,
    libJs,
    log,
    ok,
    wait,
    until,
    groupKey,
    params,
  });
} catch (e) {
  log(`THREW ${e.message}`);
}
// DONE ends a whole run. The driver reports a run that stops before it, such
// as one past PROBE_TIMEOUT_S.
log('DONE');
