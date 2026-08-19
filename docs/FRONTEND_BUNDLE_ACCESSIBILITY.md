# Frontend bundle and chart accessibility contract

The CH-MARL DataV portal renders the live maritime map with Leaflet and the remaining analytical charts with ECharts. Production builds must include only the libraries and ECharts modules that are reachable from the active interface.

## ECharts module boundary

`src/components/Chart.tsx` registers only:

- bar and line chart implementations;
- grid, tooltip, axis-pointer, and graphic components;
- the Canvas renderer.

Do not return to `import * as echarts from "echarts"`. That import loads the complete chart distribution even though the portal uses only bar and line charts.

## Vite chunking

`vite.config.ts` groups only modules that are already present in the Rollup graph:

- `vendor-react` for React, React DOM, and Scheduler;
- `vendor-leaflet` for the active map runtime;
- `vendor-charts` for the tree-shaken ECharts and ZRender modules.

The build must not force `three`, `@react-three/fiber`, or `@react-three/drei` into a production chunk while the active map is Leaflet.

## Production budget

`pnpm verify:dist` examines every generated JavaScript asset. It fails when:

- a retired `vendor-three-*` or `vendor-echarts-*` chunk reappears;
- a JavaScript chunk exceeds `MAX_PRODUCTION_JS_CHUNK_BYTES`;
- the production HTML or asset directory is missing.

The default maximum is 900,000 bytes per minified JavaScript chunk. A temporary override may be supplied for diagnosis, but a higher value must not be committed as a substitute for correcting imports or chunking.

## Accessible chart output

Each ECharts surface must provide:

- a specific accessible name through `aria-label`;
- a text summary connected through `aria-describedby`;
- the same values and status classifications shown visually;
- an explicit empty-state summary when no operational data is available.

The current summaries cover operational constraint pressure, port utilization, and the CH-MARL reward trend. The Canvas output remains visual; the text summary is the authoritative non-visual representation.

## Validation

Run:

```bash
pnpm check
pnpm verify:dist
```

The permanent UI contract rejects the full ECharts import, forced Three.js/ECharts chunks, missing chart descriptions, and removal of the production bundle budget.
