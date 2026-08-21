import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchFirstJson } from "@/providers/backendUrl";

export type VesselRegistrySummary = {
  enabled: boolean;
  status: string;
  knownVessels: number;
  withPosition: number;
  live: number;
  delayed: number;
  lastKnown: number;
  archived: number;
  identityOnly: number;
  imoAnchored: number;
  mmsiAnchored: number;
  openIdentityConflicts: number;
  trackPoints: number;
  identityChanges: number;
  lastIngestAt?: string | null;
  storagePolicy?: {
    permanentVesselRecords?: boolean;
    permanentIdentityHistory?: boolean;
    latestPositionRetained?: boolean;
  };
};

type RegistryRow = {
  vessel_uuid: string;
  canonical_imo?: string | null;
  current_mmsi?: string | null;
  current_name: string;
  current_call_sign?: string | null;
  current_flag?: string | null;
  ship_type?: string | null;
  length_m?: number | null;
  beam_m?: number | null;
  draught_m?: number | null;
  first_seen_at: string;
  last_seen_at: string;
  preferred_source?: string | null;
  identity_confidence: number;
  verified_status: string;
  latitude?: number | null;
  longitude?: number | null;
  speed_knots?: number | null;
  course_deg?: number | null;
  heading_deg?: number | null;
  navigation_status?: string | null;
  destination?: string | null;
  eta?: string | null;
  observed_at?: string | null;
  provider?: string | null;
  operational?: number | null;
  registryStatus: "live" | "delayed" | "last-known" | "archived" | "identity-only";
  positionAgeMs?: number | null;
};

type RegistryList = {
  rows: RegistryRow[];
  total: number;
  limit: number;
  offset: number;
  query: string;
  status: string;
};

type IdentifierRow = {
  identifier_id: number;
  identifier_type: string;
  identifier_value: string;
  valid_from: string;
  valid_to?: string | null;
  last_observed_at: string;
  source?: string | null;
  confidence: number;
  active: number;
};

type HistoryRow = {
  history_id: number;
  attribute: string;
  old_value?: string | null;
  new_value?: string | null;
  observed_at: string;
  source?: string | null;
};

type RegistryDetail = RegistryRow & { identifiers?: IdentifierRow[] };

const statusOptions = [
  ["", "All records"],
  ["live", "Live"],
  ["delayed", "Delayed"],
  ["last-known", "Last known"],
  ["archived", "Archived"],
  ["identity-only", "Identity only"],
] as const;

function formatNumber(value: number | undefined) {
  return new Intl.NumberFormat("en-US").format(value ?? 0);
}

function formatTime(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(parsed));
}

function formatAge(value: number | null | undefined) {
  if (value === null || value === undefined) return "No position";
  if (value < 60_000) return `${Math.max(0, Math.round(value / 1_000))} sec`;
  if (value < 3_600_000) return `${Math.round(value / 60_000)} min`;
  if (value < 86_400_000) return `${(value / 3_600_000).toFixed(1)} hr`;
  return `${(value / 86_400_000).toFixed(1)} days`;
}

function titleCase(value: string) {
  return value.split(/[-_]/).map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part).join(" ");
}

