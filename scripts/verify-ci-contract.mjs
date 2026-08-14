import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const approvedWorkflows = new Set([
  "build.yml",
  "ci.yml",
  "verify-build.yml",
]);

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
  "Dockerfile",
  "package.json",
  "pnpm-lock.yaml",
  "scripts/verify-ci-contract.mjs",
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
requireText("Dockerfile", "FROM node:24-slim AS build");
requireText("Dockerfile", "FROM node:24-slim AS runtime");
forbidText("Dockerfile", "FROM node:20");

const workflowDirectory = path.join(root, ".github", "workflows");
const workflowFiles = fs
  .readdirSync(workflowDirectory, { withFileTypes: true })
  .filter(entry => entry.isFile() && /\.ya?ml$/i.test(entry.name));

for (const entry of workflowFiles) {
  const workflowPath = `.github/workflows/${entry.name}`;
  const source = read(workflowPath);

  if (!approvedWorkflows.has(entry.name)) {
    failures.push(
      `Unapproved workflow ${workflowPath}. One-time source generators and repair workflows must not be committed.`
    );
  }

  const requirements = [
    "permissions:\n  contents: read",
    "actions/checkout@v6",
    "actions/setup-node@v6",
    "node-version-file: .node-version",
    "package-manager-cache: false",
    "corepack prepare pnpm@9.15.9 --activate",
    "node scripts/verify-ci-contract.mjs",
    "pnpm install --frozen-lockfile",
    "pnpm check",
    "pnpm verify:dist",
    "git diff --check",
  ];
  for (const requirement of requirements) {
    if (!source.includes(requirement)) {
      failures.push(`${workflowPath} is missing: ${requirement}`);
    }
  }

  const forbiddenFragments = [
    "contents: write",
    "actions/checkout@v4",
    "actions/setup-node@v4",
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
  `CI and runtime contract verification passed (${workflowFiles.length} approved workflows, Node ${read(".node-version").trim()}).`
);
