#!/usr/bin/env bash
set -euo pipefail

repo="${1:-.}"
cd "$repo"

python3 - <<'PY'
from pathlib import Path

source = Path("src/data/loadSampleDashboardData.ts")
text = source.read_text()

old_signature = """function externalTimeline(source: DashboardDataSource, rows: Vessel[], chmarlSource: ChmarlDataSource, portOpsSource: PortOpsDataSource, vesselScope: VesselScopeSummary): TimelineEvent[] {"""
new_signature = """function externalTimeline(source: DashboardDataSource, chmarlSource: ChmarlDataSource, portOpsSource: PortOpsDataSource, vesselScope: VesselScopeSummary): TimelineEvent[] {"""

old_call = """externalTimeline(source, providerRows, chmarlSource, portOpsSource, vesselScope)"""
new_call = """externalTimeline(source, chmarlSource, portOpsSource, vesselScope)"""

if old_signature not in text:
    raise SystemExit("Expected externalTimeline signature was not found. The file may already be fixed or has changed.")
if old_call not in text:
    raise SystemExit("Expected externalTimeline call was not found. The file may already be fixed or has changed.")

text = text.replace(old_signature, new_signature, 1)
text = text.replace(old_call, new_call, 1)
source.write_text(text)

render = Path("render.yaml")
render_text = render.read_text()
if "autoDeployTrigger: commit" in render_text:
    render_text = render_text.replace("autoDeployTrigger: commit", "autoDeployTrigger: checksPass", 1)
elif "autoDeployTrigger: checksPass" not in render_text:
    raise SystemExit("render.yaml does not contain the expected autoDeployTrigger setting.")
render.write_text(render_text)

workflow = Path(".github/workflows/build.yml")
workflow.parent.mkdir(parents=True, exist_ok=True)
workflow.write_text("""name: Build

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Enable Corepack
        run: corepack enable

      - name: Install dependencies
        run: pnpm install --no-frozen-lockfile

      - name: Type-check and build
        run: pnpm build
""")

print("Fixed unused rows parameter.")
print("Set Render auto-deploy to checksPass.")
print("Added .github/workflows/build.yml.")
PY

pnpm install --no-frozen-lockfile
pnpm build
git diff --check

echo
echo "Build passed."
echo "Review with: git status --short && git diff"
echo "Then commit with:"
echo '  git add src/data/loadSampleDashboardData.ts render.yaml .github/workflows/build.yml'
echo '  git commit -m "Fix dashboard build and gate Render deploys on CI"'
echo '  git push origin main'
