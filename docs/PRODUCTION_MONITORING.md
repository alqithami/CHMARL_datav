# CH-MARL DataV production monitoring

The production monitor treats **deployment and data readiness as separate concerns**.

A Render release is considered successfully deployed when:

- `GET /health/live` returns HTTP 200 with `ok: true` and `staticDashboard: true`;
- `GET /version` returns the expected Git revision when an expected revision is supplied;
- `GET /` serves the production dashboard HTML shell;
- `GET /health/ready` returns its documented JSON contract, whether its status is 200 or 503;
- `GET /api/vessels` returns the documented vessel-feed contract.

AIS data is considered ready only when `/health/ready` returns HTTP 200 and the vessel API contains current tracking rows. A connected AISStream socket with no position messages is recorded as a **data degradation**, not as a failed Render deployment. This prevents external provider silence from generating a misleading deployment-failure email.

## Permanent workflow

`.github/workflows/production-monitor.yml` runs:

- after a successful `Build` workflow on `main`;
- every six hours;
- manually through `workflow_dispatch`.

The post-build run waits for Render to serve the exact commit that passed CI. It retries during normal deployment propagation and fails only when the application remains unavailable, serves the wrong revision, loses the dashboard shell, or breaks an API contract.

The workflow uploads two evidence files for 14 days:

```text
deployment-monitor.json
deployment-monitor.md
```

The JSON report contains endpoint status and latency, deployed revision, vessel counts, AIS connection state, message counts, and the last message timestamp. It does not contain the AIS API key or other deployment secrets.

## Default target

The monitored origin defaults to:

```text
https://chmarl-datav.onrender.com
```

A repository variable can override it:

```text
CHMARL_DEPLOYMENT_URL=https://<custom-domain-or-render-origin>
```

A manually dispatched run can also provide a one-time URL and expected revision.

## Local or operator execution

Run the same monitor locally or in a Render Shell:

```bash
pnpm monitor:production
```

Override the target:

```bash
CHMARL_DEPLOYMENT_URL=https://chmarl-datav.onrender.com pnpm monitor:production
```

Require live vessel data as a hard gate:

```bash
REQUIRE_DATA_READY=true pnpm monitor:production
```

Use strict data mode only for an operator investigation or a planned AIS acceptance test. The scheduled workflow intentionally leaves it disabled so a third-party AIS outage does not create repeated false deployment alerts.

## Interpretation

| Result | Meaning | Action |
|---|---|---|
| Deployment PASS, data READY | Application and live vessel feed are operating | No action |
| Deployment PASS, data DEGRADED | Render and the dashboard are healthy, but AIS data is unavailable or stale | Review provider state, AIS diagnostics, and key status |
| Deployment FAIL | Render release, revision, dashboard shell, or API contract is broken | Investigate the release immediately |

For AIS-specific investigation, use:

```bash
pnpm diagnose:ais
pnpm diagnose:ais-config
pnpm diagnose:ais-matrix
pnpm diagnose:freshness
```
