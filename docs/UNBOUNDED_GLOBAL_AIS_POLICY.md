# Unbounded global AIS tracking policy

The Operational Vessel Intelligence Dashboard does not impose a fixed vessel-count ceiling on genuine AIS observations.

## Tracking policy

- AISStream subscribes to the worldwide bounding box `-90,-180;90,180`.
- Recovery profiles may reduce message types to position-bearing AIS messages, but they do not narrow the geographic bounding box.
- PocketWorld snapshots are paginated until the provider reports that the snapshot is complete or the defensive page-loop guard is reached.
- Datalastic rows returned by configured scans are retained without a local count ceiling.
- Provider rows are merged by vessel ID, with the newest timestamp retained when multiple providers report the same vessel.
- Valid coordinates across latitude `[-90, 90]` and longitude `[-180, 180]` remain in the API and vessel context views.
- The frontend does not spatially sample, prefer one region, or apply a vessel-count cap.
- A uniform six-hour retention window is used by default. Retention is time-based rather than geography-based.

In environment configuration, a value of `0` means **unlimited by vessel count**:

```dotenv
AISSTREAM_MAX_VESSELS=0
AISSTREAM_OPERATIONAL_MAX_VESSELS=0
DATALASTIC_MAX_VESSELS=0
POCKETWORLD_MAX_VESSELS=0
```

Unlimited means that the application applies no fixed count ceiling. Memory, provider availability, duplicate vessel identities, valid-coordinate requirements, and the freshness window still define the set of rows that can exist at a given time.

## What is not discarded by location

The runtime does not reject a valid AIS observation because it is outside Saudi Arabia, the Red Sea, the Arabian Gulf, or the eight monitored ports. Global tracking and the vessel table retain such observations.

Leaflet uses a Web Mercator basemap, whose visual projection cannot draw points extremely close to the poles. Those observations remain in the API and vessel lists even when they cannot be drawn on the raster basemap. This is a map-projection limitation, not a tracking-data discard.

## Operational calculation boundary

Global visibility and EcoFair-CH-MARL calculations remain separate:

- `/api/vessels` returns the complete retained tracking cohort.
- `/api/vessels?scope=operational` returns only fresh vessels within the monitored eight-port radius.
- `/api/vessels?scope=primary` returns only fresh vessels near Jeddah Islamic Port and King Abdullah Port.

Fuel, emissions, fairness, queue, reward, and constraint calculations continue to use only the fresh operational cohort. Global vessels are not reinterpreted as port traffic.

## Provider coverage

Removing local limits does not create observations that upstream AIS providers do not supply. If a provider currently exposes approximately 5,000 regional vessels, the portal may still show approximately that number until AISStream or another source delivers additional geographic coverage. The portal now retains every valid row it actually receives and exposes diagnostics showing whether a provider response is complete or partial.
