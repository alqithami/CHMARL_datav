# EcoFair-CH-MARL Live Measures

The portal computes EcoFair-CH-MARL fuel, emission, fairness, queue, and reward measures from the merged vessel input feed. The runtime implementation is `server/vessel-feed-proxy/ecofair.mjs` and the live evidence endpoint is `/api/report`.

## Input sources

The runtime now uses one operational vessel set built from all configured sources:

1. AISStream cache rows from `/api/vessels`.
2. An optional upstream vessel API configured with `UPSTREAM_VESSEL_DATA_URL` and `UPSTREAM_VESSEL_DATA_TOKEN`.
3. Manual/fixed vessel rows configured with `FIXED_VESSELS_JSON`, `FIXED_VESSELS_FILE`, or written through `POST /api/vessels/fixed`.

Rows are normalized, deduplicated by vessel id/MMSI, and then fed into EcoFair-CH-MARL. Fixed rows are intended for known Saudi operational inputs while AIS coverage is incomplete. They are not bundled fixtures; they are explicit operator-provided data.

Example fixed vessel payload:

```json
{
  "vessels": [
    {
      "id": "FIXED-JEDDAH-001",
      "name": "Manual Jeddah Queue Vessel",
      "speedKnots": 0.2,
      "latitude": 21.42,
      "longitude": 39.12,
      "status": "Watch"
    }
  ]
}
```

## Fuel and CO2 model

Each vessel receives a deterministic fuel-curve factor `k` in `[5e-4, 1e-3]` tonnes per knot-cubed hour. Fuel is integrated between observations:

| Vessel state | Detection | Fuel rate |
| --- | --- | --- |
| TRANSIT | SOG > 1 kn | `k * SOG^3` |
| AT_BERTH | within berth radius and slow | `k * 14^3 * 0.25` |
| ANCHORED | within anchorage radius and slow | `k * 14^3 * 0.10` |
| DRIFTING | slow outside port zones | queue-level load |

CO2 is estimated as fuel multiplied by `3.114` tonnes CO2 per tonne fuel. Fuel figures are AIS/API/manual kinematic model estimates, not bunker measurements.

## Emission budget calibration

The previous fixed default of 4000 t CO2/day was sized for a small fleet. With hundreds of live vessels it permanently violated the emission constraint and made the emission penalty dominate the reward.

The default mode now scales the daily budget with the tracked fleet:

```text
budget = ECOFAIR_BUDGET_TONNES_PER_VESSEL_PER_DAY * active_vessels
```

The default allowance is `60` t CO2/vessel/day. A fixed fleet budget is still available by setting `ECOFAIR_EMISSION_BUDGET_TONNES_PER_DAY` to a positive value. Leaving it at `0` enables per-vessel mode.

The daily budget is prorated by elapsed UTC-day fraction. The dual variable is updated once per minute:

```text
lambda = max(0, lambda + eta * (cumulative_CO2 - prorated_budget) / daily_budget)
```

This lets lambda decay back to zero when the fleet is under budget and rise only when emissions exceed the scaled allowance.

## Fairness

Fairness is computed over cumulative per-vessel fuel for the current UTC episode:

- Fuel Gini coefficient, with default limit `0.35`.
- Fuel max-min ratio, with default lower limit `0.4`.

## Reward decomposition

```text
r = -fuel_interval - gamma_emis * max(0, CO2 - budget) - gamma_fair * Gini
```

The `/api/chmarl/episode` endpoint serves `global`, `fuel`, `emissions`, `fairness`, and `constraint_penalty` reward components.

## Port operations

`/api/port-events` is derived from the same merged vessel set using geofence transitions and port occupancy. It provides AIS/API/manual-derived arrivals, departures, anchorage transitions, berth assignments, berth utilization, and queue length per monitored port. When a real port provider is connected through `PORT_EVENTS_URL`, that provider remains authoritative for port events.

## Reporting

`GET /api/report` returns a Markdown evidence report. `GET /api/report?format=json` returns the underlying EcoFair state, live measures, and vessel input counts.

## Configuration

| Env var | Default | Meaning |
| --- | --- | --- |
| `UPSTREAM_VESSEL_DATA_URL` | empty | Optional API vessel feed merged into EcoFair input. |
| `UPSTREAM_VESSEL_DATA_TOKEN` | empty | Optional bearer token for the upstream vessel feed. |
| `FIXED_VESSELS_JSON` | empty | Inline JSON fixed vessel rows. |
| `FIXED_VESSELS_FILE_ENABLED` | `true` | Enables fixed vessel file loading. |
| `FIXED_VESSELS_FILE` | `.runtime/fixed_vessels.json` | Manual fixed vessel file and POST target. |
| `ECOFAIR_EMISSION_BUDGET_TONNES_PER_DAY` | `0` | Fixed daily budget. `0` enables per-vessel mode. |
| `ECOFAIR_BUDGET_TONNES_PER_VESSEL_PER_DAY` | `60` | CO2 allowance per active vessel per UTC day. |
| `ECOFAIR_GAMMA_EMIS` | `10` | Emission penalty weight. |
| `ECOFAIR_GAMMA_FAIR` | `5` | Fairness penalty weight. |
| `ECOFAIR_LAMBDA_LR` | `0.05` | Dual update learning rate. |
| `ECOFAIR_GINI_LIMIT` | `0.35` | Gini fairness constraint limit. |
| `ECOFAIR_MINMAX_LIMIT` | `0.4` | Max-min fairness constraint limit. |
| `ECOFAIR_BERTH_RADIUS_NM` | `5` | Berth geofence radius. |
| `ECOFAIR_ANCHORAGE_RADIUS_NM` | `20` | Anchorage geofence radius. |
| `ECOFAIR_TICK_MS` | `60000` | Background measurement interval. |
| `ECOFAIR_STATE_FILE` | scoped runtime file | Runtime persistence file. |
| `ECOFAIR_PORT_CAPACITY` | built-in map | Optional JSON berth-capacity override. |
