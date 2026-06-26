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
    vesselId: row.vesselId,
    mmsi: row.mmsi,
    imo: row.imo,
    name: row.name,
    vesselType: row.vesselType,
    cargoClass: row.cargoClass,
    latitude: row.latitude,
    longitude: row.longitude,
    speedKnots: row.speedKnots,
    courseDeg: row.courseDeg,
    headingDeg: row.headingDeg,
    navStatus: row.navStatus,
    originPort: row.originPort,
    destinationPort: row.destinationPort,
    eta: row.eta,
    timestamp: row.timestamp,
  }));
}
