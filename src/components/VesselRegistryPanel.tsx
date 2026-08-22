import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchFirstJson } from "@/providers/backendUrl";
import type { VesselRegistrySummary } from "@/data/loadSampleDashboardData";

type RegistryStatus = "live" | "delayed" | "last-known" | "archived" | "identity-only";
type RegistrySort = "latest" | "name" | "first-seen" | "last-seen" | "confidence";
type SortDirection = "asc" | "desc";
type DetailTab = "identity" | "movement" | "sources";

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
  registryStatus: RegistryStatus;
  positionAgeMs?: number | null;
};

type RegistryList = {
  rows: RegistryRow[];
  total: number;
  limit: number;
  offset: number;
  query: string;
  status: string;
  sort?: RegistrySort;
  direction?: SortDirection;
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

type TrackRow = {
  track_id: number;
  latitude: number;
  longitude: number;
  speed_knots?: number | null;
  course_deg?: number | null;
  heading_deg?: number | null;
  navigation_status?: string | null;
  observed_at: string;
  observed_ms: number;
  provider: string;
  operational: number;
  resolution_seconds: number;
};

type ObservationRow = {
  observation_id: number;
  provider: string;
  observation_kind: string;
  observation_hash: string;
  observed_at: string;
  payload_json: string;
};

type ConflictRow = {
  conflict_id: number;
  identifier_type: string;
  identifier_value: string;
  existing_vessel_uuid?: string | null;
  incoming_vessel_uuid?: string | null;
  existing_vessel_name?: string | null;
  incoming_vessel_name?: string | null;
  incoming_imo?: string | null;
  incoming_mmsi?: string | null;
  observed_at: string;
  source?: string | null;
  resolution_status: string;
  details_json?: string | null;
};

type ConflictList = {
  rows: ConflictRow[];
  total: number;
  limit: number;
  offset: number;
  status: string;
};

type RegistryStats = VesselRegistrySummary & {
  activeIdentifiers?: number;
  providerObservations?: number;
  lastMaintenanceAt?: string | null;
  storage?: {
    databaseBytes?: number;
    walBytes?: number;
    shmBytes?: number;
    totalBytes?: number;
  };
  storagePolicy?: {
    permanentVesselRecords?: boolean;
    permanentIdentityHistory?: boolean;
    latestPositionRetained?: boolean;
    globalTrackBucketMs?: number;
    operationalTrackBucketMs?: number;
    fineTrackDays?: number;
    globalTrackRetentionDays?: number;
    operationalTrackRetentionDays?: number;
  };
  freshness?: {
    liveAgeMs?: number;
    delayedAgeMs?: number;
    lastKnownAgeMs?: number;
  };
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

const sortOptions: ReadonlyArray<[RegistrySort, string]> = [
  ["latest", "Latest position"],
  ["name", "Vessel name"],
  ["first-seen", "First seen"],
  ["last-seen", "Last identity update"],
  ["confidence", "Identity confidence"],
];

const pageSizeOptions = [50, 100, 250] as const;

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

function formatBytes(value: number | null | undefined) {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1_024) return `${bytes.toFixed(0)} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
}

function formatDuration(milliseconds: number | undefined) {
  if (!milliseconds || milliseconds <= 0) return "—";
  if (milliseconds < 3_600_000) return `${Math.round(milliseconds / 60_000)} min`;
  if (milliseconds < 86_400_000) return `${(milliseconds / 3_600_000).toFixed(1)} hr`;
  return `${(milliseconds / 86_400_000).toFixed(1)} days`;
}

function titleCase(value: string) {
  return value.split(/[-_]/).map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part).join(" ");
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportRegistryRows(rows: RegistryRow[]) {
  const header = ["Vessel UUID", "Name", "IMO", "MMSI", "Call sign", "Flag", "Ship type", "State", "Last observed", "Latitude", "Longitude", "Speed knots", "Provider"];
  const body = rows.map((row) => [
    row.vessel_uuid,
    row.current_name,
    row.canonical_imo,
    row.current_mmsi,
    row.current_call_sign,
    row.current_flag,
    row.ship_type,
    row.registryStatus,
    row.observed_at,
    row.latitude,
    row.longitude,
    row.speed_knots,
    row.provider ?? row.preferred_source,
  ]);
  const csv = [header, ...body].map((cells) => cells.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `chmarl-vessel-registry-page-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function radians(value: number) {
  return value * Math.PI / 180;
}

function distanceNm(a: TrackRow, b: TrackRow) {
  const radiusNm = 3440.065;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusNm * Math.asin(Math.min(1, Math.sqrt(h)));
}

function parsePayload(payloadJson: string) {
  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    const fields = ["name", "imo", "mmsi", "callSign", "flag", "shipType"]
      .flatMap((key) => payload[key] === undefined || payload[key] === null || payload[key] === "" ? [] : [`${titleCase(key)}: ${String(payload[key])}`]);
    return fields.slice(0, 3).join(" · ") || "Provider payload retained for audit";
  } catch {
    return "Provider payload retained for audit";
  }
}

function conflictReason(row: ConflictRow) {
  try {
    const payload = JSON.parse(row.details_json ?? "{}") as { reason?: string };
    return payload.reason ?? "Identifier requires operator review";
  } catch {
    return "Identifier requires operator review";
  }
}

function buildTrackPolyline(track: TrackRow[]) {
  if (track.length < 2) return "";
  const latitudes = track.map((point) => point.latitude);
  const longitudes = track.map((point) => point.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLon = Math.min(...longitudes);
  const maxLon = Math.max(...longitudes);
  const latSpan = Math.max(0.0001, maxLat - minLat);
  const lonSpan = Math.max(0.0001, maxLon - minLon);
  return track.map((point) => {
    const x = 12 + ((point.longitude - minLon) / lonSpan) * 396;
    const y = 108 - ((point.latitude - minLat) / latSpan) * 96;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

export default function VesselRegistryPanel() {
  const [summary, setSummary] = useState<RegistryStats | null>(null);
  const [list, setList] = useState<RegistryList>({ rows: [], total: 0, limit: 100, offset: 0, query: "", status: "all", sort: "latest", direction: "desc" });
  const [conflicts, setConflicts] = useState<ConflictList>({ rows: [], total: 0, limit: 50, offset: 0, status: "open" });
  const [queryInput, setQueryInput] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [appliedStatus, setAppliedStatus] = useState("");
  const [sort, setSort] = useState<RegistrySort>("latest");
  const [direction, setDirection] = useState<SortDirection>("desc");
  const [pageSize, setPageSize] = useState(100);
  const [offset, setOffset] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);
  const [selectedUuid, setSelectedUuid] = useState("");
  const [selectedTab, setSelectedTab] = useState<DetailTab>("identity");
  const [detail, setDetail] = useState<RegistryDetail | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [track, setTrack] = useState<TrackRow[]>([]);
  const [observations, setObservations] = useState<ObservationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    const search = new URLSearchParams({
      limit: String(pageSize),
      offset: String(offset),
      sort,
      direction,
    });
    if (appliedQuery) search.set("q", appliedQuery);
    if (appliedStatus) search.set("status", appliedStatus);
    const [nextSummary, nextList, nextConflicts] = await Promise.all([
      fetchFirstJson<RegistryStats>("/api/registry/stats"),
      fetchFirstJson<RegistryList>(`/api/registry/vessels?${search.toString()}`),
      fetchFirstJson<ConflictList>("/api/registry/conflicts?status=open&limit=50"),
    ]);
    if (!nextSummary || !nextList) {
      setError("The persistent vessel registry is not available from the current backend.");
      setLoading(false);
      return;
    }
    setSummary(nextSummary);
    setList(nextList);
    setConflicts(nextConflicts ?? { rows: [], total: 0, limit: 50, offset: 0, status: "open" });
    setLoading(false);
  }, [appliedQuery, appliedStatus, direction, offset, pageSize, refreshToken, sort]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selectedUuid) {
      setDetail(null);
      setHistory([]);
      setTrack([]);
      setObservations([]);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setSelectedTab("identity");
    Promise.all([
      fetchFirstJson<RegistryDetail>(`/api/registry/vessels/${encodeURIComponent(selectedUuid)}`),
      fetchFirstJson<HistoryRow[]>(`/api/registry/vessels/${encodeURIComponent(selectedUuid)}/identity-history?limit=200`),
      fetchFirstJson<TrackRow[]>(`/api/registry/vessels/${encodeURIComponent(selectedUuid)}/track?limit=2000`),
      fetchFirstJson<ObservationRow[]>(`/api/registry/vessels/${encodeURIComponent(selectedUuid)}/observations?limit=200`),
    ]).then(([nextDetail, nextHistory, nextTrack, nextObservations]) => {
      if (cancelled) return;
      setDetail(nextDetail);
      setHistory(nextHistory ?? []);
      setTrack(nextTrack ?? []);
      setObservations(nextObservations ?? []);
      setDetailLoading(false);
    });
    return () => { cancelled = true; };
  }, [selectedUuid]);

  const summaryCards = useMemo(() => summary ? [
    { label: "Known vessels", value: formatNumber(summary.knownVessels), tone: "info" },
    { label: "Live", value: formatNumber(summary.live), tone: "good" },
    { label: "Delayed", value: formatNumber(summary.delayed), tone: "warning" },
    { label: "Last known", value: formatNumber(summary.lastKnown), tone: "info" },
    { label: "Archived", value: formatNumber(summary.archived), tone: "muted" },
    { label: "IMO anchored", value: formatNumber(summary.imoAnchored), tone: "good" },
    { label: "Track points", value: formatNumber(summary.trackPoints), tone: "info" },
    { label: "Identity changes", value: formatNumber(summary.identityChanges), tone: "info" },
    { label: "Open conflicts", value: formatNumber(summary.openIdentityConflicts), tone: summary.openIdentityConflicts > 0 ? "warning" : "good" },
    { label: "Registry storage", value: formatBytes(summary.storage?.totalBytes), tone: "muted" },
  ] : [], [summary]);

  const movement = useMemo(() => {
    if (track.length === 0) return null;
    let distance = 0;
    for (let index = 1; index < track.length; index += 1) distance += distanceNm(track[index - 1], track[index]);
    const speeds = track.map((point) => point.speed_knots).filter((value): value is number => Number.isFinite(value));
    const providers = new Set(track.map((point) => point.provider));
    return {
      distance,
      averageSpeed: speeds.length ? speeds.reduce((sum, value) => sum + value, 0) / speeds.length : undefined,
      maximumSpeed: speeds.length ? Math.max(...speeds) : undefined,
      operationalPoints: track.filter((point) => point.operational === 1).length,
      providerCount: providers.size,
      durationMs: Math.max(0, track.at(-1)!.observed_ms - track[0].observed_ms),
      polyline: buildTrackPolyline(track),
    };
  }, [track]);

  const page = Math.floor(list.offset / Math.max(1, list.limit)) + 1;
  const pageCount = Math.max(1, Math.ceil(list.total / Math.max(1, list.limit)));
  const firstRow = list.total === 0 ? 0 : list.offset + 1;
  const lastRow = Math.min(list.total, list.offset + list.rows.length);

  const applyFilters = () => {
    setAppliedQuery(queryInput.trim());
    setAppliedStatus(statusInput);
    setOffset(0);
    setRefreshToken((value) => value + 1);
  };

  return (
    <section className="vessel-registry-panel" aria-label="Persistent vessel registry">
      <header className="vessel-registry-heading">
        <div>
          <span>Persistent identity, movement, and source audit</span>
          <strong>Vessel Registry</strong>
          <small>Identity records remain permanent; movement state is updated only from genuine AIS observations.</small>
        </div>
        <div className="vessel-registry-heading-actions">
          <button type="button" onClick={() => exportRegistryRows(list.rows)} disabled={list.rows.length === 0}>Export page</button>
          <button type="button" onClick={() => setRefreshToken((value) => value + 1)}>Refresh registry</button>
        </div>
      </header>

      {summary && (
        <div className="vessel-registry-summary">
          {summaryCards.map((card) => (
            <article key={card.label} className={card.tone}>
              <span>{card.label}</span><strong>{card.value}</strong>
            </article>
          ))}
        </div>
      )}

      {conflicts.total > 0 && (
        <details className="vessel-registry-conflicts">
          <summary><span>Identity review queue</span><strong>{formatNumber(conflicts.total)} open conflict{conflicts.total === 1 ? "" : "s"}</strong></summary>
          <div>
            {conflicts.rows.map((row) => (
              <article key={row.conflict_id}>
                <span>{titleCase(row.identifier_type)} · {row.identifier_value}</span>
                <strong>{row.existing_vessel_name || row.existing_vessel_uuid || "Existing vessel"} ↔ {row.incoming_vessel_name || row.incoming_vessel_uuid || "Incoming vessel"}</strong>
                <small>{conflictReason(row)} · {formatTime(row.observed_at)} · {row.source || "unknown source"}</small>
              </article>
            ))}
          </div>
        </details>
      )}

      <form className="vessel-registry-toolbar" onSubmit={(event) => { event.preventDefault(); applyFilters(); }}>
        <input value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="Search vessel name, IMO, MMSI, or call sign" aria-label="Search vessel registry" />
        <select value={statusInput} onChange={(event) => setStatusInput(event.target.value)} aria-label="Filter registry by position state">
          {statusOptions.map(([value, label]) => <option key={label} value={value}>{label}</option>)}
        </select>
        <select value={sort} onChange={(event) => { setSort(event.target.value as RegistrySort); setOffset(0); }} aria-label="Sort vessel registry">
          {sortOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={direction} onChange={(event) => { setDirection(event.target.value as SortDirection); setOffset(0); }} aria-label="Registry sort direction">
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
        <button type="submit">Apply filters</button>
        <span>{formatNumber(list.total)} matching records</span>
      </form>

      {error && <div className="vessel-registry-error"><strong>Registry unavailable</strong><small>{error}</small></div>}

      <div className="vessel-registry-workspace">
        <div className="vessel-registry-list-pane">
          <div className="vessel-registry-table-wrap">
            <table>
              <thead><tr><th>Vessel</th><th>IMO</th><th>MMSI</th><th>Type</th><th>State</th><th>Last observed</th><th>Source</th></tr></thead>
              <tbody>
                {loading && list.rows.length === 0 ? (
                  <tr><td colSpan={7}>Loading permanent vessel records…</td></tr>
                ) : list.rows.length === 0 ? (
                  <tr><td colSpan={7}>No registry records match the current filters.</td></tr>
                ) : list.rows.map((row) => (
                  <tr
                    key={row.vessel_uuid}
                    className={selectedUuid === row.vessel_uuid ? "selected" : ""}
                    tabIndex={0}
                    onClick={() => setSelectedUuid(row.vessel_uuid)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedUuid(row.vessel_uuid);
                      }
                    }}>
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

          <footer className="vessel-registry-pagination">
            <span>Showing {formatNumber(firstRow)}–{formatNumber(lastRow)} of {formatNumber(list.total)}</span>
            <label>Rows <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setOffset(0); }}>{pageSizeOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <div>
              <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Previous</button>
              <span>Page {page} of {pageCount}</span>
              <button type="button" disabled={offset + pageSize >= list.total} onClick={() => setOffset(offset + pageSize)}>Next</button>
            </div>
          </footer>
        </div>

        <aside className="vessel-registry-detail">
          {!detail ? (
            <div className="vessel-registry-detail-empty"><strong>{detailLoading ? "Loading vessel record…" : "Select a vessel record"}</strong><small>Inspect canonical identity, movement history, provider evidence, and change history.</small></div>
          ) : (
            <>
              <header>
                <div><span>{titleCase(detail.registryStatus)}</span><strong>{detail.current_name}</strong><small>{detail.vessel_uuid}</small></div>
                <span className={`registry-state ${detail.registryStatus}`}>{titleCase(detail.registryStatus)}</span>
              </header>

              <nav className="vessel-registry-tabs" aria-label="Vessel registry detail views">
                <button type="button" className={selectedTab === "identity" ? "active" : ""} onClick={() => setSelectedTab("identity")}>Identity</button>
                <button type="button" className={selectedTab === "movement" ? "active" : ""} onClick={() => setSelectedTab("movement")}>Movement <span>{track.length}</span></button>
                <button type="button" className={selectedTab === "sources" ? "active" : ""} onClick={() => setSelectedTab("sources")}>Sources <span>{observations.length}</span></button>
              </nav>

              {selectedTab === "identity" && (
                <div className="vessel-registry-tab-content">
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
                      {history.length === 0 ? <p>No identity changes recorded.</p> : history.slice(0, 20).map((entry) => (
                        <article key={entry.history_id}><span>{titleCase(entry.attribute)}</span><strong>{entry.old_value || "—"} → {entry.new_value || "—"}</strong><small>{formatTime(entry.observed_at)} · {entry.source || "unknown source"}</small></article>
                      ))}
                    </div>
                  </section>
                </div>
              )}

              {selectedTab === "movement" && (
                <div className="vessel-registry-tab-content movement">
                  {!movement ? (
                    <div className="vessel-registry-detail-empty"><strong>No retained movement history</strong><small>The latest position remains stored; track points appear as genuine AIS movement observations are retained.</small></div>
                  ) : (
                    <>
                      <div className="vessel-movement-summary">
                        <article><span>Track points</span><strong>{formatNumber(track.length)}</strong></article>
                        <article><span>Approx. distance</span><strong>{movement.distance.toFixed(1)} NM</strong></article>
                        <article><span>Average SOG</span><strong>{movement.averageSpeed === undefined ? "—" : `${movement.averageSpeed.toFixed(1)} kn`}</strong></article>
                        <article><span>Maximum SOG</span><strong>{movement.maximumSpeed === undefined ? "—" : `${movement.maximumSpeed.toFixed(1)} kn`}</strong></article>
                        <article><span>Time span</span><strong>{formatDuration(movement.durationMs)}</strong></article>
                        <article><span>Operational points</span><strong>{formatNumber(movement.operationalPoints)}</strong></article>
                      </div>
                      <figure className="vessel-track-figure">
                        <svg viewBox="0 0 420 120" role="img" aria-label={`Retained movement trace with ${track.length} points`}>
                          <path d="M12 108H408" />
                          <polyline points={movement.polyline} />
                          <circle cx="12" cy="108" r="3" />
                        </svg>
                        <figcaption>{formatTime(track[0]?.observed_at)} to {formatTime(track.at(-1)?.observed_at)} · {movement.providerCount} provider{movement.providerCount === 1 ? "" : "s"}</figcaption>
                      </figure>
                      <div className="vessel-track-table-wrap">
                        <table>
                          <thead><tr><th>Observed</th><th>Position</th><th>SOG</th><th>Course</th><th>Provider</th><th>Resolution</th></tr></thead>
                          <tbody>{[...track].reverse().slice(0, 30).map((point) => (
                            <tr key={point.track_id}><td>{formatTime(point.observed_at)}</td><td>{point.latitude.toFixed(4)}, {point.longitude.toFixed(4)}</td><td>{point.speed_knots === null || point.speed_knots === undefined ? "—" : `${point.speed_knots.toFixed(1)} kn`}</td><td>{point.course_deg === null || point.course_deg === undefined ? "—" : `${point.course_deg.toFixed(0)}°`}</td><td>{point.provider}</td><td>{formatDuration(point.resolution_seconds * 1_000)}</td></tr>
                          ))}</tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}

              {selectedTab === "sources" && (
                <div className="vessel-registry-tab-content sources">
                  <div className="vessel-source-summary">
                    <article><span>Audit observations</span><strong>{formatNumber(observations.length)}</strong></article>
                    <article><span>Current source</span><strong>{detail.provider || detail.preferred_source || "Unknown"}</strong></article>
                    <article><span>Identity confidence</span><strong>{`${Math.round(detail.identity_confidence * 100)}%`}</strong></article>
                  </div>
                  <div className="vessel-source-timeline">
                    {observations.length === 0 ? <p>No provider audit observations retained for this vessel.</p> : observations.map((observation) => (
                      <article key={observation.observation_id}>
                        <i />
                        <div><span>{titleCase(observation.observation_kind)}</span><strong>{observation.provider}</strong><small>{parsePayload(observation.payload_json)}</small></div>
                        <time>{formatTime(observation.observed_at)}</time>
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </aside>
      </div>

      {summary && (
        <footer className="vessel-registry-policy">
          <span>Permanent identities: {summary.storagePolicy?.permanentVesselRecords ? "enabled" : "unknown"}</span>
          <span>Latest position retained: {summary.storagePolicy?.latestPositionRetained ? "enabled" : "unknown"}</span>
          <span>Global tracks: {summary.storagePolicy?.globalTrackRetentionDays ?? "—"} days</span>
          <span>Operational tracks: {summary.storagePolicy?.operationalTrackRetentionDays ?? "—"} days</span>
          <span>Last maintenance: {formatTime(summary.lastMaintenanceAt)}</span>
        </footer>
      )}
    </section>
  );
}
