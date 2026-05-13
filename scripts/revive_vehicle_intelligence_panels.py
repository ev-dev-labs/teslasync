#!/usr/bin/env python3
"""Revive the 6 stub panels in vehicle-intelligence.json.

Pre-fix: every panel ran `SELECT NOW() AS time, NULL AS value -- Panel
disabled: table removed in migration (ADR-002)`. The underlying signals
have since landed in signal_log and are queryable. This script repoints
each panel to its real source.

Idempotent — re-running detects already-revived panels and skips them.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

DASHBOARD = Path(__file__).resolve().parent.parent / "grafana" / "dashboards" / "system" / "vehicle-intelligence.json"

STUB_MARKER = "Panel disabled: table removed in migration"


def vehicle_config_sql() -> str:
    return (
        "WITH latest AS (\n"
        "  SELECT DISTINCT ON (field) field, str_value, ts\n"
        "  FROM signal_log\n"
        "  WHERE vehicle_id = ${vehicle_id}\n"
        "    AND field IN ('VehicleName','Version','Trim','ExteriorColor','RoofColor')\n"
        "    AND str_value IS NOT NULL\n"
        "    AND ts BETWEEN $__timeFrom() AND $__timeTo()\n"
        "  ORDER BY field, ts DESC\n"
        ")\n"
        "SELECT field AS \"Setting\", str_value AS \"Value\", ts AS \"Last Updated\"\n"
        "FROM latest\n"
        "ORDER BY field;"
    )


def software_updates_sql() -> str:
    return (
        "SELECT NOW() AS time, str_value AS \"Version\"\n"
        "FROM signal_log\n"
        "WHERE vehicle_id = ${vehicle_id}\n"
        "  AND field = 'Version'\n"
        "  AND str_value IS NOT NULL\n"
        "  AND ts BETWEEN $__timeFrom() AND $__timeTo()\n"
        "ORDER BY ts DESC\n"
        "LIMIT 1;"
    )


def safety_settings_sql() -> str:
    return (
        "WITH latest AS (\n"
        "  SELECT DISTINCT ON (field) field, str_value, bool_value, int_value, ts\n"
        "  FROM signal_log\n"
        "  WHERE vehicle_id = ${vehicle_id}\n"
        "    AND field IN ('Locked','PinToDriveEnabled','ValetModeEnabled','SentryMode','SpeedLimitMode')\n"
        "    AND ts BETWEEN $__timeFrom() AND $__timeTo()\n"
        "  ORDER BY field, ts DESC\n"
        ")\n"
        "SELECT\n"
        "  field AS \"Setting\",\n"
        "  COALESCE(str_value, bool_value::text, int_value::text) AS \"Value\",\n"
        "  ts AS \"Last Updated\"\n"
        "FROM latest\n"
        "ORDER BY field;"
    )


def navigation_sql() -> str:
    return (
        "WITH latest AS (\n"
        "  SELECT DISTINCT ON (field) field, str_value, ts\n"
        "  FROM signal_log\n"
        "  WHERE vehicle_id = ${vehicle_id}\n"
        "    AND field IN ('DestinationName','RouteLastUpdated','RouteTrafficMinutesDelay')\n"
        "    AND str_value IS NOT NULL\n"
        "    AND ts BETWEEN $__timeFrom() AND $__timeTo()\n"
        "  ORDER BY field, ts DESC\n"
        ")\n"
        "SELECT field AS \"Setting\", str_value AS \"Value\", ts AS \"Last Updated\"\n"
        "FROM latest\n"
        "ORDER BY field;"
    )


def user_preferences_sql() -> str:
    return (
        "WITH latest AS (\n"
        "  SELECT DISTINCT ON (field) field, str_value, bool_value, int_value, ts\n"
        "  FROM signal_log\n"
        "  WHERE vehicle_id = ${vehicle_id}\n"
        "    AND field IN ('Setting24HourTime','Gui24HourTime','GuiDistanceUnits',\n"
        "                  'GuiTemperatureUnits','GuiChargeRateUnits','GuiRangeDisplay')\n"
        "    AND ts BETWEEN $__timeFrom() AND $__timeTo()\n"
        "  ORDER BY field, ts DESC\n"
        ")\n"
        "SELECT\n"
        "  field AS \"Setting\",\n"
        "  COALESCE(str_value, bool_value::text, int_value::text) AS \"Value\",\n"
        "  ts AS \"Last Updated\"\n"
        "FROM latest\n"
        "ORDER BY field;"
    )


def top_destinations_sql() -> str:
    return (
        "SELECT\n"
        "  end_place AS \"Destination\",\n"
        "  COUNT(*) AS \"Visits\",\n"
        "  ROUND(AVG(EXTRACT(EPOCH FROM (ended_at - started_at)) / 60.0)::numeric, 1) AS \"Avg Drive (min)\"\n"
        "FROM drives\n"
        "WHERE vehicle_id = ${vehicle_id}\n"
        "  AND end_place IS NOT NULL\n"
        "  AND end_place <> ''\n"
        "  AND ended_at BETWEEN $__timeFrom() AND $__timeTo()\n"
        "GROUP BY end_place\n"
        "ORDER BY COUNT(*) DESC\n"
        "LIMIT 10;"
    )


# title -> (new_sql, optional new viz type, optional new title)
PANEL_FIXES: dict[str, tuple[str, str | None, str | None]] = {
    "Vehicle Config":         (vehicle_config_sql(),    None,    None),
    "Software Updates":       (software_updates_sql(),  None,    None),
    "Safety Settings":        (safety_settings_sql(),   None,    None),
    "Navigation":             (navigation_sql(),        None,    None),
    "User Preferences":       (user_preferences_sql(),  "table", None),
    "Location at Home/Work":  (top_destinations_sql(),  "table", "Top Destinations"),
    # Top Destinations is the post-rename name — handle re-runs gracefully
    "Top Destinations":       (top_destinations_sql(),  "table", None),
}


def _is_stub(sql: str) -> bool:
    return STUB_MARKER in sql


def main() -> int:
    raw = DASHBOARD.read_text(encoding="utf-8")
    dash = json.loads(raw)

    fixed: list[str] = []
    skipped_already_done: list[str] = []
    skipped_no_match: list[str] = []

    for panel in dash.get("panels", []):
        title = panel.get("title")
        if title not in PANEL_FIXES:
            continue
        new_sql, new_type, new_title = PANEL_FIXES[title]
        targets = panel.get("targets") or []
        if not targets:
            skipped_no_match.append(title)
            continue
        target = targets[0]
        old_sql = target.get("rawSql", "")
        if old_sql.strip() == new_sql.strip():
            # Already revived to the latest definition
            if new_type and panel.get("type") != new_type:
                panel["type"] = new_type
                fixed.append(f"{title} (type only -> {new_type})")
                continue
            skipped_already_done.append(title)
            continue
        if not _is_stub(old_sql):
            # Non-stub but query differs — could be a previous revival being upgraded.
            # Allow upgrade only when the panel title is in our fix table by name.
            pass
        target["rawSql"] = new_sql
        target["format"] = "table"
        if new_type:
            panel["type"] = new_type
        if new_title:
            panel["title"] = new_title
        fixed.append(title if not new_title else f"{title} -> {new_title}")

    if not fixed:
        print(f"No changes — {len(skipped_already_done)} already revived, {len(skipped_no_match)} need manual review")
        return 0

    DASHBOARD.write_text(json.dumps(dash, indent=2) + "\n", encoding="utf-8")

    # Validate JSON round-trip
    try:
        json.loads(DASHBOARD.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"FAILED: produced invalid JSON: {e}", file=sys.stderr)
        return 1

    print(f"Revived {len(fixed)} panel(s):")
    for t in fixed:
        print(f"  ✓ {t}")
    if skipped_already_done:
        print(f"Already revived (skipped): {', '.join(skipped_already_done)}")
    if skipped_no_match:
        print(f"Need manual review: {', '.join(skipped_no_match)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
