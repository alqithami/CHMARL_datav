import { useMemo } from "react";
import type { Vessel } from "@/data/chmarlData";
import { primaryMonitoredPortIds, summarizePortCoverage } from "@/utils/portCoverage";

export type PortCoverageMatrixProps = {
  vessels: Vessel[];
  compact?: boolean;
};

function rowTone(count: number, area: string) {
  if (count > 0) return "active";
  return area === "Saudi" ? "watch" : "empty";
}

export default function PortCoverageMatrix({ vessels, compact = false }: PortCoverageMatrixProps) {
  const summary = useMemo(() => summarizePortCoverage(vessels), [vessels]);
  const sortedRows = useMemo(
    () => [...summary.rows].sort((a, b) => {
      const aPrimary = primaryMonitoredPortIds.has(a.port.id);
      const bPrimary = primaryMonitoredPortIds.has(b.port.id);
      if (aPrimary !== bPrimary) return aPrimary ? -1 : 1;
      if (a.port.area !== b.port.area) return a.port.area === "Saudi" ? -1 : 1;
      return b.count - a.count || a.port.id.localeCompare(b.port.id);
    }),
    [summary.rows]
  );
  const activeSaudiPorts = summary.rows.filter((row) => row.port.area === "Saudi" && row.count > 0).length;
  const saudiPorts = summary.rows.filter((row) => row.port.area === "Saudi").length;
  const primaryRows = summary.rows
    .filter((row) => primaryMonitoredPortIds.has(row.port.id))
    .reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="port-coverage-matrix insight-panel-content">
      <div className="insight-panel-summary">
        <span>Eight-port AIS coverage</span>
        <strong>{summary.saudiNearPort + summary.regionalNearPort}/{summary.totalRows}</strong>
        <small>Jeddah + KAP: {primaryRows} · {activeSaudiPorts}/{saudiPorts} Saudi ports active · {summary.offshore} outside scope</small>
      </div>
      <div className={compact ? "port-coverage-list compact" : "port-coverage-list"}>
        {sortedRows.map((row) => (
          <article key={row.port.id} className={`port-coverage-row ${rowTone(row.count, row.port.area)}`} title={row.examples.length > 0 ? row.examples.join(", ") : "No live AIS rows within threshold"}>
            <div>
              <strong>{row.port.id}</strong>
              <small>{row.port.shortId} · {row.port.area} · {summary.maxDistanceNm} nm radius</small>
            </div>
            <span className="port-coverage-count">{row.count}</span>
            <div className="port-coverage-meter" aria-label={`${row.port.id} AIS coverage share`}>
              <span style={{ width: `${Math.min(100, row.sharePct)}%` }} />
            </div>
            <small className="port-coverage-meta">{row.sharePct}% share · {row.fresh} fresh · {row.stale} stale</small>
          </article>
        ))}
      </div>
    </div>
  );
}
