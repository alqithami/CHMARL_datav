import { readFileSync, writeFileSync } from "node:fs";

const path = "scripts/apply-live-ais-provider-failover.mjs";
let source = readFileSync(path, "utf8");
const before = '    return `datalastic-${datalasticState.status}`;';
const after = '    return "datalastic-" + datalasticState.status;';
if (!source.includes(before)) throw new Error("Could not find the nested Datalastic status template literal");
source = source.replace(before, after);
writeFileSync(path, source);
console.log("Fixed live AIS failover installer syntax.");
