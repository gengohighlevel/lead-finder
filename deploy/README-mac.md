# Run Lead Finder on your Mac, private through Tailscale (zero cost)

Only your own devices can reach it. Nothing is open to the internet. The Mac must be on and awake.

## 1. Tailscale
1. Install Tailscale from tailscale.com/download (free Personal plan), sign in, and sign in on your phone too.
2. In the admin console (login.tailscale.com/admin/dns) turn on **MagicDNS** and **HTTPS Certificates**.
3. Your Mac's name looks like `your-mac.tail1234.ts.net`. Find it with `tailscale status` or in the menu bar app.

## 2. Settings
Set the host in `.env.server` to that exact name (no https://):
```
APP_HOSTS=your-mac.tail1234.ts.net
```
(Keep the other lines, including the login you made with `npm run login:create`.)

## 3. Start
```
cd ~/Projects/lead-finder
docker compose -f docker-compose.mac.yml up -d --build
tailscale serve --bg 3000
```
Open `https://<your-mac-name>.ts.net` on the Mac or any device signed in to your Tailscale.

## 4. Keep it running
- Docker Desktop: Settings, General, tick **Start Docker Desktop when you sign in**. The container restarts itself.
- Tailscale `serve --bg` survives reboots.
- Stop the Mac sleeping while on power: System Settings, Battery (or Lock Screen), set "Prevent automatic sleeping on power adapter when the display is off". A closed laptop lid still sleeps it.

## Data and backups
Library and hourly backups are in `server-data/` (leads.db, backups/). To start with your current library:
```
mkdir -p server-data && cp leads.db server-data/leads.db
```
Copy `server-data/backups` somewhere else now and then (iCloud Drive, external disk). There is no automatic cloud copy in this setup.

## Stop / update
```
docker compose -f docker-compose.mac.yml down
git pull   # or edit code, then:
docker compose -f docker-compose.mac.yml up -d --build
```
