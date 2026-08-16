# Eight-port EcoFair operational scope

The portal retains the complete genuine AIS cohort returned by the backend, up to 20,000 vessels. It no longer spatially samples the global cohort down to a small representative set.

## Operational portfolio

EcoFair-CH-MARL calculations remain strictly geofenced to real AIS observations within the configured operational radius of these eight ports:

1. Jeddah Islamic Port (runtime id: Jeddah)
2. King Abdullah Port
3. Yanbu
4. Jizan
5. Dammam
6. Jubail Commercial Port
7. Jebel Ali
8. Suez

Jeddah Islamic Port and King Abdullah Port are the primary focus. The default map view stays on those two ports and automatically fits only when genuine AIS rows appear in their primary scope. The full global cohort remains available through the World AIS and Fit vessels controls.

## Calculation boundary

Global vessels outside the eight-port radius remain visible for tracking but are excluded from EcoFair fuel, emissions, fairness, reward, queue, berth-utilization, and constraint calculations. No manual, sample, fixed, or synthetic vessel is used to activate the model.

The API exposes three vessel scopes:

- /api/vessels — complete tracking cohort
- /api/vessels?scope=operational — eight-port operational cohort
- /api/vessels?scope=primary — Jeddah and King Abdullah Port cohort

EcoFair starts producing online CH-MARL steps only after at least one genuine AIS row enters the eight-port operational scope. Keeping more global vessels improves observability but cannot substitute for actual port-area AIS coverage.
