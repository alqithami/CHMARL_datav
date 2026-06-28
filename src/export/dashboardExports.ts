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

function markdownCell(value: unknown) {
  return String(value ?? "").replace(/\|/g, "\\|");
}

function markdownTable(headers: string[], rows: unknown[][]) {
  const header = `| ${headers.map(markdownCell).join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(markdownCell).join(" | ")} |`).join("\n");
  return [header, separator, body].filter(Boolean).join("\n");
}

function countBy<T extends string>(values: T[]) {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function latestReward(data: DashboardData) {
  return data.rewardTrend.at(-1)?.[1];
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

export function exportOperationalReport(data: DashboardData, scenarioId: string) {
  const createdAt = new Date().toISOString();
  const vesselStatusCounts = countBy(data.vessels.map((vessel) => vessel.status));
  const portEventCounts = countBy(data.portEvents.map((event) => event.eventType));
  const rewardValue = latestReward(data);
  const trailCount = data.vessels.filter((vessel) => vessel.trail && vessel.trail.length > 1).length;
  const constrainedCount = vesselStatusCounts.Constrained ?? 0;
  const watchCount = vesselStatusCounts.Watch ?? 0;

  const sections = [
    `# CH-MARL Operational Situation Report`,
    ``,
    `**Created:** ${createdAt}`,
    `**Scenario:** ${scenarioId}`,
    `**Data source:** ${data.source}`,
    ``,
    `## Situation Summary`,
    ``,
    `The current operating picture contains ${data.vessels.length} vessel records, ${data.portEvents.length} port events, and ${trailCount} vessel tracks. The current risk posture includes ${watchCount} watch vessels and ${constrainedCount} constrained vessels. The latest CH-MARL reward value is ${rewardValue === undefined ? "not available" : rewardValue.toFixed(3)}.`,
    ``,
    `## Operational KPIs`,
    ``,
    markdownTable(["Metric", "Value", "Operational interpretation"], data.metrics.map((metric) => [metric.label, metric.value, metric.trend])),
    ``,
    `## Vessel Status Distribution`,
    ``,
    markdownTable(["Status", "Count"], Object.entries(vesselStatusCounts)),
    ``,
    `## Port Event Distribution`,
    ``,
    markdownTable(["Event type", "Count"], Object.entries(portEventCounts)),
    ``,
    `## Constraint Pressure`,
    ``,
    markdownTable(["Constraint", "Pressure"], data.constraintPressure.map((item) => [item.name, item.value])),
    ``,
    `## Port Utilization`,
    ``,
    markdownTable(["Port", "Utilization"], data.portUtilization.map((item) => [item.name, item.value])),
    ``,
    `## CH-MARL Decision Timeline`,
    ``,
    markdownTable(["Time", "Decision", "Operational evidence"], data.timelineEvents.map((event) => [event.time, event.title, event.body])),
    ``,
    `## Operational Notes`,
    ``,
    `This report is generated from the current dashboard state. Treat local-json and fallback data as validation fixtures; treat remote data as the active backend/proxy feed only when the provider state indicates remote mode.`,
  ];

  downloadTextFile(
    `chmarl-ops-report-${safeFileSegment(scenarioId)}-${createdAt.slice(0, 10)}.md`,
    sections.join("\n"),
    "text/markdown;charset=utf-8"
  );
}
