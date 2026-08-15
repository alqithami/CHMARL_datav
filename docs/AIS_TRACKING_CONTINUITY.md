# AIS tracking continuity

All vessel positions in the production portal originate from the live AISStream connection. The runtime does not load manual vessels, fixed vessel files, sample vessel files, or a secondary vessel API.

## Global tracking

- The backend sends one worldwide AIS subscription using the bounding box `-90,-180;90,180`.
- No message-type filter is sent to the provider. Position-bearing messages are normalized into vessel rows.
- Monitored-port operational rows are derived from the same live global stream; they are not fetched through a second connection.
- Recent AIS positions may remain in the AIS cache during a short connection interruption, but they retain their original AIS identity and timestamp.

## Truthful unavailable state

When the provider has not delivered live AIS frames, the portal displays an AIS waiting/degraded state and zero current vessels. It does not insert continuity placeholders. EcoFair-CH-MARL calculations remain inactive until real AIS rows enter the monitored-port scope.
