# EcoFair merge bundle

This bundle contains the uploaded EcoFair-CH-MARL measurement enhancements plus production-build fixes that were already needed in the main repository.

From the repository root:

```bash
unzip ecofair_merge_bundle.zip -d /tmp/ecofair_merge_bundle
bash /tmp/ecofair_merge_bundle/ecofair_merge_bundle/APPLY_ECOFAIR_MERGE.sh .
git status --short
git add README.md .env.example Dockerfile render.yaml package.json tsconfig.app.json docs/ECOFAIR_MEASURES.md server/vessel-feed-proxy/index.mjs server/vessel-feed-proxy/ecofair.mjs scripts/chmarl-ingest-bridge.py src/export/dashboardExports.ts src/components/DashboardShell.tsx
git commit -m "Integrate EcoFair CH-MARL live measurement runtime"
git push origin main
```

Then redeploy Render.
