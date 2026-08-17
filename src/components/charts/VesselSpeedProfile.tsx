import { useMemo } from "react";
import type { CSSProperties } from "react";
import type { Vessel } from "@/data/chmarlData";

export type VesselSpeedProfileProps = {
  vessels: Vessel[];
};

type SpeedBandDefinition = {
  id: string;
  label: string;
  range: string;
  color: string;
  matches?: (speed: number) => boolean;
  unknown?: boolean;
  detail?: boolean;
};

type SpeedBand = SpeedBandDefinition & {
  count: number;
  share: number;
  relativeWidth: number;
};

type SpeedStat = {
  label: string;
  value: string;
  detail: string;
};

const numberFormatter = new Intl.NumberFormat("en-US");

const compactBandDefinitions: SpeedBandDefinition[] = [
  { id: "stopped", label: "Stopped", range: "≤ 0.5 kn", color: "var(--mawani-text-helper)", matches: (speed) => speed <= 0.5 },
  { id: "maneuvering", label: "Maneuvering", range: "0.5–5 kn", color: "var(--mawani-aqua-60)", matches: (speed) => speed > 0.5 && speed < 5 },
  { id: "transit", label: "Transit", range: "5–15 kn", color: "var(--mawani-success)", matches: (speed) => speed >= 5 && speed <= 15 },
  { id: "fast", label: "Fast", range: "> 15 kn", color: "var(--mawani-warning)", matches: (speed) => speed > 15 },
  { id: "unknown", label: "Unknown", range: "No SOG", color: "var(--mawani-border-strong)", unknown: true },
];

const expandedBandDefinitions: SpeedBandDefinition[] = [
  { id: "stopped", label: "Stopped", range: "≤ 0.5 kn", color: "var(--mawani-text-helper)", matches: (speed) => speed <= 0.5 },
  { id: "harbor", label: "Harbor movement", range: "0.5–2 kn", color: "var(--mawani-info)", matches: (speed) => speed > 0.5 && speed < 2 },
  { id: "maneuvering", label: "Maneuvering", range: "2–5 kn", color: "var(--mawani-aqua-60)", matches: (speed) => speed >= 2 && speed < 5 },
  { id: "coastal", label: "Coastal", range: "5–10 kn", color: "var(--mawani-aqua-50)", matches: (speed) => speed >= 5 && speed < 10, detail: true },
  { id: "transit", label: "Transit", range: "10–15 kn", color: "var(--mawani-success)", matches: (speed) => speed >= 10 && speed <= 15, detail: true },
  { id: "fast", label: "Fast transit", range: "15–20 kn", color: "var(--mawani-warning)", matches: (speed) => speed > 15 && speed <= 20, detail: true },
  { id: "high", label: "High speed", range: "> 20 kn", color: "var(--mawani-error)", matches: (speed) => speed > 20, detail: true },
  { id: "unknown", label: "Unknown", range: "No SOG", color: "var(--mawani-border-strong)", unknown: true },
];

