import type { RawAisVesselUpdate } from "./aisAdapter";

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && next === '"' && inQuotes) {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }

    cell += char;
  }

  cells.push(cell.trim());
  return cells;
}

function nonEmpty(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return headers.reduce<Record<string, string>>((row, header, index) => {
      row[header] = values[index] ?? "";
      return row;
    }, {});
  });
}

export function parseAisVesselCsv(text: string): RawAisVesselUpdate[] {
  return parseCsv(text).map((row) => ({
    vesselId: nonEmpty(row.vesselId),
    mmsi: nonEmpty(row.mmsi),
    imo: nonEmpty(row.imo),
    name: nonEmpty(row.name),
    vesselType: nonEmpty(row.vesselType),
    cargoClass: nonEmpty(row.cargoClass),
    latitude: nonEmpty(row.latitude),
    longitude: nonEmpty(row.longitude),
    speedKnots: nonEmpty(row.speedKnots),
    courseDeg: nonEmpty(row.courseDeg),
    headingDeg: nonEmpty(row.headingDeg),
    navStatus: nonEmpty(row.navStatus),
    originPort: nonEmpty(row.originPort),
    destinationPort: nonEmpty(row.destinationPort),
    eta: nonEmpty(row.eta),
    timestamp: nonEmpty(row.timestamp),
  }));
}
