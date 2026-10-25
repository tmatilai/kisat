// Runs inside the app's frame, where its imports are the page's own module
// instances. The runner loads it into each document the frame loads, and a
// probe reaches them through appJs, libJs and demoJs (probe-runner.js).
import * as demo from '/demo.js';
import { JUOKSUT_MODULES, VIEW_MODULES } from '/lib/routes.js';

// appJs looks a name up across app.js, the app/ files index.html preloads and
// the ones app.js imports on demand (VIEW_MODULES). libJs looks across every
// lib/ file the page has fetched once those modules are loaded.
const hrefs = (dir) =>
  [
    ...[...document.querySelectorAll('link[rel="modulepreload"]')].map((link) => link.getAttribute('href')),
    ...performance.getEntriesByType('resource').map((entry) => new URL(entry.name).pathname),
  ].filter((href) => href.startsWith(dir) && href.endsWith('.js'));
const names = new Set([...Object.values(VIEW_MODULES), ...Object.values(JUOKSUT_MODULES).flat()]);
const apps = await Promise.all(
  [...new Set(['/app.js', ...hrefs('/app/'), ...[...names].map((name) => `/app/${name}.js`)])].map(
    (href) => import(href),
  ),
);
const libs = await Promise.all([...new Set(hrefs('/lib/'))].map((href) => import(href)));
const across = (modules) => new Proxy({}, { get: (_, key) => modules.find((ns) => key in ns)?.[key] });

window.probeModules = { app: across(apps), demo, lib: across(libs) };

// Counts the document's fetches in flight, for the runner's idle(). The app
// calls fetch at call time, so the wrapper sees each one.
let inFlight = 0;
const realFetch = window.fetch;
window.fetch = (...args) => {
  inFlight += 1;
  return realFetch(...args).finally(() => {
    inFlight -= 1;
  });
};
window.probeInFlight = () => inFlight;
