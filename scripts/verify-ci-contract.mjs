import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const approvedWorkflows = new Set([
  "build.yml",
  "ci.yml",
  "production-monitor.yml",
]);
const buildWorkflows = new Set(["build.yml", "ci.yml"]);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function requireFile(relativePath) {
  if (!exists(relativePath)) failures.push(`Missing required file: ${relativePath}`);
}

function requireText(relativePath, text) {
  if (!exists(relativePath) || !read(relativePath).includes(text)) {
    failures.push(`${relativePath} is missing required text: ${text}`);
  }
}

function forbidText(relativePath, text) {
  if (exists(relativePath) && read(relativePath).includes(text)) {
    failures.push(`${relativePath} contains forbidden text: ${text}`);
  }
}

[
  ".node-version",
  ".devcontainer/devcontainer.json",
  "Dockerfile",
  "package.json",
  "pnpm-lock.yaml",
  "scripts/verify-ci-contract.mjs",
  "scripts/check-deployed-service.mjs",
  "docs/CI_RUNTIME_GOVERNANCE.md",
  "docs/PRODUCTION_MONITORING.md",
].forEach(requireFile);

if (exists(".node-version") && read(".node-version").trim() !== "24") {
  failures.push(".node-version must pin the Node 24 release line.");
}

requireText("package.json", '"node": ">=24 <25"');
requireText("package.json", '"packageManager": "pnpm@9.15.9"');
requireText(
  "package.json",
  '"verify:ci": "node scripts/verify-ci-contract.mjs"'
);
requireText(
  "package.json",
  '"monitor:production": "node scripts/check-deployed-service.mjs"'
);
requireText("package.json", '"check": "pnpm verify:ci &&');
requireText("Dockerfile", "FROM node:24-slim AS build");
requireText("Dockerfile", "FROM node:24-slim AS runtime");
requireText(
  ".devcontainer/devcontainer.json",
  "mcr.microsoft.com/devcontainers/javascript-node:24"
);
requireText(
  ".devcontainer/devcontainer.json",
  "pnpm install --frozen-lockfile"
);
requireText("docs/CI_RUNTIME_GOVERNANCE.md", "Node.js 24");
requireText("docs/CI_RUNTIME_GOVERNANCE.md", "Apply portal resilience patch");
requireText("docs/PRODUCTION_MONITORING.md", "AIS data is considered ready only when");
forbidText("Dockerfile", "FROM node:20");
forbidText(".devcontainer/devcontainer.json", "javascript-node:20");

const workflowDirectory = path.join(root, ".github", "workflows");
const workflowFiles = fs
  .readdirSync(workflowDirectory, { withFileTypes: true })
  .filter(entry => entry.isFile() && /\.ya?ml$/i.test(entry.name));

const commonRequirements = [
  "permissions:\n  contents: read",
  "actions/checkout@v6",
  "persist-credentials: false",
  "actions/setup-node@v6",
  "node-version-file: .node-version",
  "package-manager-cache: false",
];
const buildRequirements = [
  "corepack prepare pnpm@9.15.9 --activate",
  "node scripts/verify-ci-contract.mjs",
  "pnpm install --frozen-lockfile",
  "pnpm check",
  "pnpm verify:dist",
  "git diff --check",
];
const forbiddenFragments = [
  "contents: write",
  "actions/checkout@v4",
  "actions/setup-node@v4",
  "actions/upload-artifact@v4",
  "node-version: 20",
  "pnpm/action-setup",
  "cache: pnpm",
  "ref: agent/",
  "persist-credentials: true",
  "git push",
  "base64 --decode",
  "gzip --decompress",
  "Apply portal resilience patch",
];

for (const entry of workflowFiles) {
  const workflowPath = `.github/workflows/${entry.name}`;
  const source = read(workflowPath);

  if (!approvedWorkflows.has(entry.name)) {
    failures.push(
      `Unapproved workflow ${workflowPath}. One-time source generators and repair workflows must not be committed.`
    );
  }

  for (const requirement of commonRequirements) {
    if (!source.includes(requirement)) {
      failures.push(`${workflowPath} is missing: ${requirement}`);
    }
  }

  if (buildWorkflows.has(entry.name)) {
    for (const requirement of buildRequirements) {
      if (!source.includes(requirement)) {
        failures.push(`${workflowPath} is missing: ${requirement}`);
      }
    }
  }

  for (const fragment of forbiddenFragments) {
    if (source.includes(fragment)) {
      failures.push(`${workflowPath} contains forbidden workflow fragment: ${fragment}`);
    }
  }
}

for (const expected of approvedWorkflows) {
  if (!workflowFiles.some(entry => entry.name === expected)) {
    failures.push(`Approved workflow is missing: .github/workflows/${expected}`);
  }
}

requireText(".github/workflows/build.yml", "push:\n    branches: [main]");
requireText(".github/workflows/build.yml", "pull_request:\n    branches: [main]");
requireText(".github/workflows/build.yml", "workflow_dispatch:");
requireText(".github/workflows/ci.yml", "workflow_dispatch:");
forbidText(".github/workflows/ci.yml", "pull_request:");
forbidText(".github/workflows/ci.yml", "push:\n    branches:");

requireText(
  ".github/workflows/build.yml",
  "docker build --tag chmarl-datav:ci ."
);
requireText(
  ".github/workflows/build.yml",
  "http://127.0.0.1:8787/health/live"
);
requireText(
  ".github/workflows/build.yml",
  "http://127.0.0.1:8787/version"
);

requireText(".github/workflows/production-monitor.yml", "workflow_run:");
requireText(".github/workflows/production-monitor.yml", "workflows: [\"Build\"]");
requireText(".github/workflows/production-monitor.yml", "schedule:");
requireText(
  ".github/workflows/production-monitor.yml",
  "https://chmarl-datav.onrender.com"
);
requireText(
  ".github/workflows/production-monitor.yml",
  "node scripts/check-deployed-service.mjs"
);
requireText(
  ".github/workflows/production-monitor.yml",
  "actions/upload-artifact@v7"
);
requireText(
  ".github/workflows/production-monitor.yml",
  "EXPECTED_REVISION"
);
requireText(
  "scripts/check-deployed-service.mjs",
  "A connected AIS socket with zero current position messages is recorded as degraded data"
);
requireText(
  "scripts/check-deployed-service.mjs",
  "REQUIRE_DATA_READY"
);
requireText(
  "scripts/check-deployed-service.mjs",
  'request("/health/live", [200], true)'
);
requireText(
  "scripts/check-deployed-service.mjs",
  'request("/health/ready", [200, 503], true)'
);

const forbiddenPayloadPatterns = [
  /\.b64$/i,
  /\.gz\.b64$/i,
  /\.payload$/i,
  /\.part\d+$/i,
];
for (const entry of fs.readdirSync(path.join(root, "scripts"), {
  withFileTypes: true,
})) {
  if (
    entry.isFile() &&
    forbiddenPayloadPatterns.some(pattern => pattern.test(entry.name))
  ) {
    failures.push(`Generated repair payload must not be committed: scripts/${entry.name}`);
  }
}

if (failures.length) {
  console.error("CI and runtime contract verification failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log(
  `CI and runtime contract verification passed (${workflowFiles.length} approved workflows, one automatic build path, one deployment monitor, Node ${read(".node-version").trim()}).`
);