export default function VesselRegistryPanel() {
  const [summary, setSummary] = useState<VesselRegistrySummary | null>(null);
  const [list, setList] = useState<RegistryList>({ rows: [], total: 0, limit: 100, offset: 0, query: "", status: "all" });
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [selectedUuid, setSelectedUuid] = useState("");
  const [detail, setDetail] = useState<RegistryDetail | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async (nextQuery = query, nextStatus = status) => {
    setLoading(true);
    setError(null);
    const search = new URLSearchParams({ limit: "100" });
    if (nextQuery.trim()) search.set("q", nextQuery.trim());
    if (nextStatus) search.set("status", nextStatus);
    const [nextSummary, nextList] = await Promise.all([
      fetchFirstJson<VesselRegistrySummary>("/api/registry/stats"),
      fetchFirstJson<RegistryList>(`/api/registry/vessels?${search.toString()}`),
    ]);
    if (!nextSummary || !nextList) {
      setError("The persistent vessel registry is not available from the current backend.");
      setLoading(false);
      return;
    }
    setSummary(nextSummary);
    setList(nextList);
    setLoading(false);
  }, [query, status]);

  useEffect(() => {
    void loadList("", "");
  }, [loadList]);

  useEffect(() => {
    if (!selectedUuid) {
      setDetail(null);
      setHistory([]);
      return;
    }
    let cancelled = false;
    Promise.all([
      fetchFirstJson<RegistryDetail>(`/api/registry/vessels/${encodeURIComponent(selectedUuid)}`),
      fetchFirstJson<HistoryRow[]>(`/api/registry/vessels/${encodeURIComponent(selectedUuid)}/identity-history?limit=100`),
    ]).then(([nextDetail, nextHistory]) => {
      if (cancelled) return;
      setDetail(nextDetail);
      setHistory(nextHistory ?? []);
    });
    return () => { cancelled = true; };
  }, [selectedUuid]);

  const summaryCards = useMemo(() => summary ? [
    { label: "Known vessels", value: summary.knownVessels, tone: "info" },
    { label: "Live", value: summary.live, tone: "good" },
    { label: "Delayed", value: summary.delayed, tone: "warning" },
    { label: "Last known", value: summary.lastKnown, tone: "info" },
    { label: "Archived", value: summary.archived, tone: "muted" },
    { label: "Identity only", value: summary.identityOnly, tone: "muted" },
    { label: "IMO anchored", value: summary.imoAnchored, tone: "good" },
    { label: "Open conflicts", value: summary.openIdentityConflicts, tone: summary.openIdentityConflicts > 0 ? "warning" : "good" },
  ] : [], [summary]);

  return (
    <section className="vessel-registry-panel" aria-label="Persistent vessel registry">
      <header className="vessel-registry-heading">
        <div>
          <span>Persistent identity and last-known state</span>
          <strong>Vessel Registry</strong>
          <small>Identity records remain permanent; movement state is updated only from genuine AIS observations.</small>
        </div>
        <button type="button" onClick={() => void loadList()}>Refresh registry</button>
      </header>

      {summary && (
        <div className="vessel-registry-summary">
          {summaryCards.map((card) => (
            <article key={card.label} className={card.tone}>
              <span>{card.label}</span><strong>{formatNumber(card.value)}</strong>
            </article>
          ))}
        </div>
      )}

      <form className="vessel-registry-toolbar" onSubmit={(event) => { event.preventDefault(); void loadList(); }}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search vessel name, IMO, MMSI, or call sign" aria-label="Search vessel registry" />
        <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter registry by position state">
          {statusOptions.map(([value, label]) => <option key={label} value={value}>{label}</option>)}
        </select>
        <button type="submit">Apply filters</button>
        <span>{formatNumber(list.total)} matching records</span>
      </form>

      {error && <div className="vessel-registry-error"><strong>Registry unavailable</strong><small>{error}</small></div>}

      <div className="vessel-registry-workspace">
        <div className="vessel-registry-table-wrap">
          <table>
            <thead><tr><th>Vessel</th><th>IMO</th><th>MMSI</th><th>Type</th><th>State</th><th>Last observed</th><th>Source</th></tr></thead>
            <tbody>
              {loading && list.rows.length === 0 ? (
                <tr><td colSpan={7}>Loading permanent vessel records…</td></tr>
              ) : list.rows.length === 0 ? (
                <tr><td colSpan={7}>No registry records match the current filters.</td></tr>
              ) : list.rows.map((row) => (
                <tr key={row.vessel_uuid} className={selectedUuid === row.vessel_uuid ? "selected" : ""} onClick={() => setSelectedUuid(row.vessel_uuid)}>
                  <td><strong>{row.current_name}</strong><small>{row.current_call_sign || row.current_flag || row.vessel_uuid}</small></td>
                  <td>{row.canonical_imo || "—"}</td>
                  <td>{row.current_mmsi || "—"}</td>
                  <td>{row.ship_type || "Unspecified"}</td>
                  <td><span className={`registry-state ${row.registryStatus}`}>{titleCase(row.registryStatus)}</span></td>
                  <td><strong>{formatTime(row.observed_at)}</strong><small>{formatAge(row.positionAgeMs)}</small></td>
                  <td>{row.provider || row.preferred_source || "Unknown"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="vessel-registry-detail">
          {!detail ? (
            <div className="vessel-registry-detail-empty"><strong>Select a vessel record</strong><small>Inspect canonical identity, specifications, latest position, identifiers, and change history.</small></div>
          ) : (
            <>
              <header>
                <div><span>{titleCase(detail.registryStatus)}</span><strong>{detail.current_name}</strong><small>{detail.vessel_uuid}</small></div>
                <span className={`registry-state ${detail.registryStatus}`}>{titleCase(detail.registryStatus)}</span>
              </header>
              <dl className="vessel-registry-facts">
                <div><dt>IMO</dt><dd>{detail.canonical_imo || "Not verified"}</dd></div>
                <div><dt>MMSI</dt><dd>{detail.current_mmsi || "Not available"}</dd></div>
                <div><dt>Call sign</dt><dd>{detail.current_call_sign || "—"}</dd></div>
                <div><dt>Flag</dt><dd>{detail.current_flag || "—"}</dd></div>
                <div><dt>Ship type</dt><dd>{detail.ship_type || "Unspecified"}</dd></div>
                <div><dt>Dimensions</dt><dd>{detail.length_m ? `${detail.length_m} × ${detail.beam_m ?? "?"} m` : "—"}</dd></div>
                <div><dt>Draught</dt><dd>{detail.draught_m === null || detail.draught_m === undefined ? "—" : `${detail.draught_m} m`}</dd></div>
                <div><dt>Identity anchor</dt><dd>{titleCase(detail.verified_status)}</dd></div>
                <div><dt>Latest position</dt><dd>{detail.latitude === null || detail.latitude === undefined ? "No position" : `${detail.latitude.toFixed(4)}, ${detail.longitude?.toFixed(4)}`}</dd></div>
                <div><dt>Speed / course</dt><dd>{detail.speed_knots === null || detail.speed_knots === undefined ? "—" : `${detail.speed_knots.toFixed(1)} kn`} · {detail.course_deg === null || detail.course_deg === undefined ? "—" : `${detail.course_deg.toFixed(0)}°`}</dd></div>
                <div><dt>Position provider</dt><dd>{detail.provider || "—"}</dd></div>
                <div><dt>First / last seen</dt><dd>{formatTime(detail.first_seen_at)} · {formatTime(detail.last_seen_at)}</dd></div>
              </dl>

              <section>
                <h3>Identifier history</h3>
                <div className="vessel-registry-identifiers">
                  {(detail.identifiers ?? []).map((identifier) => (
                    <article key={identifier.identifier_id} className={identifier.active ? "active" : "closed"}>
                      <span>{titleCase(identifier.identifier_type)}</span><strong>{identifier.identifier_value}</strong><small>{identifier.active ? "Active" : `Closed ${formatTime(identifier.valid_to)}`} · {identifier.source || "unknown source"}</small>
                    </article>
                  ))}
                </div>
              </section>

              <section>
                <h3>Recent identity changes</h3>
                <div className="vessel-registry-history">
                  {history.length === 0 ? <p>No identity changes recorded.</p> : history.slice(0, 10).map((entry) => (
                    <article key={entry.history_id}><span>{titleCase(entry.attribute)}</span><strong>{entry.old_value || "—"} → {entry.new_value || "—"}</strong><small>{formatTime(entry.observed_at)} · {entry.source || "unknown source"}</small></article>
                  ))}
                </div>
              </section>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
