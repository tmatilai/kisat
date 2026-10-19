// openIssues opens each {title, body} whose title no issue has used yet, open
// or closed, so a weekly run opens each one once. It reads GITHUB_TOKEN and
// GITHUB_REPOSITORY, which a workflow sets.
export async function openIssues(issues) {
  const api = `${process.env.GITHUB_API_URL || 'https://api.github.com'}/repos/${process.env.GITHUB_REPOSITORY}/issues`;
  const headers = { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json' };
  const titles = new Set();
  for (let page = 1; ; page++) {
    const res = await fetch(`${api}?state=all&per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`${api}: ${res.status}`);
    const listed = await res.json();
    for (const i of listed) titles.add(i.title);
    if (listed.length < 100) break;
  }
  for (const d of issues.filter((x) => !titles.has(x.title))) {
    const res = await fetch(api, { method: 'POST', headers, body: JSON.stringify(d) });
    if (!res.ok) throw new Error(`${d.title}: ${res.status}`);
    console.log(`opened: ${d.title}`);
  }
}
