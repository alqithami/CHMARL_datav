# AIS dual-stream architecture

The portal now separates vessel display from operational measurement.

## Global tracking stream

The global stream supplies the map, vessel search, and vessel table. It uses a world bounding box and a large cache. Its data is never used directly as a fleet-wide EcoFair calculation set.

Environment variables:

```text
AISSTREAM_GLOBAL_TRACKING_ENABLED=true
AISSTREAM_TRACKING_BBOX=-90,-180;90,180
AISSTREAM_FILTER_TYPES=PositionReport,StandardClassBPositionReport,ExtendedClassBPositionReport
AISSTREAM_MAX_VESSELS=20000
AISSTREAM_CACHE_FILE=/var/data/ais-tracking-cache.json
```

## Operational priority stream

A second AISStream WebSocket subscribes only to the Red Sea, Gulf, and monitored port approach boxes. Its cache is independent of the global cache, so dense European or North American traffic cannot evict Middle East rows.

Environment variables:

```text
AISSTREAM_OPERATIONAL_PRIORITY_ENABLED=true
AISSTREAM_OPERATIONAL_BBOX=11,32;31,56|20.70,38.35;22.95,39.85|23.25,37.15;24.90,38.90|16.15,41.75;17.55,43.35|25.70,49.25;27.25,50.90|24.35,54.35;25.65,55.75|29.20,32.00;30.55,33.25
AISSTREAM_OPERATIONAL_FILTER_TYPES=PositionReport,StandardClassBPositionReport,ExtendedClassBPositionReport,LongRangeAisBroadcastMessage
AISSTREAM_OPERATIONAL_MAX_VESSELS=3000
AISSTREAM_OPERATIONAL_CACHE_FILE=/var/data/ais-operational-cache.json
```

Operational messages are also inserted into the global display cache, so a vessel near a monitored port remains visible on the map.

## EcoFair-CH-MARL scope

The runtime merges global AIS, priority AIS, upstream API rows, and operator-provided fixed rows for display. It then selects only vessels within `ECOFAIR_OPERATIONAL_RADIUS_NM` of these ports:

- Jeddah
- King Abdullah Port
- Yanbu
- Jizan
- Dammam
- Jebel Ali
- Suez

Only this operational subset is used for fuel, CO2, emission budget, fairness, queue, reward, and constraint calculations.

## Position quality controls

The runtime rejects:

- coordinates outside Web Mercator/AIS bounds;
- updates older than the vessel's current timestamp;
- updates implying speed above `AISSTREAM_MAX_IMPLIED_SPEED_KN` when the jump exceeds five nautical miles.

These checks prevent markers from jumping across countries because of out-of-order or corrupted AIS positions.

## Persistence and browser independence

Render mounts `/var/data` as persistent storage. The global cache, priority cache, EcoFair state, CH-MARL episode file, and manual vessel file survive process restarts and deploys.

The AIS sockets and EcoFair timer start with the backend process. Closing the browser does not stop vessel collection or model updates.

## Health verification

`GET /health` exposes separate objects:

```text
aisstream
operationalAisstream
trackingScope
operationalScope
persistence
```

Check both socket states and both cached-vessel counts when diagnosing coverage.
