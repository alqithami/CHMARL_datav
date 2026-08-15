# AIS tracking continuity

All vessel positions in the production portal originate from a genuine live AIS connection. The runtime does not load manual vessels, fixed vessel files, sample vessel files, or synthetic continuity rows.

## Primary tracking and automatic recovery

- The primary subscription is worldwide using the bounding box `-90,-180;90,180` with no message-type filter.
- A connected socket that produces no first frame within 30 seconds is treated as failed, not healthy.
- The runtime reconnects and rotates through live AISStream profiles: worldwide unfiltered, worldwide position-only, Red Sea/Gulf position-only, and monitored-port position-only.
- The first profile that delivers real AIS frames remains active. Every profile, switch, timeout, and successful profile is exposed through `/health` and `/api/vessels`.
- Recovery diagnostics include the active profile, profile-switch and cycle counts, the latest recovery reason, per-connection frame count, and the last profile that successfully delivered AIS data.
- Monitored-port operational rows are always derived from the same genuine AIS observations used by the map.
- Recent real AIS positions may remain in the persistent AIS cache during a short interruption, retaining their MMSI and original timestamps.

## Provider outage boundary

Automatic profile rotation repairs silent connections, overloaded worldwide subscriptions, and subscription-specific delivery failures. It cannot manufacture frames during a service-wide AISStream upstream outage. During such an outage the portal reports zero current vessels rather than inserting placeholders. Continuous production availability therefore requires a second genuine live AIS provider; manual or fabricated vessel rows remain prohibited.
