#!/usr/bin/env python3
"""Revive the 3 stub "(Unavailable)" panels in battery-cells.json.

Tesla Fleet Telemetry doesn't expose per-cell voltages or per-cell
temperatures (the dashboard creator was correct), but it DOES expose
a useful set of pack/brick/module signals that have been collecting
data in signal_log all along:

  - BrickVoltageMin / BrickVoltageMax        (weakest/strongest brick)
  - NumBrickVoltageMin / NumBrickVoltageMax  (which brick #)
  - ModuleTempMin / ModuleTempMax            (coolest/warmest module)
  - PackVoltage / PackCurrent                (pack-level)
  - IsolationResistance                      (battery isolation)

Repurpose the 3 stubs to use these:
  Cell Voltage Distribution  -> Brick Voltage Spread Over Time
  Cell Temperature Heatmap   -> Module Temperature Range Over Time
  Cell Readings              -> Pack & Brick Snapshot

Bonus: the Cell Voltage Distribution panel is currently a barchart with
a JS TypeError; switching to timeseries fixes that crash.

Idempotent: skips panels already revived.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

DASHBOARD = Path(__file__).resolve().parent.parent / "grafana" / "dashboards" / "system" / "battery-cells.json"
STUB_MARKER = "Panel disabled: per-cell"


def brick_voltage_spread_sql() -> str:
    return (
        "SELECT\n"
        "  $__timeGroup(ts, $__interval) AS time,\n"
        "  MAX(COALESCE(float_value, int_value::float8)) FILTER (WHERE field = 'BrickVoltageMax') AS \"Max Brick (V)\",\n"
        "  MIN(COALESCE(float_value, int_value::float8)) FILTER (WHERE field = 'BrickVoltageMin') AS \"Min Brick (V)\"\n"
        "FROM signal_log\n"
        "WHERE vehicle_id = ${vehicle_id}\n"
        "  AND field IN ('BrickVoltageMin','BrickVoltageMax')\n"
        "  AND COALESCE(float_value, int_value::float8) IS NOT NULL\n"
        "  AND ts BETWEEN $__timeFrom() AND $__timeTo()\n"
        "GROUP BY 1\n"
        "ORDER BY 1;"
    )


def module_temp_range_sql() -> str:
    return (
        "SELECT\n"
        "  $__timeGroup(ts, $__interval) AS time,\n"
        "  MAX(COALESCE(float_value, int_value::float8)) FILTER (WHERE field = 'ModuleTempMax') AS \"Max Module (°C)\",\n"
        "  MIN(COALESCE(float_value, int_value::float8)) FILTER (WHERE field = 'ModuleTempMin') AS \"Min Module (°C)\"\n"
        "FROM signal_log\n"
        "WHERE vehicle_id = ${vehicle_id}\n"
        "  AND field IN ('ModuleTempMin','ModuleTempMax')\n"
        "  AND COALESCE(float_value, int_value::float8) IS NOT NULL\n"
        "  AND ts BETWEEN $__timeFrom() AND $__timeTo()\n"
        "GROUP BY 1\n"
        "ORDER BY 1;"
    )


def pack_brick_snapshot_sql() -> str:
    # Latest reading for each pack/brick metric.
    return (
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
        "  ROUND(val::numeric, 4) AS \"Value\",\n"
        "  ts AS \"Last Updated\"\n"
        "FROM latest\n"
        "ORDER BY field;"
    )


# title -> (new_sql, new_type, new_title)
PANEL_FIXES: dict[str, tuple[str, str | None, str | None]] = {
    "Cell Voltage Distribution (Unavailable)": (
        brick_voltage_spread_sql(), "timeseries", "Brick Voltage Spread Over Time",
    ),
    "Cell Temperature Heatmap (Unavailable)": (
        module_temp_range_sql(), "timeseries", "Module Temperature Range Over Time",
    ),
    "Cell Readings (Unavailable)": (
        pack_brick_snapshot_sql(), "table", "Pack & Brick Snapshot",
    ),
    # Post-rename names for re-run idempotency
    "Brick Voltage Spread Over Time":   (brick_voltage_spread_sql(), "timeseries", None),
    "Module Temperature Range Over Time": (module_temp_range_sql(),  "timeseries", None),
    "Pack & Brick Snapshot":            (pack_brick_snapshot_sql(), "table",      None),
}


def _is_stub(sql: str) -> bool:
    return STUB_MARKER in sql


def main() -> int:
    raw = DASHBOARD.read_text(encoding="utf-8")
    dash = json.loads(raw)

    fixed: list[str] = []
    skipped: list[str] = []

    for panel in dash.get("panels", []):
        title = panel.get("title")
        if title not in PANEL_FIXES:
            continue
        new_sql, new_type, new_title = PANEL_FIXES[title]
        targets = panel.get("targets") or []
        if not targets:
            skipped.append(f"{title} (no targets)")
            continue
        target = targets[0]
        old_sql = target.get("rawSql", "")
        if old_sql.strip() == new_sql.strip() and (new_type is None or panel.get("type") == new_type):
            skipped.append(f"{title} (already revived)")
            continue
        target["rawSql"] = new_sql
        target["format"] = "table" if new_type == "table" else "time_series"
        if new_type:
            panel["type"] = new_type
        if new_title:
            panel["title"] = new_title
        fixed.append(title if not new_title else f"{title} -> {new_title}")

    if not fixed:
        print(f"No changes — all {len(skipped)} panels already revived")
        for s in skipped:
            print(f"  - {s}")
        return 0

    DASHBOARD.write_text(json.dumps(dash, indent=2) + "\n", encoding="utf-8")
    json.loads(DASHBOARD.read_text(encoding="utf-8"))  # validate

    print(f"Revived {len(fixed)} panel(s):")
    for t in fixed:
        print(f"  ✓ {t}")
    if skipped:
        print(f"Skipped {len(skipped)}:")
        for s in skipped:
            print(f"  - {s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
