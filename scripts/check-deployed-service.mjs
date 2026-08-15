#!/usr/bin/env node

import fs from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const DEFAULT_DEPLOYMENT_URL = "https://chmarl-datav.onrender.com";
const target = normalizeBaseUrl(
  process.argv[2] ?? process.env.CHMARL_DEPLOYMENT_URL ?? DEFAULT_DEPLOYMENT_URL,
);
const expectedRevision = String(process.env.EXPECTED_REVISION ?? "").trim();
const requireDataReady = booleanValue(process.env.REQUIRE_DATA_READY, false);
const attempts = boundedInteger(
  process.env.DEPLOYMENT_CHECK_ATTEMPTS,
  expectedRevision ? 18 : 3,
  1,
  30,
);
const retryDelayMs = boundedInteger(
  process.env.DEPLOYMENT_CHECK_RETRY_MS,
  20_000,
  1_000,
  60_000,
);
const requestTimeoutMs = boundedInteger(
  process.env.DEPLOYMENT_REQUEST_TIMEOUT_MS,
  15_000,
  1_000,
  60_000,
);

function normalizeBaseUrl(value) {
  const parsed = new URL(String(value).trim());
  if (parsed.protocol !== "https:") {
    throw new Error("The deployed portal monitor requires an HTTPS origin.");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function booleanValue(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function revisionMatches(actual, expected) {
  if (!expected) return true;
  if (!actual) return false;
  const normalizedActual = String(actual).trim().toLowerCase();
  const normalizedExpected = String(expected).trim().toLowerCase();
  return (
    normalizedActual === normalizedExpected ||
    normalizedActual.startsWith(normalizedExpected) ||
    normalizedExpected.startsWith(normalizedActual)
  );
}

async function request(path, acceptedStatuses, expectJson) {
  const url = `${target}${path}`;
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      headers: {
        Accept: expectJson ? "application/json" : "text/html,application/xhtml+xml",
        "User-Agent": "CHMARL-Deployment-Monitor/1.0",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    const text = await response.text();
    let json = null;
    if (expectJson) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return {
      ok: acceptedStatuses.includes(response.status),
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      contentType: response.headers.get("content-type") ?? "",
      text,
      json,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      elapsedMs: Date.now() - startedAt,
      contentType: "",
      text: "",
      json: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function providerSnapshot(vessels) {
  const source = vessels?.source ?? null;
  const providers = vessels?.providers ?? {};
  const primaryHealth = vessels?.health ?? providers.aisstream ?? {};
  const health = source === "datalastic"
    ? (providers.datalastic ?? primaryHealth)
    : primaryHealth;
  return {
    source,
    scope: vessels?.scope ?? null,
    trackingRows: numeric(vessels?.counts?.tracking),
    operationalRows: numeric(vessels?.counts?.operational),
    state: health?.status ?? vessels?.inputs?.providerState ?? null,
    connected: Boolean(health?.connected),
    messageCount: numeric(health?.messageCount),
    usablePositionMessages: numeric(health?.usablePositionMessages),
    cachedVessels: numeric(health?.cachedVessels),
    openedAt: health?.openedAt ?? null,
    lastMessageAt: health?.lastMessageAt ?? null,
    lastCloseAt: health?.lastCloseAt ?? null,
    watchdogRestarts: numeric(primaryHealth?.watchdogRestarts),
    activeProvider: source === "datalastic" ? "datalastic" : source === "ais-multi-provider" ? "multi-provider" : "aisstream",
    datalasticStatus: providers.datalastic?.status ?? null,
    datalasticRows: numeric(vessels?.inputs?.datalasticRows),
  };
}

async function probe() {
  const [live, version, dashboard, readiness, vessels] = await Promise.all([
    request("/health/live", [200], true),
    request("/version", [200], true),
    request("/", [200], false),
    request("/health/ready", [200, 503], true),
    request("/api/vessels", [200], true),
  ]);

  const release =
    version.json?.version ??
    live.json?.service?.version ??
    readiness.json?.service?.version ??
    null;
  const releaseMatches = revisionMatches(release, expectedRevision);
  const dashboardShell = dashboard.text.includes('<div id="root"></div>');
  const provider = providerSnapshot(vessels.json);
  const dataReady =
    readiness.status === 200 &&
    readiness.json?.ok === true &&
    provider.trackingRows > 0;

  const hardFailures = [];
  if (!live.ok || live.json?.ok !== true || live.json?.staticDashboard !== true) {
    hardFailures.push("/health/live did not confirm a live static dashboard");
  }
  if (!version.ok || !release) {
    hardFailures.push("/version did not return a deployed revision");
  }
  if (!releaseMatches) {
    hardFailures.push(
      `deployed revision ${release ?? "unknown"} does not match expected ${expectedRevision}`,
    );
  }
  if (!dashboard.ok || !dashboardShell) {
    hardFailures.push("the production dashboard HTML shell is unavailable");
  }
  if (!readiness.ok || !readiness.json) {
    hardFailures.push("/health/ready did not return its documented JSON contract");
  }
  if (!vessels.ok || !vessels.json || !Array.isArray(vessels.json.vessels)) {
    hardFailures.push("/api/vessels did not return its documented vessel contract");
  }

  return {
    checkedAt: new Date().toISOString(),
    target,
    expectedRevision: expectedRevision || null,
    release,
    releaseMatches,
    deploymentReady: hardFailures.length === 0,
    dataReady,
    requireDataReady,
    hardFailures,
    endpoints: {
      live: endpointSummary(live),
      version: endpointSummary(version),
      dashboard: endpointSummary(dashboard),
      readiness: endpointSummary(readiness),
      vessels: endpointSummary(vessels),
    },
    readiness: readiness.json,
    provider,
  };
}

function endpointSummary(result) {
  return {
    ok: result.ok,
    status: result.status,
    elapsedMs: result.elapsedMs,
    contentType: result.contentType,
    error: result.error,
  };
}

function markdown(report) {
  const deploymentStatus = report.deploymentReady ? "PASS" : "FAIL";
  const dataStatus = report.dataReady ? "READY" : "DEGRADED";
  const lines = [
    "# CH-MARL DataV production monitor",
    "",
    `- Checked: \`${report.checkedAt}\``,
    `- Target: \`${report.target}\``,
    `- Deployment: **${deploymentStatus}**`,
    `- Vessel data: **${dataStatus}**`,
    `- Deployed revision: \`${report.release ?? "unknown"}\``,
    `- Expected revision: \`${report.expectedRevision ?? "not enforced"}\``,
    `- Source: \`${report.provider.source ?? "unknown"}\``,
    `- Provider state: \`${report.provider.state ?? "unknown"}\``,
    `- AIS connected: \`${report.provider.connected}\``,
    `- AIS messages: \`${report.provider.messageCount}\``,
    `- Tracking rows: \`${report.provider.trackingRows}\``,
    `- Operational rows: \`${report.provider.operationalRows}\``,
  ];

  if (report.hardFailures.length) {
    lines.push("", "## Deployment failures", "");
    for (const failure of report.hardFailures) lines.push(`- ${failure}`);
  }

  if (!report.dataReady) {
    lines.push(
      "",
      "## Data readiness",
      "",
      "The web service is evaluated separately from the external AIS feed. A connected AIS socket with zero current position messages is recorded as degraded data, not as a failed deployment unless strict data readiness was requested.",
    );
  }

  lines.push("", "## Endpoint timings", "");
  for (const [name, endpoint] of Object.entries(report.endpoints)) {
    lines.push(
      `- ${name}: HTTP ${endpoint.status} in ${endpoint.elapsedMs} ms${endpoint.error ? ` — ${endpoint.error}` : ""}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function persistReport(report) {
  fs.writeFileSync("deployment-monitor.json", `${JSON.stringify(report, null, 2)}\n`);
  const summary = markdown(report);
  fs.writeFileSync("deployment-monitor.md", summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
}

let report = null;
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  report = await probe();
  const shouldRetry = !report.deploymentReady && attempt < attempts;
  console.log(
    JSON.stringify(
      {
        attempt,
        attempts,
        deploymentReady: report.deploymentReady,
        dataReady: report.dataReady,
        release: report.release,
        expectedRevision: report.expectedRevision,
        provider: report.provider,
        hardFailures: report.hardFailures,
      },
      null,
      2,
    ),
  );
  if (!shouldRetry) break;
  await sleep(retryDelayMs);
}

persistReport(report);

if (!report.deploymentReady) {
  console.error(`::error::CH-MARL deployment verification failed: ${report.hardFailures.join("; ")}`);
  process.exit(1);
}

if (!report.dataReady) {
  const message = `AIS data is degraded: source=${report.provider.source ?? "unknown"}, state=${report.provider.state ?? "unknown"}, connected=${report.provider.connected}, messages=${report.provider.messageCount}, trackingRows=${report.provider.trackingRows}`;
  if (requireDataReady) {
    console.error(`::error::${message}`);
    process.exit(1);
  }
  console.warn(`::warning::${message}`);
}

console.log("CH-MARL deployed service verification passed.");
