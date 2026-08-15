# AIS key rotation and silent-provider recovery

Use this when AISStream opens a websocket but returns zero usable vessel positions, or when a key may have expired, been revoked, or is incompatible with the active subscription.

## What the symptoms mean

If `/health` shows:

```json
"aisstream": {
  "enabled": true,
  "connected": true,
  "messageCount": 0,
  "usablePositionMessages": 0,
  "cachedVessels": 0
}
```

then the key is loaded and the websocket is open, but AISStream is not delivering usable position messages for the active subscription. The dashboard now reports this condition as **AIS provider silent** rather than implying that vessel rows are about to appear.

If `enabled` is false, the key is missing. If `lastError` is populated, inspect that error before changing the subscription.

## Local / Codespaces rotation

Do not paste the key into chat or commit it to GitHub. Paste it only into the terminal.

```bash
cd /workspaces/codespaces-blank/CHMARL_datav

git fetch origin main
git reset --hard origin/main
pnpm install

read -rsp "New AISStream key: " AISSTREAM_API_KEY_NEW
echo
export AISSTREAM_API_KEY_NEW
pnpm run env:ais-key
unset AISSTREAM_API_KEY_NEW

pnpm cache:clear -- --yes
pkill -f "dev-with-proxy" || true
pkill -f "vessel-feed-proxy" || true
pkill -f "vite" || true
PORT=8787 VITE_PORT=5173 VITE_MIRROR_PORT=3000 pnpm dev:proxy
```

If local startup fails with `invalid distance too far back`, reset generated state before restarting:

```bash
git fetch origin main
git reset --hard origin/main
rm -rf dist node_modules/.vite .runtime
pnpm install
PORT=8787 VITE_PORT=5173 VITE_MIRROR_PORT=3000 pnpm dev:proxy
```

In a second terminal:

```bash
pnpm run diagnose:ais-config
pnpm run diagnose:ais
pnpm run diagnose:ais-matrix
PORTAL_BASE_URL=http://127.0.0.1:8787 pnpm run summary:ports
```

Interpret the result conservatively:

- socket opens and messages arrive: the provider/key/subscription is working;
- socket opens but every box returns zero messages: the provider or key is silent;
- provider error or rejected websocket: fix the reported key/subscription error;
- fallback rows appear but AIS counters stay at zero: the portal is operational, but the rows are not live AIS.

## Render recovery

Go to:

```text
Render Dashboard -> chmarl-datav -> Environment
```

Update the secret only in Render:

```text
AISSTREAM_API_KEY=<new key>
```

Keep these production values:

```text
AISSTREAM_URL=wss://stream.aisstream.io/v0/stream
AISSTREAM_GLOBAL_TRACKING_ENABLED=false
AISSTREAM_TRACKING_BBOX=11,32;31,56
AISSTREAM_BBOX=11,32;31,56
AISSTREAM_APPEND_SAUDI_PORT_BBOXES=true
AISSTREAM_FILTER_TYPES=
AISSTREAM_MAX_VESSELS=5000
AISSTREAM_MAX_AGE_MS=21600000
AISSTREAM_TRAIL_POINTS=12
AISSTREAM_CACHE_ENABLED=true
AISSTREAM_CACHE_FILE=/var/data/ais-tracking-cache.json
AISSTREAM_OPERATIONAL_CACHE_FILE=/var/data/ais-operational-cache.json
FIXED_VESSEL_DATA_FILE_ENABLED=true
FIXED_VESSEL_DATA_URL=https://chmarl-datav.onrender.com/data/manual_vessels.sample.json
```

The regional subscription is intentional. A worldwide subscription creates unnecessary load and makes diagnosis harder. Leave `AISSTREAM_FILTER_TYPES` empty until the provider is confirmed to deliver positions.

Then run:

```text
Manual Deploy -> Clear build cache & deploy
```

## Verify the deployed service

```bash
export LIVE_PORTAL="https://chmarl-datav.onrender.com"

curl -s "$LIVE_PORTAL/health" | python -m json.tool | head -180
curl -s "$LIVE_PORTAL/api/vessels" | python -m json.tool | head -160
```

For live AIS operation, verify:

```text
aisstream.connected = true
aisstream.messageCount > 0
aisstream.usablePositionMessages > 0
vesselInputs.aisRows > 0
counts.tracking > 0
source = aisstream
```

When AISStream is silent, the configured continuity feed should still produce:

```text
vesselInputs.fixedRows > 0
counts.tracking > 0
source = remote
```

If both `aisRows` and `fixedRows` remain zero, verify that Render applied `FIXED_VESSEL_DATA_URL` and that this URL returns JSON:

```bash
curl -s "$LIVE_PORTAL/data/manual_vessels.sample.json" | python -m json.tool
```

## Fixed/manual continuity rows

The bundled fixed-vessel file prevents the dashboard from remaining empty while AISStream is silent:

```text
FIXED_VESSEL_DATA_URL=https://chmarl-datav.onrender.com/data/manual_vessels.sample.json
```

These rows survive Render restarts because the JSON file is part of the deployed static assets. They are **continuity/demo inputs, not live AIS observations**. The interface labels them as a fixed/fallback feed.

To override the bundled continuity rows, point `FIXED_VESSEL_DATA_URL` to a stable JSON endpoint that you control, or ingest operator-provided rows:

```bash
PORTAL_BASE_URL=https://chmarl-datav.onrender.com \
FIXED_VESSELS_FILE=public/data/manual_vessels.sample.json \
pnpm run ingest:fixed-vessels
```

Then verify `/health` shows `fixedRows > 0` and `/api/vessels` reports at least one tracking row.

## Repository hygiene

Runtime state and secrets must not be committed. `.gitignore` excludes `.env*`, `.runtime`, cache files, local zip bundles, and pasted diagnostic logs.
