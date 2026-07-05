# Always-on deployment outside Codespaces

This portal is designed to run as a single production web service: the backend serves `/api/*`, `/health`, and the built React dashboard from `dist/`.

Codespaces is only a development environment. Do not use the `*.app.github.dev` forwarded URL as the permanent portal URL.

## Recommended production option: Render Blueprint

The repository contains:

- `render.yaml` — Render Blueprint for a Docker web service.
- `Dockerfile` — builds the Vite dashboard and starts the backend service.
- `/health` — production health-check endpoint.

Render will create a stable URL like:

```text
https://chmarl-datav.onrender.com/
```

A custom domain can be added later.

## Required secret environment variables

Set these in the hosting dashboard. Do not commit them.

```text
AISSTREAM_API_KEY=<server-side key>
CHMARL_EXPERIMENT_URL=<optional external CH-MARL feed>
CHMARL_EXPERIMENT_TOKEN=<optional>
CHMARL_INGEST_TOKEN=<optional>
PORT_EVENTS_URL=<optional Kpler/port provider endpoint>
WEATHER_URL=<optional weather provider endpoint>
WEATHER_TOKEN=<optional>
```

The portal works without `CHMARL_EXPERIMENT_URL` because it can calculate an online runtime CH-MARL state from live AIS rows. It still needs `AISSTREAM_API_KEY` or another vessel feed to show live vessels.

## Important AIS configuration

Production uses the broad regional AIS box plus Saudi port approach boxes by default:

```text
AISSTREAM_BBOX=11,32;31,56
AISSTREAM_APPEND_SAUDI_PORT_BBOXES=true
AISSTREAM_USE_SAUDI_PORT_BBOXES=false
AISSTREAM_FILTER_TYPES=
```

This avoids replacing the broad regional box with a too-narrow Saudi-only subscription.

## Render setup steps

1. Push the latest `main` branch.
2. In Render, create a new Blueprint from this GitHub repository.
3. Render should detect `render.yaml`.
4. Enter the required secret values, especially `AISSTREAM_API_KEY`.
5. Deploy.
6. Open the stable Render URL.
7. Verify:

```text
/health
/api/vessels
/api/chmarl/episode
/api/port-events
/api/weather
```

## Local production parity test

Before deploying, run:

```bash
pnpm install
pnpm build
PORT=8787 STATIC_DIR=dist pnpm start:prod
```

Then test in another terminal:

```bash
curl -I http://127.0.0.1:8787/
curl -s http://127.0.0.1:8787/health | head
```

## Notes

- `/tmp` cache paths are suitable for runtime cache only. Do not treat them as permanent storage.
- For long-term historical AIS/CH-MARL storage, add Postgres or object storage later.
- Kpler/port-operation data should be connected through `PORT_EVENTS_URL` when approved.
