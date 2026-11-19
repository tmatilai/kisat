# Security policy

## Reporting a vulnerability

Report a vulnerability privately, never in a public issue. Use "Report a vulnerability" on the
repository's Security tab. If you cannot, write to the address under "Contact" in the
[README](README.md#contact).

Describe what you found, how to reproduce it and what it exposes. There is no bug bounty.

## What this covers

This policy covers the code on `main` and the two sites it is deployed to, `kisat.matilainen.fi` and
`juoksut.matilainen.fi`. There are no releases, so no older version receives fixes.

## What is not a vulnerability

The following behaviour is by design and documented.

- **The `x-kisat-client` header is not authentication.** The header keeps scanners away from
  `/api/`, and anyone can read its value in `public/app/data.js` (`docs/backend.md`, "Abuse
  protection").
- **Anyone with a follow-list's link can read the list.** The list's id is the read link, and only
  the edit token can change the list (`docs/backend.md`, "Watches").
- **The rate limits stop a single scraper, not a distributed one.** Each limit counts requests per
  IP address and per Cloudflare data centre (`docs/backend.md`, "Abuse protection").
- **Tuloslista's API belongs to Tuloslista.** Report a problem in that API to Tuloslista.
