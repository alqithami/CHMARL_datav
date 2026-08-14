# CH-MARL DataV CI and runtime governance

This repository uses one supported runtime baseline across GitHub Actions, Codespaces, local development, Docker, and Render:

```text
Node.js 24
pnpm 9.15.9
```

The baseline is declared in `.node-version`, `package.json`, the permanent workflows, the dev container, and the Dockerfile.

## Permanent workflows

The reviewed workflows are:

- `.github/workflows/build.yml` — automatic pull-request and `main` validation, plus manual dispatch;
- `.github/workflows/verify-build.yml` — independent production-bundle and runtime verification;
- `.github/workflows/ci.yml` — manually dispatched operator verification.

All permanent workflows must:

- use `actions/checkout@v6` and `actions/setup-node@v6`;
- read `.node-version` rather than pinning a different runtime in YAML;
- keep repository permissions read-only;
- activate the pinned pnpm version through Corepack;
- verify `pnpm-lock.yaml` with `pnpm install --frozen-lockfile`;
- run the CI contract, lint, production build, runtime smoke test, artifact verification, and `git diff --check`.

## Prohibited repair mechanisms

Do not commit one-time workflows that rewrite or push source code. In particular, permanent workflows must not contain:

- `contents: write`;
- `git push`;
- hard-coded `agent/*` checkout refs;
- compressed or Base64 source payloads;
- steps that generate `pnpm-lock.yaml` after `actions/setup-node` has already requested pnpm caching;
- the retired `Apply portal resilience patch` workflow.

The resilience patch was ultimately applied and merged through pull request #1. Its earlier temporary workflow runs failed because setup-node requested a pnpm cache before the branch contained `pnpm-lock.yaml`. Those historical red runs should not be rerun.

## Local verification

Run:

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install --frozen-lockfile
pnpm check
pnpm verify:dist
git diff --check
```

`pnpm check` begins with `pnpm verify:ci`, which validates the supported workflow and runtime contract before linting, building, and running the production server smoke test.

## Deployment interpretation

`/health/live` represents process and static-dashboard liveness. `/health/ready` represents truthful vessel-data readiness and can remain HTTP 503 when AISStream is connected but no current position messages have been received. A successful deployment therefore requires the exact release to appear in `/version` and `/health/live`; data readiness must be assessed separately rather than masked by the deployment probe.
