"""Surgically add/repair prev/next nav links on Grafana infra dashboards.

The infra/ ring previously linked only 6 of 16 dashboards; the other 10
had no `links` field at all. This script either:

  - replaces an existing `links` block with a freshly-threaded version
    (preserving the rest of the file byte-for-byte), OR
  - inserts a new `links` block as the final top-level key for files
    that have no `links` field yet.

It does NOT reformat any other JSON in the file (so nested gridPos /
fieldConfig blocks that were stored compact stay compact in the diff).
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).parent.parent / "grafana" / "dashboards" / "infra"

files = sorted(ROOT.glob("*.json"))

# Read uid + title from each file via json (just to derive the ring).
entries = []
for f in files:
    j = json.loads(f.read_text(encoding="utf-8"))
    entries.append({"file": f, "uid": j["uid"], "title": j["title"]})

print(f"Re-threading ring of {len(entries)} infra dashboards (alphabetical):")
for i, e in enumerate(entries):
    print(f"  {i+1:2d}. {e['file'].name:40s} -> /d/{e['uid']}")


def render_links_block(prev, nxt, base_indent="  "):
    """Render the 3-link block exactly matching existing dashboards' style.

    base_indent is the indent of the `links` key itself (2 spaces for top-level).
    """
    inner = base_indent + "  "  # indent of the array item objects
    field = inner + "  "  # indent of fields inside each object
    array_close = base_indent
    return (
        f'{base_indent}"links": [\n'
        f'{inner}{{\n'
        f'{field}"asDropdown": false,\n'
        f'{field}"icon": "bolt",\n'
        f'{field}"includeVars": true,\n'
        f'{field}"keepTime": true,\n'
        f'{field}"tags": [],\n'
        f'{field}"targetBlank": false,\n'
        f'{field}"title": "\u25c0 Prev",\n'
        f'{field}"tooltip": {json.dumps(prev["title"], ensure_ascii=False)},\n'
        f'{field}"type": "link",\n'
        f'{field}"url": "/d/{prev["uid"]}"\n'
        f'{inner}}},\n'
        f'{inner}{{\n'
        f'{field}"asDropdown": true,\n'
        f'{field}"icon": "external link",\n'
        f'{field}"includeVars": true,\n'
        f'{field}"keepTime": true,\n'
        f'{field}"tags": [\n'
        f'{field}  "teslasync"\n'
        f'{field}],\n'
        f'{field}"targetBlank": false,\n'
        f'{field}"title": "\u26a1 TeslaSync",\n'
        f'{field}"type": "dashboards"\n'
        f'{inner}}},\n'
        f'{inner}{{\n'
        f'{field}"asDropdown": false,\n'
        f'{field}"icon": "bolt",\n'
        f'{field}"includeVars": true,\n'
        f'{field}"keepTime": true,\n'
        f'{field}"tags": [],\n'
        f'{field}"targetBlank": false,\n'
        f'{field}"title": "Next \u25b6",\n'
        f'{field}"tooltip": {json.dumps(nxt["title"], ensure_ascii=False)},\n'
        f'{field}"type": "link",\n'
        f'{field}"url": "/d/{nxt["uid"]}"\n'
        f'{inner}}}\n'
        f'{array_close}]'
    )


# Locate an existing top-level `links` array using a JSON-aware scan
# (regex doesn't reliably handle nested arrays inside the link objects,
# e.g. `"tags": []`).
def find_links_span(text: str):
    """Return (start, end) byte span of `  "links": [...]` at top level, or None.

    `start` is the index of the leading two-space indent + `"links":`.
    `end` is the index just past the closing `]` of the array.
    Only matches `links` declared at the top level (column 0 indent of its key
    is exactly 2 spaces, matching all other top-level keys in the file).
    """
    needle = '\n  "links":'
    idx = text.find(needle)
    if idx == -1:
        return None
    # Position of `"` of "links" key, after the leading newline + 2 spaces.
    key_start = idx + 1  # exclude the leading newline
    # Find the `[` that opens the array (skip whitespace after the colon).
    bracket = text.find('[', text.find(':', key_start))
    if bracket == -1:
        return None
    # Walk forward, tracking depth, while respecting JSON strings.
    depth = 0
    in_string = False
    escape = False
    i = bracket
    while i < len(text):
        c = text[i]
        if in_string:
            if escape:
                escape = False
            elif c == '\\':
                escape = True
            elif c == '"':
                in_string = False
        else:
            if c == '"':
                in_string = True
            elif c == '[':
                depth += 1
            elif c == ']':
                depth -= 1
                if depth == 0:
                    return (key_start, i + 1)
        i += 1
    return None


n = len(entries)
for i, e in enumerate(entries):
    prev = entries[(i - 1) % n]
    nxt = entries[(i + 1) % n]
    text = e["file"].read_text(encoding="utf-8")

    # Detect line ending so we preserve it on write.
    eol = "\r\n" if "\r\n" in text else "\n"
    # Normalize internally for predictability.
    norm = text.replace("\r\n", "\n")

    new_block = render_links_block(prev, nxt)

    span = find_links_span(norm)
    if span is not None:
        # Replace existing links block (preserve everything else byte-for-byte).
        start, end = span
        new_norm = norm[:start] + new_block + norm[end:]
        action = "replaced"
    else:
        # Insert as the last top-level key, before the closing `}`.
        # Find the final closing brace at column 0 (top-level object close).
        # The existing convention is that the previous key (e.g. "annotations")
        # ends with `}\n}` — we insert a comma after the previous closing `}`
        # and add our new `links` block before the final `}`.
        if not norm.rstrip().endswith("}"):
            raise RuntimeError(f"{e['file'].name} does not end with closing brace")
        # Strip the trailing newlines so we can append cleanly.
        stripped = norm.rstrip("\n")
        # Find last index of the top-level closing `}`.
        if not stripped.endswith("}"):
            raise RuntimeError(f"{e['file'].name} unexpected end")
        # The last `}` is at -1; the second-to-last non-whitespace char before
        # it must be the previous value's closing `}` or `]`. We need to add a
        # `,` after that previous closing.
        body = stripped[:-1].rstrip()
        if not (body.endswith("}") or body.endswith("]") or body.endswith('"') or body[-1].isdigit() or body.endswith("false") or body.endswith("true") or body.endswith("null")):
            raise RuntimeError(f"{e['file'].name}: unexpected last value char {body[-1]!r}")
        new_norm = body + ",\n" + new_block + "\n}"
        action = "inserted"

    # Restore original EOL convention.
    out = new_norm.replace("\n", eol)
    if not out.endswith(eol):
        out += eol
    e["file"].write_text(out, encoding="utf-8", newline="")

    print(f"  {action:>9s}: {e['file'].name}")

print("\nDone.")
