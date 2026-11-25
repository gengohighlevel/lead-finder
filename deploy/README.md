# Put Lead Finder on a server at dashboard.example.com (your DNS stays where it is)

What you get: the app runs 24/7 in Docker on a small server, at **https://dashboard.example.com**, with free automatic HTTPS
(Caddy + Let's Encrypt) and **its own login: password + an authenticator-app code**. Your Mac can be off.

```
you ──► https://dashboard.example.com ──► Caddy (HTTPS, security headers) ──► app (login required) ──► /data volume ──► copy in cloud storage
```

**What does NOT change:** your other DNS records. You add ONE record (`dashboard`). Your website, your GoHighLevel login
(`app.`), and your email sending records (`mail.`: SPF, DKIM, DMARC, Mailgun) stay exactly as they are.

**Cost:** the server (about €4–5 a month, e.g. Hetzner CX22). HTTPS, the backup storage (Cloudflare R2 free tier, no domain move
needed) and everything else are free. The AI writer is not on the server (it needs a graphics chip); outreach uses the playbook templates.

Time: about 45 minutes.

**Why this is safe to put on the internet:**
- There is **no sign-up page**. The one account is created on your own Mac and lives in the server's settings.
- Login needs the password AND a 6-digit code from your phone. Each code works once. A lost phone is covered by one-time recovery codes.
- Five wrong tries from one address lock it out for 15 minutes. Every wrong answer looks the same, so nobody can tell which part was wrong.
- The session cookie is `Secure`, `HttpOnly`, `SameSite=Strict`, signed, and lasts at most 12 hours.
- Every other page and endpoint refuses a visitor who isn't signed in, and the app refuses to serve at all if the login settings are missing.
- Only ports 22 (SSH), 80 and 443 are open. The app container itself has no published port.

---

## 1. Create your login (on your Mac, takes 2 minutes)

```
cd ~/Projects/lead-finder
npm run login:create
```

It asks for your email and a password (at least 12 characters; a long passphrase is best). Then it shows:

1. **A QR code.** Scan it with Google Authenticator, Authy, 1Password or similar. (Or type the key by hand.)
2. **8 recovery codes.** Each works once if you lose your phone. **Save them in a password manager now. They are not shown again.**

It writes the settings into `.env.server` (readable only by you). It will not overwrite an existing login unless you add `--force`.

## 2. The other settings files (on your Mac)

Put `APP_HOSTS=dashboard.example.com` (your own domain) and your GHL and ABN settings in `.env.server` (copy `.env.server.example`). Check it:

```
grep -E "^(APP_HOSTS|AUTH_MODE|ADMIN_EMAIL)=" .env.server
```

Then:

```
cp .env.caddy.example .env.caddy      # APP_DOMAIN is already dashboard.example.com
cp .env.backup.example .env.backup    # the cloud storage for backups (step 3)
```

## 3. Backup storage (Cloudflare R2, free)

Backups are copied off the server every hour, so a lost server doesn't lose your leads. In the Cloudflare dashboard
(a free account is enough; **your domain does not need to be on Cloudflare**): R2 → create a bucket `lead-finder-backups` →
*Manage R2 API Tokens* → create a token with **Object Read & Write** for that bucket. Put the Access Key ID, Secret and
the S3 endpoint (`https://<account-id>.r2.cloudflarestorage.com`) in `.env.backup`.

(Any S3-compatible storage works if you prefer another provider: change the `RCLONE_CONFIG_R2_*` lines.)

## 4. The server

1. Create a server (Hetzner CX22 or any Ubuntu 24.04 machine). Add your SSH key. Note its **IP address**.
2. Log in and set it up:
   ```
   ssh root@SERVER-IP
   curl -fsSL https://get.docker.com | sh
   apt-get install -y ufw rsync unattended-upgrades fail2ban
   ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw --force enable
   mkdir -p /opt/lead-finder
   ```
   Also turn off SSH password logins (set `PasswordAuthentication no` in `/etc/ssh/sshd_config`, then `systemctl restart ssh`)
   so only your key works.

## 5. DNS: add one record at your DNS provider

In your DNS provider's panel for `example.com`, add a new record:

| Type | Host | Value | TTL |
|---|---|---|---|
| A Record | `dashboard` | your server's IP address | Automatic |

Do not change or delete anything else. Check it (a few minutes later):

```
dig +short dashboard.example.com        # should print your server's IP
```

Caddy cannot get the HTTPS certificate until this record points at the server, so do this before step 7.

## 6. Send the settings and start it

```
scp .env.server .env.caddy .env.backup root@SERVER-IP:/opt/lead-finder/
ssh root@SERVER-IP 'chmod 600 /opt/lead-finder/.env.*'
scripts/deploy root@SERVER-IP
```

The first build takes a few minutes. It starts `app`, `caddy` and `backup-sync`.

## 7. Move your library across

Take a fresh backup first (Settings → Backups → *Back up now*), then:

```
scp backups/<newest-file>.db root@SERVER-IP:/tmp/leads.db
ssh root@SERVER-IP
cd /opt/lead-finder
docker compose stop app
docker compose cp /tmp/leads.db app:/data/leads.db
docker compose run --rm --no-deps --user root --entrypoint chown app -R node:node /data
docker compose start app
```

The ownership step matters: without it the app can read the library but cannot save to it. Your country rules file
(`outreach-policy.json`) goes the same way into `/data/outreach-policy.json`.

## 8. Check it

1. Open **https://dashboard.example.com**. You should land on the sign-in page with a padlock.
2. Sign in with your email, password and the 6-digit code. Your leads should be there.
3. Settings → Backups → *Back up now*. Within an hour the file appears in your R2 bucket.
4. Try **http://SERVER-IP** in a browser: it should show nothing useful.
5. `ssh root@SERVER-IP 'cd /opt/lead-finder && docker compose ps'`: three services, `app` *healthy*.
6. Sign out (bottom of the sidebar) and check you cannot reach the page.

## Day to day

- **Update after changing code:** `scripts/deploy root@SERVER-IP`. The library lives in a Docker volume and is untouched.
- **Change your password or phone:** `npm run login:create -- --force` on your Mac, then
  `scp .env.server root@SERVER-IP:/opt/lead-finder/` and `ssh root@SERVER-IP 'cd /opt/lead-finder && docker compose up -d --force-recreate app'`. Everyone is signed out.
- **Lost your phone:** sign in with a recovery code (the link under the sign-in form). Then make a new login as above.
- **Restore a backup:** repeat step 7 with the backup file. If the whole server is lost, make a new one, repeat steps 4 to 7 and download the newest file from R2.
- **See what is happening:** `docker compose logs --tail 50 app` (failed sign-ins are logged as `[auth] failed sign-in from <address>`).

## Keep it safe

- Your leads include personal data (sole traders' names, emails, phone numbers). A rented server is yours to keep patched:
  `unattended-upgrades` (installed above) applies security updates. Reboot now and then.
- Store the recovery codes and the password in a password manager. Anyone with the password, the phone and the codes can sign in.
- If you have a fixed home or office IP, you can also restrict ports 80/443 to it in the server's firewall. That is optional and not required.
- Your sending domain: if its DMARC is `p=none` (monitor only), once your emails pass, change it to
  `p=quarantine` in your DNS provider. That is a change to that one TXT record, separate from this setup.

## Troubleshooting

| You see | Cause |
|---|---|
| Browser says the connection is not private / no certificate | The `dashboard` A record is missing or wrong, or port 80/443 is blocked. Check `dig`, `ufw status`, and `docker compose logs caddy`. |
| `503 Hosted mode is not fully configured` | A login setting is missing in `.env.server`. Run `npm run login:create` and copy the file again. |
| `403 This app only answers to its own local address` | `APP_HOSTS` is not exactly `dashboard.example.com`. |
| `Too many attempts. Try again in 15 minutes.` | Five wrong tries from your address. Wait, or `docker compose restart app` (this clears the lock). |
| The code is always wrong | Your phone's clock is off (turn on automatic time), or you scanned the QR before running `login:create --force`. |
| The app opens but nothing saves | The `chown` line in step 7 was skipped. |
