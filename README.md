# Argus Field — Site Visit & Attendance Tracking

Answers the questions a field-sales manager actually asks: **where is my employee, did they reach the customer site, when, did they verify their identity, how long were they really there, and when did they leave.**

```
Admin invites → Employee registers → Face registration → Start visit → GPS tracking
  → Reaches site (geofence) → Face verification → Visit starts → Visit ends (face again) → Admin dashboard
```

## Run it

```bash
npm install
npm start            # http://localhost:3000
npm test             # 20 end-to-end checks of the visit rules (no camera needed)
npm run seed         # wipe ALL data, leaving only the admin account
npm run seed:demo    # dev only: sample employees/visits (cannot be signed into without stubbing Google)
```

**Sign-in is Google only** (no passwords). The admin is `argushexadoc2021@gmail.com` (override with `ADMIN_EMAIL`); sign in with that Google account. Add employees from the admin Employees page: each gets an invitation email, opens the link, continues with the *same* Google account the invite was sent to, then registers their face. After that they sign in with Google.
Set `GOOGLE_CLIENT_ID` and the SMTP variables first — see `.env.example`.

### Trying the field flow from your desk
On the employee Home screen tick **Demo mode — simulate GPS**. The app starts ~3 km from the site and walks to it, so arrival, face verification and completion can be tried without travelling. Simulated visits are flagged in the admin Visit Details. Face verification always uses the real camera.

### Testing on a phone
Browsers only allow camera + GPS on **HTTPS or localhost**. Expose the app over HTTPS (e.g. `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`) and set `PUBLIC_URL` to that address so invitation links point to it.

## Daily field flow
1. **Morning:** employee opens the app and adds today's stops (search a company or drop a pin on the map) under *Today's plan*.
2. **Start visit → on the way:** the app draws the **road route** (OpenStreetMap/OSRM) with distance and ETA, plus a *Navigate* button that opens Google Maps.
3. **Arrival** is detected by the server (geofence). The employee must then **photograph the company logo / visiting card** (camera or upload) — stored in `data/uploads/`.
4. **Face verification** starts the official visit.
5. **Leaving:** the employee enters **meeting details** (who they met, summary, products discussed, outcome, next step), then verifies their face to end the visit.
6. Admin sees the proof photo and meeting notes in *Visit Details*.

## Configuration (environment variables)

| Variable | Purpose |
|---|---|
| `PORT` | default `3000` |
| `PUBLIC_URL` | base URL used in invitation emails |
| `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` `MAIL_FROM` | send real invitation emails (Gmail: `smtp.gmail.com`, port 587, an **App Password**). Without SMTP the invite dialog shows a copyable link and logs it to the console. |
| `APP_SECRET` | signing/encryption secret (auto-generated into `data/secret.key` if unset) |
| `ALLOW_SIMULATION=false` | **set in production** — rejects simulated GPS |
| `GOOGLE_CLIENT_ID` | Google OAuth Web client ID (required for any sign-in) |
| `ADMIN_EMAIL` | admin's Google account, used when the database is first created |
| `TILE_URL` `TILE_ATTRIBUTION` | map tile source (default Esri World Street Map; any `{z}/{x}/{y}` XYZ URL works). OpenStreetMap's public tiles block many browsers, so use a provider that fits your licence in production. |
| `DATA_DIR` | where `db.json` lives |

## How the business rules are enforced (server-side)

The UI is never trusted; every rule lives in [server/index.js](server/index.js) and is covered by [server/test.js](server/test.js).

| Concept | Rule |
|---|---|
| **Location tracking** | Phone posts GPS fixes. Server rejects fixes worse than the configured accuracy (default ±100 m). Tracking alone never creates attendance. |
| **Arrival** | Detected by the **server** when a reported position is inside the site's geofence — the client can't declare it. |
| **Official visit start** | Only `verify-start`: status must be `at_site`, position inside geofence, and the live face must match the registered face. |
| **Official visit end** | Only `verify-end`: status must be `active` and a face must match again. |
| **Durations** | `Travel = arrival − travel start`. `Visit = end − verified start`. The gap between arrival and verification counts as neither. |
| **Blocked** | A second open visit, ending an unstarted visit, completing twice, cancelling a verified visit, verifying before arrival or outside the geofence. 5 failed face attempts lock the visit for 2 minutes. |
| **Auth** | Google-only sign-in (ID token verified server-side, email must match the invite), signed expiring tokens, login throttling, single-use hashed invite tokens (72 h), role-checked routes. |
| **Face data** | Only a 128-number descriptor is stored (AES-256-GCM encrypted at rest) — never a photo. Matching happens server-side. Re-enrolment needs an admin "Reset face". |

## Screens

**Admin:** Login · Dashboard (KPIs, live table, 7-day chart, map, activity) · Employees · Invite · Employee details · Visit history (filters + CSV) · Live tracking · Visit details (timeline, route, travel vs on-site) · Reports · Settings (rules, customer sites with map picker).
**Employee (mobile-first):** Login · Registration · Face registration · Home (changes with state: ready → on the way → at site → active → completed) · Face verification · Visit completed · History · Visit detail · Profile.

## Known limits (read before production)

- **Spoofing:** verification requires a blink (or head turn) as a basic liveness check, which stops a held-up photo, but it runs in the browser so it can't stop a determined attacker (video replay, modified client); mock-location apps can fake GPS. For high-stakes use add liveness detection and consider a native app with device attestation.
- **Face accuracy** uses face-api.js (loaded from jsDelivr, so the device needs internet). Tune strictness in Settings.
- **Storage** is a JSON file ([server/db.js](server/db.js)) — fine for a pilot; swap for Postgres for real scale.
- **Map tiles** come from OpenStreetMap's public server, which is for light use; switch the URL in [public/js/map.js](public/js/map.js) to a commercial tile provider for production.
- Live updates use polling (5–8 s), not websockets.
