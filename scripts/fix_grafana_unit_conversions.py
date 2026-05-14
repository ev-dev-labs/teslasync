#!/usr/bin/env python3
"""
Cleanly fix Grafana dashboard unit handling. Single source of truth = settings
table (managed by web app's GeneralSettings.tsx).

Operations:
  1. Camp B fix: every convert_pressure / convert_distance / convert_speed call
     whose first argument is a raw signal_log value (float_value/int_value/
     known signal name) is renamed to the SI-aware variant
     (convert_pressure_pa / _distance_m / _speed_mps). The 2nd argument (if
     any) is REMOVED so the function falls back to settings.
  2. Strip any 2nd argument from all convert_* calls (including Camp A) so
     every dashboard reads from the single source of truth.
  3. Remove the now-dead unit_length / unit_temp / unit_pressure template
     variables from every dashboard's templating.list.

Validates each touched dashboard re-parses as JSON. Prints a per-file summary.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

DASHBOARDS = Path("grafana/dashboards/system")
DEAD_TEMPLATE_VARS = {"unit_length", "unit_temp", "unit_pressure"}

CAMP_B_PATTERNS = [
    re.compile(r"\bfloat_value\b"),
    re.compile(r"\bint_value::float8\b"),
    re.compile(r"'(VehicleSpeed|Odometer|TpmsPressure[A-Za-z]+|RatedRange|EstBatteryRange|IdealBatteryRange)'"),
]

CAMP_B_FUNC_RENAME = {
    "pressure": "pressure_pa",
    "distance": "distance_m",
    "speed":    "speed_mps",
}

CALL_RE = re.compile(
    r"\bconvert_(distance|speed|pressure|temp|efficiency)(_pa|_m|_mps)?\("
)


def split_call(s: str, paren_open: int):
    """Return (after_close_idx, args_str, arg1_str)."""
    assert s[paren_open] == "("
    depth = 1
    i = paren_open + 1
    arg1_end = -1
    in_string = False
    while i < len(s) and depth > 0:
        ch = s[i]
        if ch == "'" and (i == 0 or s[i - 1] != "\\"):
            in_string = not in_string
        elif not in_string:
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    break
            elif ch == "," and depth == 1 and arg1_end == -1:
                arg1_end = i
        i += 1
    if depth != 0:
        raise ValueError(f"unbalanced parens at {paren_open}")
    args_str = s[paren_open + 1 : i]
    arg1 = args_str if arg1_end == -1 else s[paren_open + 1 : arg1_end]
    return i + 1, args_str, arg1


def transform_sql(content: str):
    counts = {"camp_b_renamed": 0, "stripped_2nd_arg": 0, "untouched": 0}
    out = []
    last_end = 0
    for m in CALL_RE.finditer(content):
        func = m.group(1)
        suffix = m.group(2) or ""
        paren_open = m.end() - 1
        try:
            after, args_str, arg1 = split_call(content, paren_open)
        except ValueError:
            continue

        is_camp_b = any(p.search(arg1) for p in CAMP_B_PATTERNS)
        has_2nd_arg = len(args_str) != len(arg1)
        new_func = f"convert_{func}{suffix}"
        new_arg = arg1.rstrip()
        changed = False

        if is_camp_b and func in CAMP_B_FUNC_RENAME and not suffix:
            new_func = f"convert_{CAMP_B_FUNC_RENAME[func]}"
            counts["camp_b_renamed"] += 1
            changed = True

        if has_2nd_arg:
            counts["stripped_2nd_arg"] += 1
            changed = True

        if not changed:
            counts["untouched"] += 1

        out.append(content[last_end : m.start()])
        out.append(f"{new_func}({new_arg})")
        last_end = after

    out.append(content[last_end:])
    return "".join(out), counts


def strip_dead_template_vars(dashboard: dict) -> int:
    templating = dashboard.get("templating")
    if not isinstance(templating, dict):
        return 0
    var_list = templating.get("list")
    if not isinstance(var_list, list):
        return 0
    before = len(var_list)
    templating["list"] = [v for v in var_list if v.get("name") not in DEAD_TEMPLATE_VARS]
    return before - len(templating["list"])


def main() -> int:
    if not DASHBOARDS.is_dir():
        print(f"FATAL: {DASHBOARDS} not found (run from repo root)", file=sys.stderr)
        return 2

    grand = {"files_changed": 0, "camp_b_renamed": 0, "stripped_2nd_arg": 0, "vars_removed": 0}
    for path in sorted(DASHBOARDS.glob("*.json")):
        original = path.read_text(encoding="utf-8")
        # Step 1+2: SQL transform on the raw text (rawSql lives in JSON strings)
        new_text, counts = transform_sql(original)

        # Step 3: parse JSON to strip dead template vars
        try:
            dashboard = json.loads(new_text)
        except json.JSONDecodeError as e:
            print(f"  SKIPPED {path.name}: SQL transform produced invalid JSON ({e})")
            continue
        vars_removed = strip_dead_template_vars(dashboard)
        final_text = json.dumps(dashboard, indent=2, ensure_ascii=False) + "\n"

        if final_text == original:
            continue

        # Validate one more time
        try:
            json.loads(final_text)
        except json.JSONDecodeError as e:
            print(f"  SKIPPED {path.name}: final JSON invalid ({e})")
            continue

        path.write_text(final_text, encoding="utf-8")
        grand["files_changed"] += 1
        grand["camp_b_renamed"] += counts["camp_b_renamed"]
        grand["stripped_2nd_arg"] += counts["stripped_2nd_arg"]
        grand["vars_removed"] += vars_removed
        if counts["camp_b_renamed"] or counts["stripped_2nd_arg"] or vars_removed:
            print(
                f"  {path.name}: camp_b={counts['camp_b_renamed']} "
                f"stripped_2nd={counts['stripped_2nd_arg']} vars_removed={vars_removed}"
            )

    print()
    print(f"TOTAL files_changed={grand['files_changed']}")
    print(f"      camp_b_renamed={grand['camp_b_renamed']}")
    print(f"      stripped_2nd_arg={grand['stripped_2nd_arg']}")
    print(f"      template_vars_removed={grand['vars_removed']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
