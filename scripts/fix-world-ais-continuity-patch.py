from pathlib import Path

path = Path("scripts/apply-world-ais-continuity-fix.py")
text = path.read_text()

old_first = '''    content = replace_once(
        content,
        '    || source === "pocketworld"\\n    || source === "ais-multi-provider"',
        '    || source === "pocketworld"\\n    || source === "pocketworld-last-known"\\n    || source === "ais-multi-provider"',
        "last-known external source",
    )
'''
new_first = '''    before = '    || source === "pocketworld"\\n    || source === "ais-multi-provider"'
    after = '    || source === "pocketworld"\\n    || source === "pocketworld-last-known"\\n    || source === "ais-multi-provider"'
    count = content.count(before)
    if count != 2:
        raise RuntimeError(f"Expected two dashboard source lists, found {count}")
    content = content.replace(before, after)
'''

old_second = '''    content = replace_once(
        content,
        '    || source === "pocketworld"\\n    || source === "ais-multi-provider"\\n    || source === "aisstream-waiting") return 5_000;',
        '    || source === "pocketworld"\\n'
        '    || source === "pocketworld-last-known"\\n'
        '    || source === "ais-multi-provider"\\n'
        '    || source === "aisstream-waiting") return 5_000;',
        "last-known refresh interval",
    )
'''

if text.count(old_first) != 1:
    raise RuntimeError("Could not find repeated dashboard source patch")
if text.count(old_second) != 1:
    raise RuntimeError("Could not find redundant dashboard refresh patch")

text = text.replace(old_first, new_first, 1).replace(old_second, "", 1)
path.write_text(text)
print("Fixed repeated DashboardShell source patch.")
