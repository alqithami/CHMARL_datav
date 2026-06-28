import type { DashboardData } from "@/data/loadSampleDashboardData";

function safeFileSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "dashboard";
}

function downloadTextFile(fileName: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

export function exportDashboardSnapshot(data: DashboardData, scenarioId: string) {
  const createdAt = new Date().toISOString();
  const payload = {
    exportType: "chmarl-dashboard-snapshot",
    createdAt,
    scenarioId,
    source: data.source,
    metrics: data.metrics,
    vessels: data.vessels,
    portEvents: data.portEvents,
    rewardTrend: data.rewardTrend,
    constraintPressure: data.constraintPressure,
    portUtilization: data.portUtilization,
    timelineEvents: data.timelineEvents,
  };

  downloadTextFile(
    `chmarl-${safeFileSegment(scenarioId)}-${createdAt.slice(0, 10)}.json`,
    JSON.stringify(payload, null, 2),
    "application/json;charset=utf-8"
  );
}

export function exportVesselCsv(data: DashboardData, scenarioId: string) {
  const createdAt = new Date().toISOString();
  const header = [
    "id",
    "name",
    "route",
    "cargo",
    "eta",
    "speed",
    "status",
    "latitude",
    "longitude",
    "headingDeg",
    "courseDeg",
    "trailPoints",
  ];

  const rows = data.vessels.map((vessel) => [
    vessel.id,
    vessel.name,
    vessel.route,
    vessel.cargo,
    vessel.eta,
    vessel.speed,
    vessel.status,
    vessel.latitude,
    vessel.longitude,
    vessel.headingDeg,
    vessel.courseDeg,
    vessel.trail?.length ?? 0,
  ]);

  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");

  downloadTextFile(
    `chmarl-vessels-${safeFileSegment(scenarioId)}-${createdAt.slice(0, 10)}.csv`,
    csv,
    "text/csv;charset=utf-8"
  );
}
