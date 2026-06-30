#!/usr/bin/env node

process.env.PORT ??= "5173";
await import("./dev-single-port.mjs");
