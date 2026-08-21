# Persistent vessel registry

The Operational Vessel Intelligence Dashboard separates permanent vessel identity from time-varying AIS movement.

## Core rule

A vessel record is not deleted merely because it disappears from a current provider response. The registry retains the recognized physical vessel, its identifier history, its latest genuine position, and bounded movement history. The portal never promotes an old position to live status.

## Storage model

The production runtime uses SQLite on the persistent Render disk:

```text
/var/data/vessel-registry.sqlite
```

The registry contains:

- canonical vessel records with an internal `vessel_uuid`;
- active and historical IMO, MMSI, and provider identifiers;
- versioned name, call-sign, flag, type, dimension, and draught changes;
- identity conflicts that require review rather than automatic merging;
- the latest genuine provider position for each vessel;
- bounded, downsampled movement history;
- identity-level provider observations for auditability.

## Identity resolution

Resolution is performed in this order:

1. Valid IMO number.
2. Active MMSI.
3. Stable provider identifier.
4. Deterministic internal UUID.

A valid IMO number anchors the physical vessel. When the IMO remains the same and the MMSI changes, the current MMSI is updated and the former MMSI is closed in identifier history. If the same active MMSI reports a different valid IMO, the records are not merged automatically; an identity conflict is recorded.

Vessel name alone is never used as a unique physical-vessel key.

## Position states

The registry classifies latest observations independently from operational model eligibility:

| Registry state | Default age |
|---|---:|
| Live | 0–10 minutes |
| Delayed | 10–30 minutes |
| Last known | 30 minutes–24 hours |
| Archived | More than 24 hours |
| Identity only | No valid recorded position |

These states describe portal visibility and search. EcoFair-CH-MARL keeps its separate 30-minute freshness gate and eight-port geographic scope.

## Movement history policy

The latest position is updated for every accepted newer observation. Track history is deliberately bounded to protect the 1 GB persistent disk:

- global vessel track buckets: 6 hours;
- vessels in the eight-port operational scope: 5 minutes;
- fine-resolution history: 7 days;
- older history: daily downsample;
- global track retention: 90 days;
- operational track retention: 365 days.

Permanent vessel identity and identity-change history are not deleted by track maintenance.

## API

```text
GET /api/registry/stats
GET /api/registry/vessels?q=&status=&limit=&offset=
GET /api/registry/vessels/:vessel_uuid
GET /api/registry/vessels/:vessel_uuid/identity-history
GET /api/registry/vessels/:vessel_uuid/track?from=&to=&limit=
GET /api/registry/vessels/:vessel_uuid/observations
```

The normal `/api/vessels` response remains the current map cohort and now includes registry summary metadata. Each current vessel row also carries its permanent `vesselUuid`, registry position state, and available canonical identity fields.

## Operator counts

The interface distinguishes:

- known vessels in the permanent registry;
- current tracking rows;
- live, delayed, last-known, archived, and identity-only records;
- vessels in the eight-port operational scope;
- vessels eligible for EcoFair-CH-MARL.

This prevents a provider outage from being misrepresented as permanent vessel loss while preserving honest position freshness.

## Data integrity

The registry stores only genuine provider observations. It does not synthesize vessel identities, positions, routes, or specifications. Invalid coordinates are not placed on the map, and an archived or last-known position cannot enter EcoFair-CH-MARL calculations unless a new, sufficiently fresh port-scope observation arrives.

The production integration is validated through the repository's permanent runtime and UI contract suite before merge.
