import type { Vessel } from "@/data/chmarlData";

export type VesselTableProps = {
  vessels: Vessel[];
};

function statusClass(status: Vessel["status"]) {
  if (status === "Constrained") return "status-chip alert";
  if (status === "Watch") return "status-chip warning";
  return "status-chip";
}

export default function VesselTable({ vessels }: VesselTableProps) {
  return (
    <div className="table-scroll">
      <table className="vessel-table">
        <thead>
          <tr>
            <th>Vessel</th>
            <th>Route</th>
            <th>Cargo</th>
            <th>ETA</th>
            <th>Speed</th>
            <th>Constraint state</th>
          </tr>
        </thead>
        <tbody>
          {vessels.map((vessel) => (
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
              <td>
                <span className={statusClass(vessel.status)}>{vessel.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
