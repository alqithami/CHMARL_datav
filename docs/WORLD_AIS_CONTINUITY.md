# World AIS continuity and freshness

The portal distinguishes observation availability from operational freshness. Genuine regional AIS rows remain visible with their original MMSI, provider, coordinates, and timestamps for up to six hours. Rows older than 30 minutes are labeled as last known and are excluded from EcoFair-CH-MARL fuel, emissions, fairness, queue, reward, utilization, and constraint calculations.

PocketWorld snapshots are persisted under the runtime data directory so a Render restart or short mirror outage does not erase genuine observations immediately. The persistence layer never creates or moves a vessel.

AISStream HTTP 429 responses activate a provider backoff that honors Retry-After and prevents reconnect storms. Completing a full silent subscription-profile cycle also activates a cooldown before another cycle.

Production source states are:

- `pocketworld`: at least one regional observation is operationally fresh.
- `pocketworld-last-known`: genuine regional observations are visible, but all exceed the operational freshness threshold.
- `aisstream-waiting`: no genuine vessel row is currently available.

Only fresh observations within the eight monitored port geofences can activate EcoFair-CH-MARL.
