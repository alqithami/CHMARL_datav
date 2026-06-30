import { useEffect, useMemo, useState } from "react";
import type { Vessel } from "@/data/chmarlData";

export type VesselTableProps = {
  vessels: Vessel[];
};

type StatusFilter = "All" | Vessel["status"];
type SortMode = "updated" | "speed" | "name" | "status";

const statusOptions: StatusFilter[] = ["All", "Nominal", "Watch", "Constrained"];
const pageSizes = [10, 25, 50];

function statusClass(status: Vessel["status"]) {
  if (status === "Constrained") return "status-chip alert";
  if (status === "Watch") return "status-chip warning";
  return "status-chip";
}

function speedKnots(vessel: Vessel) {
  const parsed = Number.parseFloat(vessel.speed.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function timestampMs(vessel: Vessel) {
  if (!vessel.timestamp) return 0;
  const parsed = Date.parse(vessel.timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formattedTimestamp(vessel: Vessel) {
  const timestamp = timestampMs(vessel);
  if (timestamp === 0) return vessel.timestamp ?? "n/a";
  return new Date(timestamp).toLocaleTimeString();
}

function hasPosition(vessel: Vessel) {
  return Number.isFinite(vessel.latitude) && Number.isFinite(vessel.longitude);
}

function matchesQuery(vessel: Vessel, query: string) {
  if (!query) return true;
  return `${vessel.name} ${vessel.id} ${vessel.route} ${vessel.cargo} ${vessel.eta}`.toLowerCase().includes(query);
}

function sortVessels(rows: Vessel[], sortMode: SortMode) {
  return [...rows].sort((a, b) => {
    if (sortMode === "name") return a.name.localeCompare(b.name);
    if (sortMode === "status") return a.status.localeCompare(b.status) || a.name.localeCompare(b.name);
    if (sortMode === "speed") return (speedKnots(b) ?? -1) - (speedKnots(a) ?? -1);
    return timestampMs(b) - timestampMs(a);
  });
}

export default function VesselTable({ vessels }: VesselTableProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [sortMode, setSortMode] = useState<SortMode>("updated");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredRows = useMemo(() => {
    const rows = vessels.filter((vessel) => (statusFilter === "All" || vessel.status === statusFilter) && matchesQuery(vessel, normalizedQuery));
    return sortVessels(rows, sortMode);
  }, [normalizedQuery, sortMode, statusFilter, vessels]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visibleRows = filteredRows.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const positionedRows = filteredRows.filter(hasPosition).length;
  const trailRows = filteredRows.filter((vessel) => vessel.trail && vessel.trail.length > 1).length;

  useEffect(() => {
    setPage(0);
  }, [normalizedQuery, pageSize, sortMode, statusFilter]);

  return (
    <div className="vessel-table-shell">
      <div className="vessel-table-toolbar" aria-label="Vessel table controls">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search vessel, MMSI, route, cargo" aria-label="Search vessels" />
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} aria-label="Filter by vessel status">
          {statusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} aria-label="Sort vessels">
          <option value="updated">Latest update</option>
          <option value="speed">Speed high to low</option>
          <option value="name">Name</option>
          <option value="status">Status</option>
        </select>
        <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} aria-label="Rows per page">
          {pageSizes.map((size) => <option key={size} value={size}>{size} rows</option>)}
        </select>
      </div>
      <div className="vessel-table-summary">
        <span>{filteredRows.length}/{vessels.length} vessels</span>
        <span>{positionedRows} positioned</span>
        <span>{trailRows} with trails</span>
      </div>
      <div className="table-scroll">
        <table className="vessel-table">
          <thead>
            <tr>
              <th>Vessel</th>
              <th>Route</th>
              <th>Cargo</th>
              <th>ETA</th>
              <th>Speed</th>
              <th>Position</th>
              <th>Updated</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr><td colSpan={8} className="vessel-table-empty">No vessels match the current filters.</td></tr>
            ) : visibleRows.map((vessel) => (
              <tr key={vessel.id}>
                <td>
                  <strong>{vessel.name}</strong>
                  <br />
                  <span>{vessel.id}</span>
                </td>
                <td>{vessel.route}</td>
                <td>{vessel.cargo}</td>
                <td>{vessel.eta}</td>
                <td>{vessel.speed}</td>
                <td>{hasPosition(vessel) ? `${vessel.latitude?.toFixed(3)}, ${vessel.longitude?.toFixed(3)}` : "n/a"}</td>
                <td>{formattedTimestamp(vessel)}</td>
                <td><span className={statusClass(vessel.status)}>{vessel.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="vessel-table-pagination" aria-label="Vessel table pagination">
        <button type="button" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={safePage === 0}>Previous</button>
        <span>Page {safePage + 1} of {pageCount}</span>
        <button type="button" onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} disabled={safePage >= pageCount - 1}>Next</button>
      </div>
    </div>
  );
}
