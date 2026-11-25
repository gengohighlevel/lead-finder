# Put Lead Finder on a server (runs 24/7, your Mac can be off)

What you get: the app runs in Docker on a small server. **Nothing on the server is open to the internet except SSH.**
A free Cloudflare Tunnel carries traffic in, and **Cloudflare Access** puts a login in front of it. The app also checks that
login itself on every request, and refuses to serve at all if the login settings are missing.

```
you ──► Cloudflare (HTTPS + login) ──► tunnel ──► app container ──► /data (library + daily backups) ──► copied to Cloudflare R2
```

**Cost:** a small server (about €4–5 a month, e.g. Hetzner CX22), a domain (about $10 a year, it must use Cloudflare's DNS).
Cloudflare Tunnel, Access (up to 50 people) and R2 (10 GB) are free.

**Not on the server:** the AI writer (Ollama needs a graphics chip or a lot of memory). Outreach angles use the playbook
templates, which are the accurate ones. Everything else works the same.

Time: about 45 minutes the first time.

---

## 0. Before you start: test it on this Mac (optional, 5 minutes)

Docker Desktop is enough:

```
docker build -t lead-finder:test .
```

The server step does the same build, so if this works there, it works on the server.

## 0b. If your domain's DNS is NOT on Cloudflare yet (for example at your DNS provider)

A Cloudflare Tunnel needs the domain's DNS on Cloudflare (free plan). Moving DNS is safe if you copy every record exactly,
but it is the one step that can break things you already run (a website, a GoHighLevel login, your sending domain's email
records). Do it like this:

1. **Write down every record first.** In your current DNS panel (your DNS provider: Domain List, Manage, Advanced DNS) copy or
   screenshot EVERY record: A, CNAME, MX, TXT (SPF, DKIM, DMARC, verification codes), CAA. Do not skip the TXT and
   CNAME records for email (SPF, DKIM, DMARC, mail tracking): lost email records mean lost deliverability.
2. Add the site to Cloudflare (Add a domain, free plan). Cloudflare imports what it can find, which is **not always everything**.
3. **Compare Cloudflare's list to yours, record by record.** Add anything missing. Set every record that points at another
   service (GoHighLevel, Mailgun, a website builder) to **DNS only** (grey cloud), never proxied (orange), or those services break.
4. Only then change the nameservers at your registrar to the two Cloudflare gives you. Records stay the same, so nothing
   should change for anyone. Cloudflare says "Active" within minutes to a few hours.
5. Check afterwards: your website and GHL login still open, and in GHL (Settings, Email Services) your sending domain still
   shows as verified. Send yourself a test email.
6. If DNSSEC is on at the registrar, turn it off before changing nameservers.

## 1. Cloudflare (in your browser)

You need a domain whose DNS is on Cloudflare (add the site in the Cloudflare dashboard and change the nameservers at your
registrar). Then open **Zero Trust** (one.dash.cloudflare.com) and pick the free plan.

1. **Tunnel.** Networks → Tunnels → *Create a tunnel* → Cloudflared → name it `lead-finder` → copy the **token**.
   Then *Public hostname*: subdomain `leads`, your domain, service type **HTTP**, URL **`app:3000`**.
2. **Login (Access).** Access → Applications → *Add an application* → Self-hosted.
   - Application domain: `leads.yourdomain.com`
   - Policy: *Allow*, include **Emails** = your email address (add anyone else who may use it).
   - Login method: One-time PIN (it emails you a code).
   - Save, then open the application and copy the **Application Audience (AUD) tag** (a long hex string).
   - Your **team name** is shown under Settings → Custom pages (the part before `.cloudflareaccess.com`).
3. **Off-server backups (R2).** R2 → create a bucket named `lead-finder-backups`. Then *Manage R2 API Tokens* → create a token
   with **Object Read & Write** on that bucket. Copy the Access Key ID, the Secret and your account's S3 endpoint
   (`https://<account-id>.r2.cloudflarestorage.com`).

## 2. The server

1. Create a server (Hetzner CX22 or any Ubuntu 24.04 machine), add your SSH key. Do not allow password logins.
2. Log in and install Docker:
   ```
   ssh root@SERVER-IP
   curl -fsSL https://get.docker.com | sh
   apt-get install -y ufw rsync unattended-upgrades
   ufw allow OpenSSH && ufw --force enable      # nothing else is open
   mkdir -p /opt/lead-finder
   ```
3. Put the three settings files on the server (they hold secrets and are **never** sent by the deploy script). On your Mac,
   in the project folder:
   ```
   cp .env.server.example .env.server    # fill in: APP_HOSTS, CF_ACCESS_TEAM, CF_ACCESS_AUD, ACCESS_EMAILS, GHL_TOKEN, GHL_LOCATION_ID, ABN_GUID
   cp .env.tunnel.example .env.tunnel    # TUNNEL_TOKEN
   cp .env.backup.example .env.backup    # the R2 settings
   scp .env.server .env.tunnel .env.backup root@SERVER-IP:/opt/lead-finder/
   ssh root@SERVER-IP 'chmod 600 /opt/lead-finder/.env.*'
   ```
   `APP_HOSTS` must be exactly the public name, e.g. `leads.yourdomain.com`.

## 3. Start it

```
scripts/deploy root@SERVER-IP
```

The first build takes a few minutes. It starts three containers: `app`, `tunnel` and `backup-sync`.

## 4. Move your library across

Take a fresh backup on your Mac first (Settings → Backups → *Back up now*), then:

```
scp backups/<newest-file>.db root@SERVER-IP:/tmp/leads.db
ssh root@SERVER-IP
cd /opt/lead-finder
docker compose stop app
docker compose cp /tmp/leads.db app:/data/leads.db
docker compose run --rm --no-deps --user root --entrypoint chown app -R node:node /data
docker compose start app
```

The ownership step matters: without it the app can read the library but cannot save to it.

Your country rules file goes the same way: copy `outreach-policy.json` to `/data/outreach-policy.json` in the volume
(`docker compose cp outreach-policy.json app:/data/outreach-policy.json`, then the same `chown` line).

## 5. Check it

1. Open `https://leads.yourdomain.com`. You should see the Cloudflare login, then Lead Finder with your leads.
2. Settings → Backups → *Back up now*. After up to an hour the file appears in your R2 bucket.
3. `ssh root@SERVER-IP 'cd /opt/lead-finder && docker compose ps'`: all three should be *Up* and `app` *healthy*.
4. Try the server's raw address in a browser. It should not answer at all: nothing is open.

## Updating later

After changing the code on your Mac: `scripts/deploy root@SERVER-IP`. The library lives in a Docker volume and is untouched.

## Restoring from a backup

The newest copies are on the server in the `data` volume and in R2.

```
docker compose stop app
docker compose cp /tmp/chosen-backup.db app:/data/leads.db
docker compose run --rm --no-deps --user root --entrypoint chown app -R node:node /data
docker compose start app
```

If the whole server is lost: make a new one, repeat sections 2 and 3, download the newest file from R2 and do section 4.

## Security notes

- **Only SSH is open.** The app has no published port. Anyone reaching Cloudflare must pass Access first, and the app verifies
  the signed login on every request, so a mistake in the tunnel does not expose your leads.
- If `CF_ACCESS_TEAM` or `CF_ACCESS_AUD` is missing, the app answers **503 to everything** instead of running open.
- Keep your Cloudflare account safe: turn on two-factor login. Whoever controls it controls the tunnel and the login policy.
- Your leads include personal data (sole traders' names, emails, phone numbers). A server you rent is yours to keep patched:
  `unattended-upgrades` (installed above) applies security updates automatically. Reboot occasionally.
- The Do-not-contact list, country rules and Forget button work the same on the server.
- The GHL token lives only in `.env.server` on the server. Rotate it if you ever suspect it leaked.

## Troubleshooting

| You see | Cause |
|---|---|
| Cloudflare error 1033 / 502 | The tunnel is down or the public hostname points at the wrong service. It must be `http://app:3000`. |
| `Login required (no login token)` | The request skipped Cloudflare Access. Use the public address, not the server's IP. |
| `Login required (login token not valid)` | `CF_ACCESS_AUD` or `CF_ACCESS_TEAM` is wrong. |
| `503 Hosted mode is not fully configured` | `CF_ACCESS_TEAM` / `CF_ACCESS_AUD` missing in `.env.server`. |
| `403 This app only answers to its own local address` | `APP_HOSTS` does not match the public name exactly. |
| The app opens but nothing saves | The `chown` step in section 4 was skipped. |
| Logs | `docker compose logs --tail 50 app` |
