# AIS key rotation and runtime reset

Use this when AISStream stays connected but returns zero provider messages, or when a key may have expired or been revoked.

## What the symptoms mean

If `/health` shows:

```json
"aisstream": {
  "enabled": true,
  "connected": true,
  "messageCount": 0,
  "cachedVessels": 0
}
```

then the key is loaded and the websocket is open, but AISStream is not sending messages for the active subscription. If `enabled` is false, the key is missing.

## Local / Codespaces rotation

Do not paste the key into chat. Paste it only into the terminal.

```bash
cd /workspaces/codespaces-blank/CHMARL_datav

git pull --ff-only
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

In a second terminal:

```bash
PORTAL_BASE_URL=http://127.0.0.1:8787 pnpm run diagnose:saudi-ais || true
PORTAL_BASE_URL=http://127.0.0.1:8787 pnpm run summary:ports
```

## Render rotation

Go to:

```text
Render Dashboard -> chmarl-datav -> Environment
```

Update only:

```text
AISSTREAM_API_KEY=<new key>
```

Keep these production values:

```text
AISSTREAM_URL=wss://stream.aisstream.io/v0/stream
AISSTREAM_FORCE_REGIONAL_BBOX=true
AISSTREAM_BBOX=11,32;31,56
AISSTREAM_APPEND_SAUDI_PORT_BBOXES=true
AISSTREAM_USE_SAUDI_PORT_BBOXES=false
AISSTREAM_FILTER_TYPES=
AISSTREAM_MAX_VESSELS=750
AISSTREAM_MAX_AGE_MS=21600000
AISSTREAM_TRAIL_POINTS=24
RUNTIME_CACHE_SCOPE=bbox
```

To force Render to drop old cached AIS/EcoFair state, change the cache scope once:

```text
RUNTIME_CACHE_SCOPE=bbox-v2
```

Then run:

```text
Manual Deploy -> Clear build cache & deploy
```

After the deploy, verify:

```bash
export LIVE_PORTAL="https://chmarl-datav.onrender.com"
curl -s "$LIVE_PORTAL/health" | python -m json.tool | head -140
curl -s "$LIVE_PORTAL/api/vessels" | python -m json.tool | head -120
```

## Fixed/manual fallback rows

AISStream can be empty even when connected. EcoFair-CH-MARL can still run from fixed/manual rows or another API. Re-ingest fixed rows after a Render restart because `/tmp` storage is ephemeral:

```bash
PORTAL_BASE_URL=https://chmarl-datav.onrender.com \
FIXED_VESSELS_FILE=public/data/manual_vessels.sample.json \
pnpm run ingest:fixed-vessels
```

Then verify `/health` shows `fixedRows > 0` and `/api/chmarl/episode` is active.

## Repository hygiene

Runtime state and secrets must not be committed. `.gitignore` excludes `.env*`, `.runtime`, cache files, local zip bundles, and pasted diagnostic logs.
