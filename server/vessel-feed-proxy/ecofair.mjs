/**
 * EcoFair-CH-MARL online measurement runtime.
 *
 * Ports the measures of "EcoFair-CH-MARL: Scalable Constrained Hierarchical
 * Multi-Agent RL with Real-Time Emission Budgets and Fairness Guarantees"
 * (Alqithami, arXiv:2603.14625, ECAI 2025) and its reference implementation
 * (github.com/alqithami/EcoFairCHAMRL) onto the live AIS vessel feed:
 *
 *   - cubic fuel law            fuel_rate = k * v^3          (t / h)
 *   - idle / queue load factors IDLE_LOAD = 0.25, QUEUE_LOAD = 0.10
 *   - CO2 conversion            3.114 t CO2 / t fuel (IMO GHG factor, HFO)
 *   - fairness                  Gini + max-min ratio over per-vessel fuel
 *   - emission budget layer     primal-dual multiplier lambda with
 *                               lambda <- max(0, lambda + eta * (E - B)/B)
 *   - reward decomposition      r = -fuel - gamma_e * max(0, E - B) - gamma_f * Gini
 *
 * The module is dependency-free so it can be unit-tested with plain `node`.
 * An "episode" is one UTC day; accumulators reset at midnight UTC and the
 * closed day is archived into `dailyHistory`.
 */

export const IDLE_LOAD = 0.25;   // fraction of full thrust while idle at berth (paper §2)
export const QUEUE_LOAD = 0.10;  // fraction of full thrust while queuing/anchored (paper §2)
export const CO2_PER_TONNE_FUEL = 3.114; // IMO 4th GHG study, heavy fuel oil
export const REFERENCE_SPEED_KN = 14;    // service speed used for idle/queue baseline load

const KNOWN_STATES = ["TRANSIT", "AT_BERTH", "ANCHORED", "DRIFTING"];

/** Exact Gini formula from EcoFairCHMARL.py::compute_gini. */
export function computeGini(values) {
  const xs = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) return 0;
  const sum = xs.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  const weighted = xs.reduce((acc, v, i) => acc + (i + 1) * v, 0);
  return (2 * weighted) / (n * sum) - (n + 1) / n;
}

/** Exact max-min ratio from EcoFairCHMARL.py::compute_minmax_ratio. */
export function computeMinMaxRatio(values) {
  const xs = values.filter((v) => Number.isFinite(v) && v >= 0);
  if (xs.length === 0) return 1;
  const max = Math.max(...xs);
  if (max === 0) return 1;
  return Math.min(...xs) / max;
}

/**
 * Deterministic per-vessel fuel-curve factor k in [5e-4, 1e-3] t/(kt^3 h),
 * the same distribution the paper samples vessel specs from
 * (EcoFairCHMARL.py::generate_synthetic_data). Hashing the vessel id keeps
 * the assignment stable across restarts without a vessel registry.
 * At k = 7.5e-4 and 14 kn this yields ~2.1 t/h (~49 t/day) - consistent with
 * a cargo vessel at slow steaming.
 */
export function fuelCurveFactor(vesselId) {
  let hash = 2166136261;
  const text = String(vesselId);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const unit = ((hash >>> 0) % 100000) / 100000;
  return 5e-4 + unit * 5e-4;
}

function haversineNm(a, b) {
  const radiusNm = 3440.065;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusNm * Math.asin(Math.min(1, Math.sqrt(h)));
}

