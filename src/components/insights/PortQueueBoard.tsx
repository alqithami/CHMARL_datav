import type { PortQueueStatus } from "@/providers/portOperationsProvider";
import type { PortOpsDataSource } from "@/data/loadSampleDashboardData";

export type PortQueueBoardProps = {
  rows: PortQueueStatus[];
  source: PortOpsDataSource;
  compact?: boolean;
};

function utilization(row: PortQueueStatus) {
  if (typeof row.utilizationPct === "number" && Number.isFinite(row.utilizationPct)) return row.utilizationPct;
  if (typeof row.queueLength === "number" && Number.isFinite(row.queueLength)) return Math.min(100, row.queueLength * 12);
  if (typeof row.waitingVessels === "number" && Number.isFinite(row.waitingVessels)) return Math.min(100, row.waitingVessels * 10);
  return 0;
}

function severity(value: number) {
  if (value >= 90) return "alert";
  if (value >= 75) return "warning";
  return "nominal";
}

function sourceLabel(source: PortOpsDataSource) {
  if (source === "runtime") return "runtime provider";
  if (source === "demo") return "Kpler-like demo queue";
  if (source === "local-json") return "local fixture";
  return "provider required";
}

export default function PortQueueBoard({ rows, source, compact = false }: PortQueueBoardProps) {
  const sorted = [...rows].sort((a, b) => utilization(b) - utilization(a));
  const pressureRows = sorted.filter((row) => utilization(row) >= 75).length;

  return (
    <div className="port-queue-board insight-panel-content">
      <div className="insight-panel-summary">
        <span>Queue / berth board</span>
        <strong>{rows.length}</strong>
        <small>{pressureRows} pressure rows · {sourceLabel(source)}</small>
      </div>
      <div className={compact ? "port-queue-list compact" : "port-queue-list"}>
        {sorted.length === 0 ? (
          <p className="insight-empty-state">No queue/berth rows available yet. Connect a port provider or use demo queue generation.</p>
        ) : sorted.map((row) => {
          const value = utilization(row);
          return (
            <article key={`${row.portId}-${row.berthId ?? "queue"}`} className="port-queue-row">
              <div>
                <strong>{row.portId}</strong>
                <small>{row.berthId ?? "all berths"} · queue {row.queueLength ?? row.waitingVessels ?? "n/a"}</small>
              </div>
              <span className={`ship-status ${severity(value)}`}>{Math.round(value)}%</span>
              <div className="constraint-meter" aria-label={`${row.portId} berth utilization`}><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
