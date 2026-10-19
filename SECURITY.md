# Security policy

## Reporting a vulnerability

Report it privately, and never in a public issue. Use "Report a vulnerability" on the repository's
Security tab. If you cannot, write to the address under "Contact" in the
[README](README.md#contact).

Say what you found, how to reproduce it and what it exposes. There is no bug bounty.

## What this covers

It covers the code on `main` and the two sites it deploys to, `kisat.matilainen.fi` and
`juoksut.matilainen.fi`. There are no releases, so no older version gets fixes.

## What is not a vulnerability

These hold by design, and the docs say so.

- **The `x-kisat-client` header is not authentication.** It keeps scanners off `/api/`, and anyone
  can read it in `public/app/data.js` (`docs/backend.md`, "Abuse protection, layered").
- **Anyone with a follow-list's link can read the list.** The id is the read link, and only the edit
  token can change the list (`docs/backend.md`, "Watches").
- **The rate limits stop a lone scraper and not a distributed one.** Each counts per address and per
  Cloudflare data centre (`docs/backend.md`, "Abuse protection, layered").
- **Tuloslista's API belongs to Tuloslista.** Report a problem in it to them.
