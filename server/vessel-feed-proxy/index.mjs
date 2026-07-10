import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

const payloadPath = fileURLToPath(new URL("./index.input-runtime.mjs.gz.b64", import.meta.url));
const generatedPath = fileURLToPath(new URL("./index.input-runtime.generated.mjs", import.meta.url));
const encoded = readFileSync(payloadPath, "utf8").trim();
const source = gunzipSync(Buffer.from(encoded, "base64")).toString("utf8");

writeFileSync(generatedPath, source);
await import(pathToFileURL(generatedPath).href);
