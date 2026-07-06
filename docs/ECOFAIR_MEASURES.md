# EcoFair-CH-MARL Live Measures

This portal computes the measures of **EcoFair-CH-MARL** (Alqithami,
*EcoFair-CH-MARL: Scalable Constrained Hierarchical Multi-Agent RL with
Real-Time Emission Budgets and Fairness Guarantees*, arXiv:2603.14625,
ECAI 2025) on the **live AIS vessel feed** for the Red Sea / Gulf region,
covering Jeddah, King Abdullah Port, Yanbu, Jizan, Dammam, Jebel Ali, and Suez.

The implementation lives in `server/vessel-feed-proxy/ecofair.mjs` and mirrors
the paper's reference code (github.com/alqithami/EcoFairCHAMRL).

## Fuel and emission model

Each tracked vessel gets a deterministic fuel-curve factor `k` sampled from the
paper's spec distribution `[5e-4, 1e-3] t/(kt³·h)` (stable hash of the MMSI).
Fuel is integrated between AIS observations:

| Vessel state | Detection | Fuel rate (t/h) |
| --- | --- | --- |
| TRANSIT | SOG > 1.0 kn | `k · SOG³` (cubic law) |
| AT_BERTH | within berth radius (default 5 nm), SOG ≤ 1 | `k · 14³ · 0.25` (IDLE_LOAD) |
| ANCHORED (queuing) | within anchorage radius (default 20 nm), SOG ≤ 1 | `k · 14³ · 0.10` (QUEUE_LOAD) |
| DRIFTING | elsewhere, SOG ≤ 1 | queue-level load |

CO₂ = fuel × **3.114** t CO₂ / t fuel (IMO GHG conversion factor for HFO).

Integration windows are capped at 30 minutes per vessel to bound the effect of
stale AIS messages. Fuel figures are **model estimates from AIS kinematics**,
not bunker measurements — they are consistent with the paper's simulator, which
is exactly what makes them comparable to the offline experiments.

## Episodes, budget, and the dual variable

An episode is one **UTC day**. Cumulative fleet CO₂ is compared with a daily
emission budget (`ECOFAIR_EMISSION_BUDGET_TONNES_PER_DAY`, default 4000 t)
prorated by elapsed day fraction. The primal-dual budget layer updates once per
minute:

```
lambda <- max(0, lambda + eta * (E_cum - B_prorated) / B_day)
```

`lambda` persists across episodes (a running emission price), matching the
paper's primal-dual analysis. At UTC midnight the day is archived into a
rolling 60-day history (visible in `/api/report`).

## Fairness

Both fairness measures use **cumulative per-vessel fuel** for the current
episode, with the exact formulas of the reference implementation:

- **Gini coefficient** — 0 is perfect equality; constraint limit
  `ECOFAIR_GINI_LIMIT` (default 0.35).
- **Max-min ratio** — `min(fuel)/max(fuel)`; 1 is perfect equality; constraint
  limit `ECOFAIR_MINMAX_LIMIT` (default 0.4).

## Reward decomposition

```
r = -fuel_interval - gamma_emis * max(0, E_cum - B_prorated) - gamma_fair * Gini
```

Served per component (`fuel`, `emissions`, `fairness`, `constraint_penalty`
= `-lambda * excess`, and `global`) in `/api/chmarl/episode`.

## Real port events

`/api/port-events` is derived from AIS geofence transitions — `arrival`,
`departure`, `berth_assigned` (anchorage → berth), `anchorage_entry`,
`anchorage_exit` — plus berth utilization (occupancy vs. reference capacity,
override with `ECOFAIR_PORT_CAPACITY`) and anchorage queue lengths per port.
No demo events are served unless `VITE_PORT_EVENTS_DEMO_ENABLED=true`.

## Reporting

- `GET /api/report` — Markdown evidence report (fleet measures, port queues,
  daily episode history, provenance). `?format=json` returns the full state.
- Dashboard header → Exports → **EcoFair Report (live)** downloads it.

## Research-run ingestion

Actual `EcoFairCHMARL.py` training results can be published to the portal:

```
python EcoFairCHMARL.py --algo PPO --fairness --emission_cap --outdir results/
python scripts/chmarl-ingest-bridge.py --outdir results/ --algo ppo \
    --url https://<your-portal>/api/chmarl/ingest --token $CHMARL_INGEST_TOKEN
```

Retrieve with `GET /api/chmarl/episode?source=experiment`. The live feed stays
the default at `/api/chmarl/episode`.

## Configuration reference

| Env var | Default | Meaning |
| --- | --- | --- |
| `ECOFAIR_EMISSION_BUDGET_TONNES_PER_DAY` | 4000 | Daily fleet CO₂ budget (t) |
| `ECOFAIR_GAMMA_EMIS` | 10 | Emission penalty weight γ_emis |
| `ECOFAIR_GAMMA_FAIR` | 5 | Fairness penalty weight γ_fair |
| `ECOFAIR_LAMBDA_LR` | 0.05 | Dual variable learning rate η |
| `ECOFAIR_GINI_LIMIT` | 0.35 | Gini constraint limit |
| `ECOFAIR_MINMAX_LIMIT` | 0.4 | Max-min constraint limit |
| `ECOFAIR_BERTH_RADIUS_NM` | 5 | Berth geofence radius |
| `ECOFAIR_ANCHORAGE_RADIUS_NM` | 20 | Anchorage geofence radius |
| `ECOFAIR_TICK_MS` | 60000 | Background measurement interval |
| `ECOFAIR_STATE_FILE` | .runtime/ecofair-state.json | Persistence file |
| `ECOFAIR_PORT_CAPACITY` | built-in map | JSON berth-capacity overrides |
