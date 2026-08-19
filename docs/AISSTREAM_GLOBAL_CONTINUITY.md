# AISStream global continuity policy

The portal retains a worldwide AIS tracking subscription and does not narrow vessel reporting to selected regions. The current production fallback may nevertheless appear regional when AISStream itself supplies no position frames.

## Observed provider state

A live diagnostic on 19 August 2026 found that AISStream was configured with the full-world bounding box but had delivered zero frames. The visible cohort therefore came entirely from PocketWorld sources covering Norway, Finland/Baltic waters, and Singapore. This is an upstream-source state, not a Leaflet or application geography filter.

## Connection strategy

- The active AISStream subscription uses the worldwide bounding box and position-bearing message types only.
- A healthy WebSocket that produces no AIS positions is kept open.
- The same worldwide subscription is refreshed in place after the silent interval.
- A hard reconnect is delayed until the configured long silence interval or heartbeat loss.
- Rate-limit backoff remains authoritative.
- Diagnostics expose subscription refreshes, silent start time, and controlled hard reconnects.

AISStream documents that an active subscription can be replaced by sending a new subscription message on the same WebSocket. The position-only profile also reduces processing load compared with the full worldwide message firehose.

## Continuity retention

Global AIS and PocketWorld observations remain available for up to 24 hours by default. Browser display retention is aligned to the same interval. This helps preserve genuine worldwide context through short provider interruptions and deployments.

Retention is not operational freshness. EcoFair-CH-MARL continues to use only observations within the configured port radius and the separate 30-minute operational freshness gate.

## Provider boundary

The application cannot recreate AIS observations that an upstream provider did not deliver. During a service-side AISStream outage, the portal reports the remaining PocketWorld cohort as `degraded-regional-only` rather than calling it worldwide live coverage. No manual or synthetic rows are introduced.
