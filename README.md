# Lead Finder

Search a business type + location (OpenStreetMap + Overture Maps; US healthcare also from the NPI registry), crawl sites for email/IG/gaps, write openers with local Ollama, push selected leads to GoHighLevel.

## Run it as an app (recommended)
```
scripts/app start      # builds if the code changed, starts in the background → http://127.0.0.1:3000
scripts/app stop       # scripts/app restart · scripts/app status · scripts/app logs
scripts/app autostart on   # start at login, restart if it stops (off to undo)
```
Or double-click `scripts/Lead Finder.command` (starts it and opens the browser). `npm run dev` still works for development, but the built app is the one to use day to day: it never serves stale code. After changing code, run `scripts/app restart`.

**Backups:** the app copies `leads.db` once a day and before any delete, keeps the newest 30 in `backups/`, and checks each copy opens. Settings → Backups shows them and has "Back up now". Put `BACKUP_DIR=` (in `.env`) on a synced folder for an off-computer copy. Restore with `scripts/app restore`.

**Deleting leads:** "Clean up" (weak leads, previewed with counts first), "Delete selected", and "Forget" (a removal request: do-not-contact AND delete everywhere). Always backed up first; a lead already pushed to GHL is never deleted by Clean up or Delete selected.

## Put it on a server (so your Mac can be off)
See `deploy/README.md`: Docker on a small server with automatic HTTPS (Caddy) and the app's own login (password + authenticator app, `npm run login:create`). Your DNS stays where it is: you add one A record. `scripts/deploy user@server` sends updates. If your domain's DNS is on Cloudflare you can use a Cloudflare Tunnel + Access login instead: `deploy/README-cloudflare.md` and `docker-compose.cloudflare.yml`.

## Setup
1. `cp .env.example .env` and fill `GHL_TOKEN` (Private Integration token, scope `contacts.write`) and `GHL_LOCATION_ID`.
2. Install Ollama (ollama.com), then `ollama pull llama3.2:3b` (keep it running).
3. `npm install && npm run dev` -> http://localhost:3000
4. `cp OFFER.example.md OFFER.md` and edit it to say what YOU sell (OFFER.md is gitignored). Edit the wording of the example plays in `lib/playbook.ts` to match.
5. Set `SENDER_*` in `.env` (name, business, postal address, reply email) so email drafts get a lawful footer.

Tests: `npm test`

## Research & scoring
Each lead gets: GHL status (likely / potential / not enough info, from public site code only), observed evidence (contact form, booking, quote, chat), gaps, a 0-100 score (A-D priority + confidence), an outreach angle and discovery question from Ollama, source links, and a check date. Click "Show research" on a row for the breakdown. Export CSV/JSON uses the master-prompt schema. Pushes add tags `lead-finder`, `priority-x`, and `ghl-likely` when relevant; the GHL note carries the full research.

## Australian Business Register (optional)
Free key from https://abr.business.gov.au/Tools/WebServices (accept the agreement, the GUID is emailed). Put it in `.env` as `ABN_GUID=`. Then Australian leads are checked against the register: it shows "ABN active/cancelled", and for a sole trader it adds the person's own name as the owner (companies get no person: the register does not name owners or directors). Without a key nothing changes. If the register ever tells you an entry was withdrawn, delete it.

## Data sources
OpenStreetMap (ODbL), Overture Maps Places (CDLA Permissive 2.0 / Apache 2.0 per record; Foursquare-sourced rows are Apache 2.0), US NPI registry (public domain). Restart `npm run dev` after pulling this change: `next.config.mjs` now lists `@duckdb/node-api` as an external package.

## Who you may email, and the do-not-contact list
- **Country rules** (Settings page): the email given to GHL follows a rule per country: `allow`, `published-only` (only an address the business publishes on its own website) or `block`. Defaults: US allow; Canada, Australia, New Zealand published-only; everything else blocked. The contact still goes to GHL; only the email is held. Change the rules with an `outreach-policy.json` file (see the Settings page for the format). **The defaults are cautious starting points, not legal advice**; ask a lawyer about your markets.
- **Do-not-contact list** (Settings page, or the "Do not contact" button on a lead): emails, whole business websites and phone numbers. Listed leads are never pushed to GHL, can't be selected, and are flagged if a later search finds them again. Paste addresses that unsubscribed or bounced in GHL.
- Texting and calling have their own rules (for example the US TCPA); the country gate covers email only.


## Responsibility and limits
- **Single user, self-hosted.** One login, one database, one GHL token and one sender identity per install. It is not a multi-tenant service; each person runs their own copy.
- **You are responsible for your outreach.** The app only finds businesses and drafts messages. Following CAN-SPAM, CASL, GDPR/PECR, the TCPA and similar rules, and honouring opt-outs, is up to you. Defaults are cautious starting points, not legal advice.
- **Be polite to the free data sources.** OpenStreetMap Nominatim and Overpass have usage policies (about 1 request per second, identify your app). Change the `User-Agent` in `lib/osm.ts`, `lib/geocode.ts`, `lib/nominatimSearch.ts` and `lib/overture.ts` to include your own contact before heavy use. Do not run it as a shared public service on one IP.
- Provided as is, with no warranty.
