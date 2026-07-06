#!/usr/bin/env python3
"""
Bridge EcoFairCHMARL.py training results into the CH-MARL DataV portal.

Reads the CSV outputs produced by EcoFairCHMARL.py
(github.com/alqithami/EcoFairCHAMRL):

    training_fairness_metrics_<algo>.csv   episode, gini, max_min_ratio
    fairness_metrics_<algo>.csv            episode, gini, max_min_ratio (eval)
    results_<algo>.csv                     episode, return (eval)

and POSTs a ChmarlExperimentStep[] payload to the portal's
/api/chmarl/ingest endpoint so research-grade experiment runs are visible
alongside the live EcoFair measures.

Uses only the Python standard library.

Examples:
    # After: python EcoFairCHMARL.py --algo PPO --fairness --emission_cap
    python scripts/chmarl-ingest-bridge.py --outdir results/ --algo ppo \
        --url https://your-portal.onrender.com/api/chmarl/ingest \
        --token $CHMARL_INGEST_TOKEN

    # Local development portal:
    python scripts/chmarl-ingest-bridge.py --outdir results/ --algo ppo
"""

import argparse
import csv
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone


def read_csv(path):
    if not os.path.exists(path):
        return []
    with open(path, newline="") as handle:
        return list(csv.DictReader(handle))


def as_float(value, fallback=None):
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def downsample(rows, limit):
    if len(rows) <= limit:
        return rows
    stride = len(rows) / limit
    return [rows[int(i * stride)] for i in range(limit)]


def build_steps(outdir, algo, max_training_steps):
    now = datetime.now(timezone.utc).isoformat()
    training = read_csv(os.path.join(outdir, f"training_fairness_metrics_{algo}.csv"))
    eval_fair = read_csv(os.path.join(outdir, f"fairness_metrics_{algo}.csv"))
    eval_returns = read_csv(os.path.join(outdir, f"results_{algo}.csv"))
    returns_by_episode = {row.get("episode"): as_float(row.get("return")) for row in eval_returns}

    if not training and not eval_fair:
        raise SystemExit(
            f"No EcoFairCHMARL CSVs found in {outdir!r} for algo {algo!r}. "
            "Run EcoFairCHMARL.py first (see its README)."
        )

    steps = []
    for index, row in enumerate(downsample(training, max_training_steps), start=1):
        gini = as_float(row.get("gini"), 0.0)
        ratio = as_float(row.get("max_min_ratio"), 1.0)
        steps.append({
            "experimentId": f"ecofair-{algo}-training",
            "scenarioId": "ecofair-experiment",
            "episode": int(as_float(row.get("episode"), index) or index),
            "step": index,
            "timestamp": now,
            "state": {"phase": "training", "algo": algo.upper(), "source": "EcoFairCHMARL.py"},
            "fairness": [
                {"metricId": "fuel-gini", "name": "Fuel Gini coefficient", "value": round(gini, 4), "groupBy": "vessel"},
                {"metricId": "fuel-minmax", "name": "Fuel max-min ratio", "value": round(ratio, 4), "groupBy": "vessel"},
            ],
        })

    for index, row in enumerate(eval_fair, start=1):
        episode = row.get("episode")
        gini = as_float(row.get("gini"), 0.0)
        ratio = as_float(row.get("max_min_ratio"), 1.0)
        ep_return = returns_by_episode.get(episode)
        step = {
            "experimentId": f"ecofair-{algo}-eval",
            "scenarioId": "ecofair-experiment",
            "episode": int(as_float(episode, index) or index),
            "step": len(steps) + index,
            "timestamp": now,
            "state": {"phase": "evaluation", "algo": algo.upper(), "source": "EcoFairCHMARL.py"},
            "fairness": [
                {"metricId": "fuel-gini", "name": "Fuel Gini coefficient", "value": round(gini, 4), "groupBy": "vessel"},
                {"metricId": "fuel-minmax", "name": "Fuel max-min ratio", "value": round(ratio, 4), "groupBy": "vessel"},
            ],
        }
        if ep_return is not None:
            step["rewards"] = [{"agentId": "coordinator", "component": "global", "value": round(ep_return, 4)}]
        steps.append(step)

    return steps


def post(url, token, payload):
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=body, method="POST")
    request.add_header("content-type", "application/json")
    if token:
        request.add_header("authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Ingest failed: HTTP {error.code} - {detail}")
    except urllib.error.URLError as error:
        raise SystemExit(f"Ingest failed: cannot reach {url} ({error.reason})")


def main():
    cli = argparse.ArgumentParser(description="Ingest EcoFairCHMARL.py results into the CH-MARL DataV portal")
    cli.add_argument("--outdir", default="results/", help="EcoFairCHMARL.py output directory")
    cli.add_argument("--algo", default="ppo", help="Algorithm suffix used in the CSV filenames (ppo, soto, fen, ...)")
    cli.add_argument("--url", default="http://localhost:8787/api/chmarl/ingest", help="Portal ingest endpoint")
    cli.add_argument("--token", default=os.environ.get("CHMARL_INGEST_TOKEN", ""), help="Bearer token (or set CHMARL_INGEST_TOKEN)")
    cli.add_argument("--max-training-steps", type=int, default=400, help="Downsample training episodes to at most this many steps")
    cli.add_argument("--dry-run", action="store_true", help="Print the payload instead of POSTing")
    args = cli.parse_args()

    steps = build_steps(args.outdir, args.algo.lower(), args.max_training_steps)
    payload = {
        "experimentId": f"ecofair-{args.algo.lower()}",
        "scenarioId": "ecofair-experiment",
        "source": "EcoFairCHMARL.py",
        "steps": steps,
    }

    if args.dry_run:
        json.dump(payload, sys.stdout, indent=2)
        print()
        return

    result = post(args.url, args.token, payload)
    print(f"Ingested {len(steps)} steps into {args.url}")
    print(json.dumps({k: result.get(k) for k in ("source", "experimentId", "scenarioId")}, indent=2))


if __name__ == "__main__":
    main()
