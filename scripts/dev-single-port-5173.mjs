#!/usr/bin/env node

// Force 5173 even if Codespaces, .env, or a previous shell command exported PORT=8787.
process.env.PORT = "5173";
await import("./dev-single-port.mjs");
