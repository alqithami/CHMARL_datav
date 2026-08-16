from pathlib import Path

path = Path("scripts/check-runtime-contract.mjs")
source = path.read_text(encoding="utf-8")
replacements = {
    "assertIncludes(runtime, 'return \"datalastic\"', \"Datalastic live AIS source is not exposed\");":
        "assertIncludes(runtime, '...(Number(vesselInputState.datalasticRows ?? 0) > 0 ? [\"datalastic\"] : [])', \"Datalastic live AIS source is not represented in provider selection\");",
    "assertIncludes(runtime, 'return \"pocketworld\"', \"public AIS source is not exposed\");":
        "assertIncludes(runtime, '...(Number(vesselInputState.pocketworldRows ?? 0) > 0 ? [\"pocketworld\"] : [])', \"public AIS source is not represented in provider selection\");",
}
for before, after in replacements.items():
    if before not in source:
        raise RuntimeError(f"Could not find generated contract assertion: {before}")
    source = source.replace(before, after, 1)
path.write_text(source, encoding="utf-8")
Path(__file__).unlink()
print("Corrected generated multi-provider AIS contract checks.")