function parseSpeedKnots(vessel) {
  if (Number.isFinite(vessel.sog)) return vessel.sog;
  const parsed = Number.parseFloat(String(vessel.speed ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

const DEFAULT_PORT_CAPACITY = {
  // Reference simultaneous-berth capacities (approximate, env-overridable).
  Jeddah: 24,
  "King Abdullah Port": 10,
  Yanbu: 8,
  Jizan: 6,
  Dammam: 20,
  "Jebel Ali": 28,
  Suez: 10,
};

export function createEcoFairRuntime(options = {}) {
  const cfg = {
    ports: options.ports ?? [],
    portCapacity: { ...DEFAULT_PORT_CAPACITY, ...(options.portCapacity ?? {}) },
    berthRadiusNm: options.berthRadiusNm ?? 5,
    anchorageRadiusNm: options.anchorageRadiusNm ?? 20,
    // Fixed daily budget (t CO2). When 0/unset, the budget scales with the
    // tracked fleet: budgetTonnesPerVesselPerDay * active vessels. A fixed
    // budget sized for a small fleet makes the emission penalty dominate the
    // reward as soon as the live feed tracks hundreds of vessels.
    emissionBudgetTonnesPerDay: options.emissionBudgetTonnesPerDay ?? 0,
    budgetTonnesPerVesselPerDay: options.budgetTonnesPerVesselPerDay ?? 60,
    gammaEmis: options.gammaEmis ?? 10,
    gammaFair: options.gammaFair ?? 5,
    lambdaLearningRate: options.lambdaLearningRate ?? 0.05,
    giniLimit: options.giniLimit ?? 0.35,
    minMaxLimit: options.minMaxLimit ?? 0.4,
    maxIntegrationMinutes: options.maxIntegrationMinutes ?? 30,
    maxEvents: options.maxEvents ?? 300,
    maxDailyHistory: options.maxDailyHistory ?? 60,
    minSpeedMovingKn: options.minSpeedMovingKn ?? 1.0,
  };

  const state = {
    episodeDate: null, // set on first update; avoids archiving phantom episodes
    vessels: new Map(), // id -> { fuelTonnes, co2Tonnes, lastMs, state, portId, name, k }
    totalFuelTonnes: 0,
    totalCo2Tonnes: 0,
    lambdaDual: 0,
    lastLambdaUpdateMs: 0,
    lastIntervalFuelTonnes: 0,
    lastUpdateMs: 0,
    events: [],
    dailyHistory: [],
    eventCounter: 0,
  };

  function classify(vessel, sog) {
    if (!Number.isFinite(vessel.latitude) || !Number.isFinite(vessel.longitude)) return { state: "DRIFTING", portId: null, distance: null };
    let best = null;
    for (const port of cfg.ports) {
      const distance = haversineNm(vessel, port);
      if (!best || distance < best.distance) best = { port, distance };
    }
    const moving = (sog ?? 0) > cfg.minSpeedMovingKn;
    if (best && best.distance <= cfg.berthRadiusNm && !moving) return { state: "AT_BERTH", portId: best.port.id, distance: best.distance };
    if (best && best.distance <= cfg.anchorageRadiusNm && !moving) return { state: "ANCHORED", portId: best.port.id, distance: best.distance };
    if (moving) return { state: "TRANSIT", portId: best && best.distance <= cfg.anchorageRadiusNm ? best.port.id : null, distance: best?.distance ?? null };
    return { state: "DRIFTING", portId: null, distance: best?.distance ?? null };
  }

  function fuelRateTonnesPerHour(k, vesselState, sog) {
    const fullThrust = k * REFERENCE_SPEED_KN ** 3;
    if (vesselState === "TRANSIT") return k * Math.max(0, sog ?? 0) ** 3;
    if (vesselState === "AT_BERTH") return fullThrust * IDLE_LOAD;
    if (vesselState === "ANCHORED") return fullThrust * QUEUE_LOAD;
    return fullThrust * QUEUE_LOAD; // DRIFTING: treat as queue-level load
  }

  function pushEvent(eventType, vessel, portId, nowMs) {
    state.eventCounter += 1;
    state.events.push({
      eventId: `ais-${utcDay(nowMs)}-${state.eventCounter}`,
      vesselId: vessel.id,
      portId,
      eventType,
      timestamp: new Date(nowMs).toISOString(),
      metadata: { derivedFrom: "live-ais-geofence", vesselName: vessel.name ?? vessel.id },
    });
    if (state.events.length > cfg.maxEvents) state.events = state.events.slice(-cfg.maxEvents);
  }

  function activeFuelValues() {
    return [...state.vessels.values()].filter((r) => r.fuelTonnes > 0).map((r) => r.fuelTonnes);
  }

  /** Daily CO2 budget: fixed if configured, otherwise per-vessel x fleet size. */
  function dailyBudget() {
    if (cfg.emissionBudgetTonnesPerDay > 0) return cfg.emissionBudgetTonnesPerDay;
    return cfg.budgetTonnesPerVesselPerDay * Math.max(1, state.vessels.size);
  }

  function rollEpisodeIfNeeded(nowMs) {
    const day = utcDay(nowMs);
    if (day === state.episodeDate) return;
    if (state.episodeDate === null || state.totalFuelTonnes === 0) {
      // First observation or an empty episode (e.g. fresh boot): start fresh, archive nothing.
      state.episodeDate = day;
      return;
    }
    const fuels = activeFuelValues();
    state.dailyHistory.push({
      date: state.episodeDate,
      totalFuelTonnes: round3(state.totalFuelTonnes),
      totalCo2Tonnes: round3(state.totalCo2Tonnes),
      emissionBudgetTonnes: round3(dailyBudget()),
      budgetExcessTonnes: round3(Math.max(0, state.totalCo2Tonnes - dailyBudget())),
      giniFuel: round3(computeGini(fuels)),
      minMaxRatio: round3(computeMinMaxRatio(fuels)),
      lambdaDual: round3(state.lambdaDual),
      trackedVessels: fuels.length,
    });
    if (state.dailyHistory.length > cfg.maxDailyHistory) state.dailyHistory = state.dailyHistory.slice(-cfg.maxDailyHistory);
    state.episodeDate = day;
    state.totalFuelTonnes = 0;
    state.totalCo2Tonnes = 0;
    for (const record of state.vessels.values()) {
      record.fuelTonnes = 0;
      record.co2Tonnes = 0;
    }
    // lambda persists across episodes: the dual variable is a running price (paper §3.1).
  }

  function proratedBudget(nowMs) {
    const dayStart = Date.parse(`${state.episodeDate ?? utcDay(nowMs)}T00:00:00Z`);
    const fraction = Math.min(1, Math.max(0, (nowMs - dayStart) / 86_400_000));
    return dailyBudget() * fraction;
  }

  /** Ingest the latest vessel rows and integrate fuel/emissions since the last call. */
  function update(vesselRows, nowMs = Date.now()) {
    rollEpisodeIfNeeded(nowMs);
    let intervalFuel = 0;

    for (const vessel of vesselRows) {
      if (!vessel?.id) continue;
      const sog = parseSpeedKnots(vessel);
      const zone = classify(vessel, sog);
      let record = state.vessels.get(vessel.id);
      if (!record) {
        record = {
          fuelTonnes: 0,
          co2Tonnes: 0,
          lastMs: nowMs,
          state: zone.state,
          portId: zone.portId,
          name: vessel.name ?? vessel.id,
          k: fuelCurveFactor(vessel.id),
        };
        state.vessels.set(vessel.id, record);
        if (zone.state === "ANCHORED" && zone.portId) pushEvent("anchorage_entry", vessel, zone.portId, nowMs);
        if (zone.state === "AT_BERTH" && zone.portId) pushEvent("arrival", vessel, zone.portId, nowMs);
        continue;
      }

      const dtHours = Math.min(cfg.maxIntegrationMinutes * 60_000, Math.max(0, nowMs - record.lastMs)) / 3_600_000;
      if (dtHours > 0) {
        const fuel = fuelRateTonnesPerHour(record.k, record.state, sog) * dtHours;
        record.fuelTonnes += fuel;
        record.co2Tonnes += fuel * CO2_PER_TONNE_FUEL;
        state.totalFuelTonnes += fuel;
        state.totalCo2Tonnes += fuel * CO2_PER_TONNE_FUEL;
        intervalFuel += fuel;
      }

      if (zone.state !== record.state) {
        const prev = { state: record.state, portId: record.portId };
        if (zone.state === "AT_BERTH" && zone.portId) pushEvent(prev.state === "ANCHORED" ? "berth_assigned" : "arrival", vessel, zone.portId, nowMs);
        if (zone.state === "ANCHORED" && zone.portId && prev.state !== "AT_BERTH") pushEvent("anchorage_entry", vessel, zone.portId, nowMs);
        if (prev.state === "AT_BERTH" && zone.state === "TRANSIT" && prev.portId) pushEvent("departure", vessel, prev.portId, nowMs);
        if (prev.state === "ANCHORED" && zone.state === "TRANSIT" && prev.portId) pushEvent("anchorage_exit", vessel, prev.portId, nowMs);
      }
      record.state = zone.state;
      record.portId = zone.portId;
      record.name = vessel.name ?? record.name;
      record.lastMs = nowMs;
    }

    // Drop vessels not seen for 12h to keep fairness over the active fleet.
    for (const [id, record] of state.vessels.entries()) {
      if (nowMs - record.lastMs > 12 * 3_600_000) state.vessels.delete(id);
    }

    state.lastIntervalFuelTonnes = intervalFuel;

    // Primal-dual multiplier update, rate-limited to once per minute (paper §3.1).
    if (nowMs - state.lastLambdaUpdateMs >= 60_000) {
      const violation = (state.totalCo2Tonnes - proratedBudget(nowMs)) / Math.max(1, dailyBudget());
      state.lambdaDual = Math.max(0, state.lambdaDual + cfg.lambdaLearningRate * violation);
      state.lastLambdaUpdateMs = nowMs;
    }
    state.lastUpdateMs = nowMs;
  }

  function portOccupancy() {
    const occupancy = new Map();
    const queues = new Map();
    for (const record of state.vessels.values()) {
      if (!record.portId) continue;
      if (record.state === "AT_BERTH") occupancy.set(record.portId, (occupancy.get(record.portId) ?? 0) + 1);
      if (record.state === "ANCHORED") queues.set(record.portId, (queues.get(record.portId) ?? 0) + 1);
    }
    return { occupancy, queues };
  }

  function metrics(nowMs = Date.now()) {
    const fuels = activeFuelValues();
    const budget = proratedBudget(nowMs);
    const excess = Math.max(0, state.totalCo2Tonnes - budget);
    const gini = computeGini(fuels);
    const minMax = computeMinMaxRatio(fuels);
    const fuelCost = state.lastIntervalFuelTonnes;
    const emissionPenalty = cfg.gammaEmis * excess;
    const fairnessPenalty = cfg.gammaFair * gini;
    const reward = -fuelCost - emissionPenalty - fairnessPenalty;
    const { occupancy, queues } = portOccupancy();
    return { fuels, budget, excess, gini, minMax, fuelCost, emissionPenalty, fairnessPenalty, reward, occupancy, queues };
  }

  function severity(satisfied, ratio) {
    if (satisfied) return "low";
    return ratio >= 1.25 ? "high" : "medium";
  }

  /** Build a ChmarlExperimentStep-conformant snapshot from live measures. */
  function buildStep(episodeIndex, nowMs = Date.now()) {
    update([], nowMs); // roll episode/lambda even with no new rows
    const m = metrics(nowMs);
    const now = new Date(nowMs).toISOString();
    const tracked = state.vessels.size;
    const busiestQueue = [...m.queues.entries()].sort((a, b) => b[1] - a[1])[0];
    const busiestCapacity = busiestQueue ? (cfg.portCapacity[busiestQueue[0]] ?? 10) : 10;

    const constraints = [
      {
        constraintId: "emission-budget",
        name: `CO2 vs prorated daily budget (${round3(dailyBudget())} t/day${cfg.emissionBudgetTonnesPerDay > 0 ? "" : `, ${cfg.budgetTonnesPerVesselPerDay} t/vessel`})`,
        value: round3(state.totalCo2Tonnes),
        limit: round3(m.budget),
        satisfied: state.totalCo2Tonnes <= m.budget,
        severity: severity(state.totalCo2Tonnes <= m.budget, m.budget > 0 ? state.totalCo2Tonnes / m.budget : 0),
      },
      {
        constraintId: "fuel-gini",
        name: "Fuel-consumption Gini",
        value: round3(m.gini),
        limit: cfg.giniLimit,
        satisfied: m.gini <= cfg.giniLimit,
        severity: severity(m.gini <= cfg.giniLimit, m.gini / cfg.giniLimit),
      },
      {
        constraintId: "fuel-minmax",
        name: "Fuel max-min ratio (higher is fairer)",
        value: round3(m.minMax),
        limit: cfg.minMaxLimit,
        satisfied: m.minMax >= cfg.minMaxLimit,
        severity: severity(m.minMax >= cfg.minMaxLimit, m.minMax > 0 ? cfg.minMaxLimit / m.minMax : 2),
      },
      {
        constraintId: "port-queue",
        name: busiestQueue ? `Anchorage queue ${busiestQueue[0]}` : "Anchorage queue",
        value: busiestQueue ? busiestQueue[1] : 0,
        limit: busiestCapacity,
        satisfied: !busiestQueue || busiestQueue[1] <= busiestCapacity,
        severity: severity(!busiestQueue || busiestQueue[1] <= busiestCapacity, busiestQueue ? busiestQueue[1] / busiestCapacity : 0),
      },
    ];

    return {
      experimentId: `ecofair-live-${state.episodeDate}`,
      scenarioId: "live-operations",
      episode: episodeIndex,
      step: Math.floor(nowMs / 1000),
      timestamp: now,
      state: {
        source: "live-ais-ecofair",
        rewardFormula: "r = -fuel_t - gamma_e*max(0, CO2 - budget) - gamma_f*Gini  (EcoFair-CH-MARL, arXiv:2603.14625)",
        trackedVessels: tracked,
        vesselsWithFuel: m.fuels.length,
        totalFuelTonnes: round3(state.totalFuelTonnes),
        totalCo2Tonnes: round3(state.totalCo2Tonnes),
        emissionBudgetTonnesPerDay: round3(dailyBudget()),
        budgetMode: cfg.emissionBudgetTonnesPerDay > 0 ? "fixed" : `per-vessel (${cfg.budgetTonnesPerVesselPerDay} t CO2/vessel/day)`,
        proratedBudgetTonnes: round3(m.budget),
        budgetExcessTonnes: round3(m.excess),
        lambdaDual: round3(state.lambdaDual),
        gammaEmis: cfg.gammaEmis,
        gammaFair: cfg.gammaFair,
        giniFuel: round3(m.gini),
        minMaxRatio: round3(m.minMax),
        episodeDateUtc: state.episodeDate,
      },
      actions: [
        { agentId: "budget-layer", agentType: "constraint_shield", actionType: "primal_dual_update", actionValue: round3(state.lambdaDual) },
        { agentId: "coordinator", agentType: "fleet", actionType: "score_ecofair_reward", actionValue: round3(m.reward) },
        { agentId: "fairness-transformer", agentType: "fleet", actionType: "measure_fuel_equity", actionValue: round3(m.gini) },
      ],
      rewards: [
        { agentId: "coordinator", component: "global", value: round3(m.reward) },
        { agentId: "fleet-agent", component: "fuel", value: round3(-m.fuelCost) },
        { agentId: "budget-layer", component: "emissions", value: round3(-m.emissionPenalty) },
        { agentId: "fairness-transformer", component: "fairness", value: round3(-m.fairnessPenalty) },
        { agentId: "budget-layer", component: "constraint_penalty", value: round3(-state.lambdaDual * m.excess) },
      ],
      constraints,
      fairness: [
        { metricId: "fuel-gini", name: "Fuel Gini coefficient", value: round3(m.gini), groupBy: "vessel" },
        { metricId: "fuel-minmax", name: "Fuel max-min ratio", value: round3(m.minMax), groupBy: "vessel" },
      ],
      hierarchyDecisions: [
        {
          level: "coordinator",
          decisionId: "ecofair-reward",
          decisionLabel: `EcoFair reward ${round3(m.reward)} (fuel ${round3(m.fuelCost)} t, CO2 excess ${round3(m.excess)} t, Gini ${round3(m.gini)})`,
          rationale: "Live application of the EcoFair-CH-MARL reward: negative fleet fuel minus emission-budget and fairness penalties.",
        },
        {
          level: "budget-layer",
          decisionId: "primal-dual",
          decisionLabel: state.totalCo2Tonnes > m.budget ? `Budget exceeded - dual price rising (lambda=${round3(state.lambdaDual)})` : `Within budget - dual price ${round3(state.lambdaDual)}`,
          rationale: "lambda <- max(0, lambda + eta*(E - B)/B) once per minute; the multiplier persists across daily episodes as a running emission price.",
        },
        {
          level: "shield",
          decisionId: "constraint-shield",
          decisionLabel: constraints.some((c) => !c.satisfied) ? "Constraint shield active" : "Constraint shield nominal",
          rationale: "Constraints evaluated on real AIS-derived fuel, emissions, fairness, and port-queue measures. No fixtures.",
        },
      ],
    };
  }

  /** Real port operations derived from AIS geofences. */
  function buildPortOperations(nowMs = Date.now()) {
    const { occupancy, queues } = portOccupancy();
    const portUtilization = cfg.ports.map((port) => {
      const capacity = cfg.portCapacity[port.id] ?? 10;
      const berthed = occupancy.get(port.id) ?? 0;
      return { name: port.id, value: Math.min(100, Math.round((berthed / capacity) * 100)) };
    });
    const queueStatus = cfg.ports.map((port) => ({
      portId: port.id,
      queueLength: queues.get(port.id) ?? 0,
      waitingVessels: queues.get(port.id) ?? 0,
      utilizationPct: portUtilization.find((row) => row.name === port.id)?.value ?? 0,
      timestamp: new Date(nowMs).toISOString(),
    }));
    return {
      source: "ais-derived",
      portEvents: [...state.events].reverse(),
      portUtilization,
      queueStatus,
    };
  }

  /** Markdown evidence report of today's live measures + recent daily history. */
  function buildReport(nowMs = Date.now()) {
    const m = metrics(nowMs);
    const ops = buildPortOperations(nowMs);
    const lines = [
      `# EcoFair-CH-MARL Live Operations Report`,
      ``,
      `Generated: ${new Date(nowMs).toISOString()}  `,
      `Episode (UTC day): ${state.episodeDate}  `,
      `Method: EcoFair-CH-MARL measures (Alqithami, arXiv:2603.14625, ECAI 2025) computed on live AIS observations of the Red Sea / Gulf region.`,
      ``,
      `## Fleet measures`,
      ``,
      `| Measure | Value |`,
      `| --- | --- |`,
      `| Tracked vessels | ${state.vessels.size} |`,
      `| Fleet fuel today (t) | ${round3(state.totalFuelTonnes)} |`,
      `| Fleet CO2 today (t) | ${round3(state.totalCo2Tonnes)} |`,
      `| Emission budget (t/day) | ${round3(dailyBudget())}${cfg.emissionBudgetTonnesPerDay > 0 ? " (fixed)" : ` (${cfg.budgetTonnesPerVesselPerDay} t/vessel x ${state.vessels.size} vessels)`} |`,
      `| Prorated budget now (t) | ${round3(m.budget)} |`,
      `| Budget excess (t) | ${round3(m.excess)} |`,
      `| Dual price lambda | ${round3(state.lambdaDual)} |`,
      `| Fuel Gini | ${round3(m.gini)} |`,
      `| Fuel max-min ratio | ${round3(m.minMax)} |`,
      `| EcoFair reward | ${round3(m.reward)} |`,
      ``,
      `## Port queues and utilization (AIS-derived)`,
      ``,
      `| Port | Berthed utilization % | Anchorage queue |`,
      `| --- | --- | --- |`,
      ...ops.queueStatus.map((row) => `| ${row.portId} | ${row.utilizationPct} | ${row.queueLength} |`),
      ``,
      `## Recent daily episodes`,
      ``,
      `| Date | Fuel (t) | CO2 (t) | Excess (t) | Gini | Max-min | lambda |`,
      `| --- | --- | --- | --- | --- | --- | --- |`,
      ...state.dailyHistory.slice(-14).map((d) => `| ${d.date} | ${d.totalFuelTonnes} | ${d.totalCo2Tonnes} | ${d.budgetExcessTonnes} | ${d.giniFuel} | ${d.minMaxRatio} | ${d.lambdaDual} |`),
      ``,
      `## Provenance`,
      ``,
      `- Vessel positions: aisstream.io live AIS (Red Sea / Gulf bounding boxes).`,
      `- Fuel model: cubic law fuel = k*v^3 with per-vessel k in [5e-4, 1e-3] t/(kt^3 h), idle load ${IDLE_LOAD}, queue load ${QUEUE_LOAD} (paper reference implementation).`,
      `- Emissions: ${CO2_PER_TONNE_FUEL} t CO2 per t fuel (IMO GHG factor).`,
      `- Fuel figures are model estimates from AIS kinematics, not bunker measurements.`,
    ];
    return lines.join("\n");
  }

  function summary() {
    return {
      episodeDate: state.episodeDate,
      trackedVessels: state.vessels.size,
      totalFuelTonnes: round3(state.totalFuelTonnes),
      totalCo2Tonnes: round3(state.totalCo2Tonnes),
      lambdaDual: round3(state.lambdaDual),
      events: state.events.length,
      dailyEpisodes: state.dailyHistory.length,
      lastUpdate: state.lastUpdateMs ? new Date(state.lastUpdateMs).toISOString() : null,
    };
  }

  function serialize() {
    return {
      version: 1,
      episodeDate: state.episodeDate,
      totalFuelTonnes: state.totalFuelTonnes,
      totalCo2Tonnes: state.totalCo2Tonnes,
      lambdaDual: state.lambdaDual,
      eventCounter: state.eventCounter,
      events: state.events,
      dailyHistory: state.dailyHistory,
      vessels: [...state.vessels.entries()].map(([id, r]) => ({ id, ...r })),
    };
  }

  function restore(payload) {
    if (!payload || payload.version !== 1) return false;
    state.episodeDate = payload.episodeDate ?? state.episodeDate;
    state.totalFuelTonnes = Number(payload.totalFuelTonnes) || 0;
    state.totalCo2Tonnes = Number(payload.totalCo2Tonnes) || 0;
    state.lambdaDual = Number(payload.lambdaDual) || 0;
    state.eventCounter = Number(payload.eventCounter) || 0;
    state.events = Array.isArray(payload.events) ? payload.events.slice(-cfg.maxEvents) : [];
    state.dailyHistory = Array.isArray(payload.dailyHistory) ? payload.dailyHistory.slice(-cfg.maxDailyHistory) : [];
    state.vessels.clear();
    for (const row of payload.vessels ?? []) {
      if (!row?.id) continue;
      state.vessels.set(row.id, {
        fuelTonnes: Number(row.fuelTonnes) || 0,
        co2Tonnes: Number(row.co2Tonnes) || 0,
        lastMs: Number(row.lastMs) || Date.now(),
        state: KNOWN_STATES.includes(row.state) ? row.state : "DRIFTING",
        portId: row.portId ?? null,
        name: row.name ?? row.id,
        k: Number(row.k) || fuelCurveFactor(row.id),
      });
    }
    return true;
  }

  return { config: cfg, update, buildStep, buildPortOperations, buildReport, summary, serialize, restore, metrics };
}

function round3(value) {
  return Number(Number(value ?? 0).toFixed(3));
}