function parseSpeedKnots(vessel: Vessel) {
  const parsed = Number.parseFloat(vessel.speed.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function percentile(sortedValues: number[], fraction: number) {
  if (sortedValues.length === 0) return undefined;
  const position = Math.max(0, Math.min(sortedValues.length - 1, (sortedValues.length - 1) * fraction));
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) return sortedValues[lowerIndex];
  const weight = position - lowerIndex;
  return sortedValues[lowerIndex] * (1 - weight) + sortedValues[upperIndex] * weight;
}

function formatKnots(value: number | undefined) {
  return value === undefined ? "n/a" : `${value.toFixed(1)} kn`;
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "0%";
  if (value > 0 && value < 0.1) return "<0.1%";
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function buildBands(
  definitions: SpeedBandDefinition[],
  speeds: number[],
  unknownCount: number,
  totalCount: number,
): SpeedBand[] {
  const counts = definitions.map((definition) => (
    definition.unknown
      ? unknownCount
      : speeds.filter((speed) => definition.matches?.(speed)).length
  ));
  const maximum = Math.max(1, ...counts);

  return definitions.map((definition, index) => {
    const count = counts[index];
    return {
      ...definition,
      count,
      share: totalCount === 0 ? 0 : (count / totalCount) * 100,
      relativeWidth: count === 0 ? 0 : Math.max(2, (count / maximum) * 100),
    };
  });
}

function buildProfile(vessels: Vessel[]) {
  const speeds = vessels
    .map(parseSpeedKnots)
    .filter((speed): speed is number => speed !== undefined)
    .sort((a, b) => a - b);
  const total = vessels.length;
  const known = speeds.length;
  const unknown = Math.max(0, total - known);
  const moving = speeds.filter((speed) => speed > 0.5).length;
  const average = known === 0 ? undefined : speeds.reduce((sum, speed) => sum + speed, 0) / known;
  const median = percentile(speeds, 0.5);
  const p90 = percentile(speeds, 0.9);
  const maximum = speeds.at(-1);
  const movingShare = total === 0 ? 0 : (moving / total) * 100;
  const knownShare = total === 0 ? 0 : (known / total) * 100;

  const compactStats: SpeedStat[] = [
    { label: "Tracked", value: numberFormatter.format(total), detail: "current rows" },
    { label: "Moving", value: numberFormatter.format(moving), detail: `${formatPercent(movingShare)} above 0.5 kn` },
    { label: "Average SOG", value: formatKnots(average), detail: `${formatPercent(knownShare)} speed coverage` },
  ];

  const expandedStats: SpeedStat[] = [
    { label: "Tracked", value: numberFormatter.format(total), detail: "all vessel rows" },
    { label: "Known SOG", value: numberFormatter.format(known), detail: formatPercent(knownShare) },
    { label: "Moving", value: numberFormatter.format(moving), detail: formatPercent(movingShare) },
    { label: "Average", value: formatKnots(average), detail: "known SOG only" },
    { label: "Median", value: formatKnots(median), detail: "50th percentile" },
    { label: "P90", value: formatKnots(p90), detail: "90th percentile" },
    { label: "Maximum", value: formatKnots(maximum), detail: "highest reported SOG" },
  ];

  return {
    total,
    known,
    unknown,
    compactStats,
    expandedStats,
    compactBands: buildBands(compactBandDefinitions, speeds, unknown, total),
    expandedBands: buildBands(expandedBandDefinitions, speeds, unknown, total),
  };
}

function SpeedStats({ stats, className }: { stats: SpeedStat[]; className: string }) {
  return (
    <div className={`speed-profile-summary ${className}`}>
      {stats.map((stat) => (
        <div key={stat.label} className="speed-profile-stat">
          <span>{stat.label}</span>
          <strong>{stat.value}</strong>
          <small>{stat.detail}</small>
        </div>
      ))}
    </div>
  );
}

function SpeedBands({ bands, className }: { bands: SpeedBand[]; className: string }) {
  return (
    <div className={`speed-profile-bands ${className}`} role="list" aria-label="Vessel speed distribution">
      {bands.map((band) => {
        const style = {
          "--speed-band-width": `${band.relativeWidth}%`,
          "--speed-band-color": band.color,
        } as CSSProperties;
        return (
          <article
            key={band.id}
            className={band.detail ? "speed-profile-band detail-band" : "speed-profile-band"}
            role="listitem"
            aria-label={`${band.label}: ${numberFormatter.format(band.count)} vessels, ${formatPercent(band.share)}`}>
            <div className="speed-profile-band-heading">
              <div><strong>{band.label}</strong><small>{band.range}</small></div>
              <span>{numberFormatter.format(band.count)}</span>
              <small>{formatPercent(band.share)}</small>
            </div>
            <div className="speed-profile-band-track" aria-hidden="true">
              <span style={style} />
            </div>
          </article>
        );
      })}
    </div>
  );
}

export default function VesselSpeedProfile({ vessels }: VesselSpeedProfileProps) {
  const profile = useMemo(() => buildProfile(vessels), [vessels]);

  if (profile.total === 0) {
    return (
      <section className="vessel-speed-profile vessel-speed-profile-empty" aria-label="Vessel speed profile">
        <strong>Waiting for live vessel rows</strong>
        <small>The distribution will appear when AIS speed observations are available.</small>
      </section>
    );
  }

  return (
    <section className="vessel-speed-profile" aria-label="Vessel speed profile">
      <SpeedStats stats={profile.compactStats} className="speed-profile-compact" />
      <SpeedStats stats={profile.expandedStats} className="speed-profile-expanded" />
      <SpeedBands bands={profile.compactBands} className="speed-profile-compact" />
      <SpeedBands bands={profile.expandedBands} className="speed-profile-expanded" />
      <p className="speed-profile-note speed-profile-expanded">
        Counts use reported AIS speed over ground. Percentages include all tracked rows; {numberFormatter.format(profile.unknown)} rows have no usable SOG and remain explicit.
      </p>
    </section>
  );
}
