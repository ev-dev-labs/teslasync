#!/usr/bin/env python3
"""
Fix temperature unit display across Grafana dashboards.

After Phase-42 SI canonicalisation, signal_log stores Celsius, but several
dashboards display raw temperatures with hardcoded "°C" labels and
field_config unit:"celsius" — ignoring the user's settings.unit_of_temp
preference. This script:

  1. Adds a hidden `unit_temp` template variable to each affected dashboard
     (resolves the user's setting on dashboard load).
  2. Wraps temperature-signal value reads with `convert_temp(...)` so the
     math respects the user's preferred unit.
  3. Replaces hardcoded "°C"/"°F" SQL aliases with "(${unit_temp})" so
     the column header reflects the user's selection.
  4. Replaces `"unit": "celsius"` / `"fahrenheit"` field-config overrides
     with `"unit": "none"` (Grafana can't do dynamic unit suffixes; the
     suffix moves to the SQL alias which can interpolate variables).
  5. Fixes byName transformation overrides that reference dead "(°C)"
     suffixes that don't match the SQL alias.

Bonus: also fixes "Est. Battery Range" in battery-health.json which has
no convert_distance_m wrapper at all (returns raw meters).

Idempotent — re-running detects already-fixed panels and skips them.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DASH = REPO / "grafana" / "dashboards" / "system"

UNIT_TEMP_VAR = {
    "name": "unit_temp",
    "type": "query",
    "label": "",
    "datasource": {
        "type": "grafana-postgresql-datasource",
        "uid": "DS_TESLASYNC_POSTGRESQL",
    },
    "query": "SELECT COALESCE((SELECT value_text FROM settings WHERE key = 'unit_of_temp'), 'C')",
    "hide": 2,
    "refresh": 1,
    "multi": False,
    "includeAll": False,
    "current": {"text": "C", "value": "C", "selected": False},
    "options": [],
    "regex": "",
    "skipUrlSync": True,
    "sort": 0,
}

# Per-file SQL replacements: (old_sql, new_sql) tuples keyed by panel title.
# old_sql is the EXACT current SQL string (verified by inspection).
# Idempotency check: if new_sql already substring-present, skip.

PATCHES: dict[str, dict[str, dict]] = {
    "battery-health.json": {
        "Max Module Temp": {
            "sql_old": (
                "SELECT COALESCE(float_value, int_value::float8) AS \"\u00b0C\" "
                "FROM signal_log WHERE vehicle_id = ${vehicle_id} AND field = 'ModuleTempMax' "
                "AND COALESCE(float_value, int_value::float8) IS NOT NULL "
                "AND ts BETWEEN $__timeFrom() AND $__timeTo() ORDER BY ts DESC LIMIT 1"
            ),
            "sql_new": (
                "SELECT convert_temp(COALESCE(float_value, int_value::float8)) AS \"(${unit_temp})\" "
                "FROM signal_log WHERE vehicle_id = ${vehicle_id} AND field = 'ModuleTempMax' "
                "AND COALESCE(float_value, int_value::float8) IS NOT NULL "
                "AND ts BETWEEN $__timeFrom() AND $__timeTo() ORDER BY ts DESC LIMIT 1"
            ),
            "unit_old": "celsius",
            "unit_new": "none",
        },
        "Module Temperature Range": {
            "sql_old": None,  # multi-line; check by alias presence
            "sql_match": "ModuleTempMax",
            "sql_new": (
                "SELECT\n"
                "  $__timeGroup(ts, '1h') AS time,\n"
                "  convert_temp(MAX(COALESCE(float_value, int_value::float8)) FILTER (WHERE field = 'ModuleTempMax')) AS \"Max Module (${unit_temp})\",\n"
                "  convert_temp(MAX(COALESCE(float_value, int_value::float8)) FILTER (WHERE field = 'ModuleTempMin')) AS \"Min Module (${unit_temp})\",\n"
                "  convert_temp(MAX(COALESCE(float_value, int_value::float8)) FILTER (WHERE field = 'ModuleTempMax'))\n"
                "    - convert_temp(MAX(COALESCE(float_value, int_value::float8)) FILTER (WHERE field = 'ModuleTempMin')) AS \"Delta (${unit_temp})\"\n"
                "FROM signal_log\n"
                "WHERE vehicle_id = ${vehicle_id}\n"
                "  AND ts BETWEEN $__timeFrom() AND $__timeTo()\n"
                "  AND field IN ('ModuleTempMax', 'ModuleTempMin')\n"
                "GROUP BY 1\n"
                "ORDER BY 1"
            ),
        },
        "Est. Battery Range": {
            "sql_old": (
                "SELECT COALESCE(float_value, int_value::float8) AS \"Range (${unit_length})\" "
                "FROM signal_log WHERE vehicle_id = ${vehicle_id} AND field = 'EstBatteryRange' "
                "AND COALESCE(float_value, int_value::float8) IS NOT NULL "
                "AND ts BETWEEN $__timeFrom() AND $__timeTo() ORDER BY ts DESC LIMIT 1"
            ),
            "sql_new": (
                "SELECT convert_distance_m(COALESCE(float_value, int_value::float8)) AS \"Range (${unit_length})\" "
                "FROM signal_log WHERE vehicle_id = ${vehicle_id} AND field = 'EstBatteryRange' "
                "AND COALESCE(float_value, int_value::float8) IS NOT NULL "
                "AND ts BETWEEN $__timeFrom() AND $__timeTo() ORDER BY ts DESC LIMIT 1"
            ),
        },
    },
    "battery-cells.json": {
        "Module Temperature Range Over Time": {
            "sql_old": None,
            "sql_match": "Max Module (\u00b0C)",
            "sql_new": (
                "SELECT\n"
                "  $__timeGroup(ts, $__interval) AS time,\n"
                "  convert_temp(MAX(COALESCE(float_value, int_value::float8)) FILTER (WHERE field = 'ModuleTempMax')) AS \"Max Module (${unit_temp})\",\n"
                "  convert_temp(MIN(COALESCE(float_value, int_value::float8)) FILTER (WHERE field = 'ModuleTempMin')) AS \"Min Module (${unit_temp})\"\n"
                "FROM signal_log\n"
                "WHERE vehicle_id = ${vehicle_id}\n"
                "  AND field IN ('ModuleTempMin','ModuleTempMax')\n"
                "  AND COALESCE(float_value, int_value::float8) IS NOT NULL\n"
                "  AND ts BETWEEN $__timeFrom() AND $__timeTo()\n"
                "GROUP BY 1\n"
                "ORDER BY 1;"
            ),
        },
        "Pack & Brick Snapshot": {
            "sql_old": None,
            "sql_match": "WITH latest AS",
            # Restructure: convert_temp() only for ModuleTemp* rows; add Unit column.
            "sql_new": (
                "WITH latest AS (\n"
                "  SELECT DISTINCT ON (field) field,\n"
                "    COALESCE(float_value, int_value::float8) AS val,\n"
                "    ts\n"
                "  FROM signal_log\n"
                "  WHERE vehicle_id = ${vehicle_id}\n"
                "    AND field IN ('PackVoltage','PackCurrent',\n"
                "                  'BrickVoltageMin','BrickVoltageMax',\n"
                "                  'NumBrickVoltageMin','NumBrickVoltageMax',\n"
                "                  'ModuleTempMin','ModuleTempMax',\n"
                "                  'NumModuleTempMin','NumModuleTempMax',\n"
                "                  'IsolationResistance')\n"
                "    AND COALESCE(float_value, int_value::float8) IS NOT NULL\n"
                "    AND ts BETWEEN $__timeFrom() AND $__timeTo()\n"
                "  ORDER BY field, ts DESC\n"
                ")\n"
                "SELECT\n"
                "  field AS \"Metric\",\n"
                "  ROUND(\n"
                "    CASE\n"
                "      WHEN field LIKE 'ModuleTemp%' THEN convert_temp(val)\n"
                "      ELSE val\n"
                "    END::numeric, 4\n"
                "  ) AS \"Value\",\n"
                "  CASE\n"
                "    WHEN field LIKE 'ModuleTemp%' THEN '${unit_temp}'\n"
                "    WHEN field LIKE 'NumModule%' THEN '#'\n"
                "    WHEN field LIKE 'NumBrick%' THEN '#'\n"
                "    WHEN field LIKE '%Voltage%' THEN 'V'\n"
                "    WHEN field = 'PackCurrent' THEN 'A'\n"
                "    WHEN field = 'IsolationResistance' THEN '\u03a9'\n"
                "    ELSE ''\n"
                "  END AS \"Unit\",\n"
                "  ts AS \"Last Updated\"\n"
                "FROM latest\n"
                "ORDER BY field;"
            ),
        },
    },
    "charging-curve.json": {
        "\U0001f321\ufe0f Temperature During Charge": {
            "sql_old": None,
            "sql_match": "ModuleTempMax",
            "sql_new": (
                "SELECT\n"
                "  time_bucket('1 minute', sl.ts) AS time,\n"
                "  convert_temp(MAX(CASE WHEN sl.field = 'ModuleTempMax' THEN COALESCE(sl.float_value, sl.int_value::float8) END)) AS \"Battery Temp (${unit_temp})\",\n"
                "  convert_temp(MAX(CASE WHEN sl.field = 'OutsideTemp' THEN COALESCE(sl.float_value, sl.int_value::float8) END)) AS \"Outside Temp (${unit_temp})\"\n"
                "FROM signal_log sl\n"
                "JOIN charging_sessions cs ON cs.id = ${session_id}\n"
                "WHERE sl.vehicle_id = cs.vehicle_id\n"
                "  AND sl.field IN ('ModuleTempMax', 'OutsideTemp')\n"
                "  AND sl.ts BETWEEN cs.started_at AND COALESCE(cs.ended_at, NOW())\n"
                "GROUP BY time_bucket('1 minute', sl.ts)\n"
                "ORDER BY 1"
            ),
            "unit_old": "celsius",
            "unit_new": "none",
        },
    },
    "climate-hvac.json": {
        # No SQL change — convert_temp already wired. But add unit_temp var
        # AND fix dead transformation byName overrides that reference "(°C)"
        # when the SQL aliases are bare "Cabin Temp"/"Outside Temp".
        "Cabin & Outside Temperature": {
            "transform_overrides": [
                {"old": "Cabin Temp (\u00b0C)", "new": "Cabin Temp"},
                {"old": "Outside Temp (\u00b0C)", "new": "Outside Temp"},
            ],
        },
    },
}


def add_unit_temp_var(dash: dict) -> bool:
    """Add unit_temp template variable if missing. Return True if added."""
    templating = dash.setdefault("templating", {}).setdefault("list", [])
    for v in templating:
        if v.get("name") == "unit_temp":
            return False
    templating.append(json.loads(json.dumps(UNIT_TEMP_VAR)))
    return True


def patch_panel(panel: dict, patch: dict) -> tuple[bool, list[str]]:
    """Apply patch to a single panel. Return (changed, log)."""
    log = []
    changed = False

    # SQL replacement
    if "sql_new" in patch:
        new_sql = patch["sql_new"]
        for tgt in panel.get("targets", []):
            sql = tgt.get("rawSql", "")
            if not sql:
                continue
            if sql == new_sql or sql.strip() == new_sql.strip():
                log.append("  sql already up-to-date (idempotent skip)")
                continue
            old = patch.get("sql_old")
            match = patch.get("sql_match")
            if old is not None and sql == old:
                tgt["rawSql"] = new_sql
                changed = True
                log.append("  sql replaced (exact match)")
            elif match is not None and match in sql and "convert_temp" not in sql and "convert_distance_m" not in sql:
                tgt["rawSql"] = new_sql
                changed = True
                log.append(f"  sql replaced (matched substring '{match}')")
            elif old is None and match is None:
                log.append("  WARNING: no sql_old or sql_match provided")
            else:
                log.append(f"  sql NOT matched (old/match did not match current sql)")

    # field config unit change
    if "unit_old" in patch and "unit_new" in patch:
        defaults = panel.setdefault("fieldConfig", {}).setdefault("defaults", {})
        cur = defaults.get("unit")
        if cur == patch["unit_new"]:
            log.append("  unit already up-to-date")
        elif cur == patch["unit_old"]:
            defaults["unit"] = patch["unit_new"]
            changed = True
            log.append(f"  unit: {patch['unit_old']} -> {patch['unit_new']}")
        else:
            log.append(f"  unit not matched (current='{cur}')")

    # transformation byName overrides
    if "transform_overrides" in patch:
        overrides = panel.get("fieldConfig", {}).get("overrides", [])
        for ov in overrides:
            matcher = ov.get("matcher", {})
            if matcher.get("id") != "byName":
                continue
            cur = matcher.get("options")
            for to in patch["transform_overrides"]:
                if cur == to["old"]:
                    matcher["options"] = to["new"]
                    changed = True
                    log.append(f"  byName override: '{to['old']}' -> '{to['new']}'")
                elif cur == to["new"]:
                    log.append(f"  byName override already '{to['new']}'")

    return changed, log


def main() -> int:
    total_files_changed = 0
    total_panels_changed = 0
    total_vars_added = 0

    for filename, panel_patches in PATCHES.items():
        path = DASH / filename
        if not path.exists():
            print(f"SKIP {filename}: file not found")
            continue

        text = path.read_text(encoding="utf-8")
        dash = json.loads(text)

        file_changed = False
        print(f"=== {filename} ===")

        if add_unit_temp_var(dash):
            print("  + added unit_temp template variable")
            total_vars_added += 1
            file_changed = True
        else:
            print("  unit_temp template variable already present")

        panels = dash.get("panels", [])
        for title, patch in panel_patches.items():
            matching = [p for p in panels if p.get("title") == title]
            if not matching:
                print(f"  WARNING: no panel '{title}' found")
                continue
            for panel in matching:
                print(f"  panel '{title}':")
                changed, log = patch_panel(panel, patch)
                for line in log:
                    print(line)
                if changed:
                    total_panels_changed += 1
                    file_changed = True

        if file_changed:
            new_text = json.dumps(dash, indent=2, ensure_ascii=False) + "\n"
            path.write_text(new_text, encoding="utf-8")
            total_files_changed += 1
            print(f"  -> wrote {filename}")
        else:
            print(f"  (no changes)")
        print()

    print(f"Summary: {total_files_changed} files changed, "
          f"{total_panels_changed} panels patched, "
          f"{total_vars_added} unit_temp vars added")
    return 0


if __name__ == "__main__":
    sys.exit(main())
