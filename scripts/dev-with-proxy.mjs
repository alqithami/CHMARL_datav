import { spawn } from "node:child_process";

const proxyPort = process.env.PORT ?? "8787";
const dashboardPort = process.env.VITE_PORT ?? "5173";
const vesselFeedUrl = process.env.VITE_VESSEL_DATA_URL ?? `http://localhost:${proxyPort}/api/vessels`;

const processes = [];

function run(name, command, args, env = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      ...env,
    },
  });

  child.on("exit", (code, signal) => {
    if (signal) return;
    if (code && code !== 0) {
      console.error(`${name} exited with code ${code}`);
      shutdown(code);
    }
  });

  processes.push(child);
  return child;
}

function shutdown(code = 0) {
  for (const child of processes) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("exit", () => {
  for (const child of processes) {
    if (!child.killed) child.kill("SIGTERM");
  }
});

console.log(`Starting vessel proxy on port ${proxyPort}`);
run("vessel-feed-proxy", "node", ["server/vessel-feed-proxy/index.mjs"], {
  PORT: proxyPort,
});

console.log(`Starting dashboard on port ${dashboardPort}`);
console.log(`Using vessel feed: ${vesselFeedUrl}`);
run("vite", "pnpm", ["exec", "vite", "--host", "0.0.0.0", "--port", dashboardPort], {
  VITE_VESSEL_DATA_URL: vesselFeedUrl,
});
