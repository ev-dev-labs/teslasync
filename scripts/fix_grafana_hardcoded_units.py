#!/usr/bin/env python3
"""De-hardcode distance unit labels across Grafana dashboards.

Several dashboards have "(km)" or "(mi)" baked into:
  - panel titles                       e.g. "Distance (km)"
  - timeseries / barchart axis labels  e.g. "Distance (km)"
  - SQL column aliases                 e.g. AS "Distance (km)"
  - field-config unit overrides        e.g. "unit": "lengthkm"
  - byName transformation refs         e.g. "options": "Distance (km)"

These lie when the user's setting (settings.unit_of_length) is the other
unit. The SI-aware convert_distance(_m) functions already return the value
in the user's preferred unit, but the LABELS were never wired up.

Fix: add a hidden Grafana template variable `unit_length` that queries
the settings table. Replace every hardcoded "(km)" / "(mi)" with
"(${unit_length})". Replace "lengthkm"/"lengthmi" field unit with "none"
(Grafana's static unit suffix can't be dynamic; the column header is the
new place for the unit).

Idempotent: skips dashboards already containing ${unit_length}.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DASH_DIR = REPO_ROOT / "grafana" / "dashboards"

# Files known to have hardcoded distance unit labels (scoped intentionally
# to known-broken set; route-efficiency is excluded — separate broken
# queries make a label-only fix misleading).
TARGET_FILES = [
    "system/battery-health.json",
    "system/charging-driving-correlation.json",
    "system/compare.json",
    "system/home.json",
    "system/regen-efficiency.json",
    "system/weekly-digest.json",
]


UNIT_LENGTH_VAR = {
    "current": {"selected": False, "text": "mi", "value": "mi"},
    "datasource": {
        "type": "grafana-postgresql-datasource",
        "uid": "DS_TESLASYNC_POSTGRESQL",
    },
    # Pull from the settings table so the dashboard reflects whatever the
    # user set in GeneralSettings (or via PUT /api/v1/settings).
    "definition": "SELECT COALESCE((SELECT value_text FROM settings WHERE key = 'unit_of_length'), 'mi')",
    "query": "SELECT COALESCE((SELECT value_text FROM settings WHERE key = 'unit_of_length'), 'mi')",
    "hide": 2,            # 2 = hide both label and dropdown
    "includeAll": False,
    "label": "",
    "multi": False,
    "name": "unit_length",
    "options": [],
    "refresh": 1,         # refresh on dashboard load
    "regex": "",
    "skipUrlSync": True,
    "sort": 0,
    "type": "query",
}


# Regex tailored to length-unit text only (km|mi inside parens).
# Must NOT match (kWh) or other parenthetical units.
LENGTH_PAREN_RE = re.compile(r"\((km|mi)\)")


def _ensure_var(dash: dict) -> bool:
    """Add the unit_length template variable if missing. Returns True if added."""
    tmpl = dash.setdefault("templating", {})
    var_list = tmpl.setdefault("list", [])
    for v in var_list:
        if v.get("name") == "unit_length":
            return False
    var_list.append(UNIT_LENGTH_VAR.copy())
    return True


def _walk_strings(node, replacer):
    """Walk a JSON tree, calling replacer(parent, key, value) on every string leaf.
    Replacer returns the new value (or the original if no change)."""
    if isinstance(node, dict):
        for k in list(node.keys()):
            v = node[k]
            if isinstance(v, str):
                new = replacer(node, k, v)
                if new != v:
                    node[k] = new
            else:
                _walk_strings(v, replacer)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            if isinstance(v, str):
                new = replacer(node, i, v)
                if new != v:
                    node[i] = new
            else:
                _walk_strings(v, replacer)


def _replace_length_paren(parent, key, value: str) -> str:
    """Replace '(km)' or '(mi)' with '(${unit_length})' anywhere in the string."""
    return LENGTH_PAREN_RE.sub("(${unit_length})", value)


def _replace_lengthkm_unit(parent, key, value: str) -> str:
    """Replace lengthkm/lengthmi unit values with 'none' (Grafana's static
    unit suffix isn't dynamic; the column header now carries the unit).

    Only act when the surrounding key implies it's a unit setting:
      {"unit": "lengthkm"}                     <- field config defaults
      {"id": "unit", "value": "lengthkm"}      <- field overrides
    """
    if value not in ("lengthkm", "lengthmi"):
        return value
    if key == "unit":
        return "none"
    if key == "value" and isinstance(parent, dict) and parent.get("id") == "unit":
        return "none"
    return value


def fix_dashboard(path: Path) -> dict[str, int]:
    raw = path.read_text(encoding="utf-8")
    dash = json.loads(raw)

    stats = {
        "var_added": 0,
        "paren_replaced": 0,
        "unit_replaced": 0,
    }

    if _ensure_var(dash):
        stats["var_added"] = 1

    # First pass: count + replace "(km)" / "(mi)"
    paren_count = [0]

    def paren_replacer(parent, key, value):
        new = _replace_length_paren(parent, key, value)
        if new != value:
            paren_count[0] += LENGTH_PAREN_RE.findall(value).__len__()
        return new

    _walk_strings(dash, paren_replacer)
    stats["paren_replaced"] = paren_count[0]

    # Second pass: replace lengthkm/lengthmi unit settings
    unit_count = [0]

    def unit_replacer(parent, key, value):
        new = _replace_lengthkm_unit(parent, key, value)
        if new != value:
            unit_count[0] += 1
        return new

    _walk_strings(dash, unit_replacer)
    stats["unit_replaced"] = unit_count[0]

    if stats["var_added"] or stats["paren_replaced"] or stats["unit_replaced"]:
        path.write_text(json.dumps(dash, indent=2) + "\n", encoding="utf-8")
        # Validate JSON round-trip
        json.loads(path.read_text(encoding="utf-8"))

    return stats


def main() -> int:
    total = {"var_added": 0, "paren_replaced": 0, "unit_replaced": 0, "files_changed": 0}
    for rel in TARGET_FILES:
        path = DASH_DIR / rel
        if not path.is_file():
            print(f"  ! missing: {rel}", file=sys.stderr)
            continue
        s = fix_dashboard(path)
        changed = bool(s["var_added"] or s["paren_replaced"] or s["unit_replaced"])
        marker = "  ✓" if changed else "  -"
        if changed:
            total["files_changed"] += 1
        total["var_added"] += s["var_added"]
        total["paren_replaced"] += s["paren_replaced"]
        total["unit_replaced"] += s["unit_replaced"]
        print(f"{marker} {rel}: var_added={s['var_added']}, paren_replaced={s['paren_replaced']}, "
              f"unit_replaced={s['unit_replaced']}")

    print(f"\nTotals: files_changed={total['files_changed']}, "
          f"vars_added={total['var_added']}, "
          f"paren_replaced={total['paren_replaced']}, "
          f"unit_overrides_replaced={total['unit_replaced']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
