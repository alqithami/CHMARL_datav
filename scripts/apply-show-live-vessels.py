from pathlib import Path
import json


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    Path(path).write_text(content if content.endswith("\n") else content + "\n", encoding="utf-8")
    print(f"updated {path}")


def replace_once(content: str, before: str, after: str, label: str) -> str:
    count = content.count(before)
    if count != 1:
        raise RuntimeError(f"Expected one {label}, found {count}")
    return content.replace(before, after, 1)


def update_dashboard_shell() -> None:
    path = "src/components/DashboardShell.tsx"
    content = read(path)

    content = replace_once(
        content,
        '''function isExternalSource(source: DashboardDataSource) {
  return source === "aisstream" || source === "aisstream-waiting" || source === "upstream" || source === "remote";
}''',
        '''function isExternalSource(source: DashboardDataSource) {
  return source === "aisstream"
    || source === "datalastic"
    || source === "pocketworld"
    || source === "ais-multi-provider"
    || source === "aisstream-waiting"
    || source === "upstream"
    || source === "remote";
}''',
        "live external-source classification",
    )

    content = replace_once(
        content,
        '''function sourceLabel(source: DashboardDataSource) {
  if (source === "aisstream") return "Live AIS";
  if (source === "aisstream-waiting") return "AIS waiting";
  if (source === "upstream") return "Upstream API";
  if (source === "remote") return "Remote proxy";
  if (source === "local-json") return "Local fixtures";
  if (source === "none") return "No vessel feed";
  return "Backend unavailable";
}''',
        '''function sourceLabel(source: DashboardDataSource) {
  if (source === "aisstream") return "AISStream live AIS";
  if (source === "datalastic") return "Datalastic live AIS";
  if (source === "pocketworld") return "Public regional live AIS";
  if (source === "ais-multi-provider") return "Multi-provider live AIS";
  if (source === "aisstream-waiting") return "AIS waiting";
  if (source === "upstream") return "Upstream API";
  if (source === "remote") return "Remote proxy";
  if (source === "local-json") return "Local fixtures";
  if (source === "none") return "No vessel feed";
  return "Backend unavailable";
}''',
        "live AIS source labels",
    )

    content = replace_once(
        content,
        '''function sourceRefreshMs(source: DashboardDataSource) {
  if (source === "aisstream" || source === "aisstream-waiting") return 5_000;
  if (source === "upstream" || source === "remote") return 15_000;
  return 30_000;
}''',
        '''function sourceRefreshMs(source: DashboardDataSource) {
  if (source === "aisstream"
    || source === "datalastic"
    || source === "pocketworld"
    || source === "ais-multi-provider"
    || source === "aisstream-waiting") return 5_000;
  if (source === "upstream" || source === "remote") return 15_000;
  return 30_000;
}''',
        "live AIS refresh schedule",
    )

    write(path, content)


def update_ship_scene() -> None:
    path = "src/components/ShipScene.tsx"
    content = read(path)

    content = replace_once(
        content,
        'import { useMemo, useState } from "react";',
        'import { useEffect, useMemo, useRef, useState } from "react";',
        "React map lifecycle imports",
    )

    content = replace_once(
        content,
        '''  const [showPorts, setShowPorts] = useState(true);
  const [showEvents, setShowEvents] = useState(true);
  const [showTrails, setShowTrails] = useState(false);
  const sceneVessels = vessels ?? fallbackVessels;
  const query = searchQuery.trim().toLowerCase();''',
        '''  const [showPorts, setShowPorts] = useState(true);
  const [showEvents, setShowEvents] = useState(true);
  const [showTrails, setShowTrails] = useState(false);
  const hasAutoFittedVessels = useRef(false);
  const sceneVessels = vessels ?? fallbackVessels;
  const query = searchQuery.trim().toLowerCase();

  useEffect(() => {
    if (hasAutoFittedVessels.current || !vessels || vessels.length === 0) return;
    const center = centerOfVessels(vessels);
    if (!center) return;
    setManualCenter(center);
    setMapZoom(zoomForVessels(vessels));
    setSelectedShipId("");
    setHoveredShipId("");
    hasAutoFittedVessels.current = true;
  }, [vessels]);''',
        "initial live-vessel auto-fit effect",
    )

    write(path, content)


def update_package() -> None:
    path = "package.json"
    package = json.loads(read(path))
    scripts = package.setdefault("scripts", {})
    scripts["verify:ui"] = "node scripts/check-live-ui-contract.mjs"
    existing_check = scripts.get("check", "")
    if "pnpm verify:ui" not in existing_check:
        scripts["check"] = existing_check + " && pnpm verify:ui"
    write(path, json.dumps(package, indent=2))


def remove_bootstrap() -> None:
    for path in [
        "scripts/apply-show-live-vessels.py",
        ".github/workflows/apply-show-live-vessels.yml",
    ]:
        file = Path(path)
        if file.exists():
            file.unlink()
            print(f"removed {path}")


update_dashboard_shell()
update_ship_scene()
update_package()
remove_bootstrap()
print("Live vessel visibility patch applied.")
