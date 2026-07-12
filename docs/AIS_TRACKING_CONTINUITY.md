# AIS tracking continuity

The dashboard distinguishes two vessel counts:

- **Current API rows**: vessels present in the latest `/api/vessels` response.
- **Stable display rows**: vessels retained by the browser tracking registry so a temporary provider omission does not immediately remove a marker.

## Retention behavior

- General worldwide display rows are retained for up to 60 minutes after their last appearance in an API response.
- Rows in the Middle East operational corridor are retained for up to 6 hours.
- A vessel is removed earlier only when its coordinates are invalid.
- Older timestamps and physically implausible position jumps do not replace the last accepted position.
- Existing spatial sample membership is sticky; newly observed vessels fill available grid capacity instead of displacing visible rows on every refresh.

The readiness panel reports the stable display count, current API count, refreshed count, and rows temporarily held between updates.

## Operational calculations remain current

This continuity layer is for map and table presentation only. EcoFair-CH-MARL, port queues, berth utilization, emissions, fairness, rewards, and constraints continue to use the backend operational vessel scope rather than browser-retained display rows. This prevents a temporarily retained marker from being treated as a current port measurement.
