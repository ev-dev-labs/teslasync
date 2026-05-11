#!/usr/bin/env python3
"""
Migrate Grafana dashboards from the legacy signal_log column names
(signal / value_num / value_str / value_bool / created_at) to the
Phase-42 schema (field / float_value / int_value / str_value /
bool_value / ts).

Also fixes two pre-existing schema-drift bugs that surface on the
same dashboards (`drives` and `charging_sessions` were renamed
`start_ts`/`end_ts` -> `started_at`/`ended_at` years ago; the
dropped `vehicle_states` table needs to read from `fsm_transitions`
now). All three rewrites land in one pass so dashboards become
green in a single migration commit.

signal_log mapping (mirrors internal/database/signal_log_reader_query.go):

    [<alias>.]value_num   -> COALESCE([<alias>.]float_value, [<alias>.]int_value::float8)
    value_str             -> str_value
    value_bool            -> bool_value
    signal                -> field            (bare; signal_log/_name skipped via \\b)
    created_at            -> ts               (only inside signal_log queries)

drives / charging_sessions column rename (no current table uses these):

    start_ts              -> started_at
    end_ts                -> ended_at

vehicle_states replacement (table dropped by phase-42 migration 000180):

    vehicle_states  +  state column   -> fsm_transitions / to_state
    vehicle_states  +  start_date     -> fsm_transitions / ts
    duration_min                       -> NOT in fsm_transitions; queries
                                          rewritten by hand below.

Safety:
  * value_num/value_str/value_bool/signal/created_at rewrites only run
    on rawSql strings that contain 'signal_log'.
  * start_ts/end_ts rewrites run globally — no surviving table has
    those column names, verified via information_schema.
  * vehicle_states rewrites run globally — table no longer exists.
"""

import json
import re
import sys
from pathlib import Path

DASHBOARD_DIR = Path("D:/repos/teslasync/grafana/dashboards/system")

# value_num is special: an optional table alias must be carried into
# both args of the COALESCE so `sl.value_num` becomes
# `COALESCE(sl.float_value, sl.int_value::float8)`, NOT the broken
# `sl.COALESCE(...)`.
VALUE_NUM_RE = re.compile(r"(?:(\w+)\.)?\bvalue_num\b")


def _value_num_repl(m: "re.Match[str]") -> str:
    alias = m.group(1)
    if alias:
        return f"COALESCE({alias}.float_value, {alias}.int_value::float8)"
    return "COALESCE(float_value, int_value::float8)"


SIGNAL_LOG_RULES = [
    (VALUE_NUM_RE, _value_num_repl),
    (re.compile(r"\bvalue_str\b"),  "str_value"),
    (re.compile(r"\bvalue_bool\b"), "bool_value"),
    # `\bsignal\b` matches the bare column name. signal_log / signal_name
    # contain `_` which IS a \w character → they are NOT matched.
    (re.compile(r"\bsignal\b"),     "field"),
    (re.compile(r"\bcreated_at\b"), "ts"),
]

GLOBAL_RULES = [
    (re.compile(r"\bstart_ts\b"), "started_at"),
    (re.compile(r"\bend_ts\b"),   "ended_at"),
]

# vehicle_states table was dropped by phase-42 migration 000180.
# Replace the two query patterns we actually use:
#   1. Current state lookup:  (SELECT vs.state FROM vehicle_states vs ... ORDER BY vs.start_date DESC LIMIT 1)
#   2. Timeline + duration aggregation (timeline.json) — handled below in HAND_PATCHES.
VEHICLE_STATES_CURRENT_RE = re.compile(
    r"\(SELECT\s+(\w+)\.state\s+FROM\s+vehicle_states\s+\1\s+"
    r"WHERE\s+\1\.vehicle_id\s*=\s*([^\s)]+)\s+"
    r"ORDER\s+BY\s+\1\.start_date\s+DESC\s+LIMIT\s+1\)",
    re.IGNORECASE,
)


def _vstates_current_repl(m: "re.Match[str]") -> str:
    alias, vid = m.group(1), m.group(2)
    return (
        f"(SELECT {alias}.to_state FROM fsm_transitions {alias} "
        f"WHERE {alias}.vehicle_id = {vid} "
        f"AND {alias}.fsm_name = 'vehicle' "
        f"ORDER BY {alias}.ts DESC LIMIT 1)"
    )


# Hand-patches: queries that need structural rewrites, keyed by (file, before).
# Applied AFTER all regex rules. Each value is the full replacement rawSql.
HAND_PATCHES = {
    # timeline.json — three vehicle_states queries that depend on
    # `start_date` + `duration_min` columns that don't exist in
    # fsm_transitions. Use window functions to compute durations.
    "timeline.json": [
        (
            "SELECT\n  start_date AS \"time\",\n  state AS \"📊 State\"\n"
            "FROM vehicle_states\nWHERE vehicle_id = ${vehicle_id}\n"
            "  AND $__timeFilter(start_date)\nORDER BY start_date",
            "SELECT\n  ts AS \"time\",\n  to_state AS \"📊 State\"\n"
            "FROM fsm_transitions\nWHERE vehicle_id = ${vehicle_id}\n"
            "  AND fsm_name = 'vehicle'\n"
            "  AND $__timeFilter(ts)\nORDER BY ts",
        ),
        (
            "SELECT\n  state AS \"📊 State\",\n  COUNT(*) AS \"📊 Count\",\n"
            "  ROUND(SUM(duration_min)::numeric) AS \"⏱️ Total Min\",\n"
            "  ROUND((SUM(duration_min) / 60)::numeric, 1) AS \"⏱️ Total Hours\"\n"
            "FROM vehicle_states\nWHERE vehicle_id = ${vehicle_id}\n"
            "  AND $__timeFilter(start_date)\nGROUP BY state\nORDER BY 3 DESC",
            "SELECT\n  to_state AS \"📊 State\",\n  COUNT(*) AS \"📊 Count\",\n"
            "  ROUND(SUM(EXTRACT(EPOCH FROM (next_ts - ts)) / 60)::numeric) AS \"⏱️ Total Min\",\n"
            "  ROUND((SUM(EXTRACT(EPOCH FROM (next_ts - ts)) / 3600))::numeric, 1) AS \"⏱️ Total Hours\"\n"
            "FROM (\n"
            "  SELECT to_state, ts,\n"
            "         LEAD(ts, 1, NOW()) OVER (ORDER BY ts) AS next_ts\n"
            "  FROM fsm_transitions\n"
            "  WHERE vehicle_id = ${vehicle_id}\n"
            "    AND fsm_name = 'vehicle'\n"
            "    AND $__timeFilter(ts)\n"
            ") sub\nGROUP BY to_state\nORDER BY 3 DESC",
        ),
        (
            "SELECT state AS \"📊 State\", SUM(duration_min) AS \"Minutes\"\n"
            "FROM vehicle_states\nWHERE vehicle_id = ${vehicle_id} AND $__timeFilter(start_date)\n"
            "GROUP BY state ORDER BY \"Minutes\" DESC",
            "SELECT to_state AS \"📊 State\", "
            "SUM(EXTRACT(EPOCH FROM (next_ts - ts)) / 60) AS \"Minutes\"\n"
            "FROM (\n"
            "  SELECT to_state, ts,\n"
            "         LEAD(ts, 1, NOW()) OVER (ORDER BY ts) AS next_ts\n"
            "  FROM fsm_transitions\n"
            "  WHERE vehicle_id = ${vehicle_id}\n"
            "    AND fsm_name = 'vehicle'\n"
            "    AND $__timeFilter(ts)\n"
            ") sub\nGROUP BY to_state ORDER BY \"Minutes\" DESC",
        ),
    ],
}


def migrate_sql(sql: str, fname: str) -> tuple[str, int]:
    """Apply all rewrite rules to one rawSql string. Returns (new_sql, edit_count)."""
    out = sql
    edits = 0

    if "signal_log" in out:
        for pat, repl in SIGNAL_LOG_RULES:
            new_out, n = pat.subn(repl, out)
            edits += n
            out = new_out

    for pat, repl in GLOBAL_RULES:
        new_out, n = pat.subn(repl, out)
        edits += n
        out = new_out

    if "vehicle_states" in out:
        new_out, n = VEHICLE_STATES_CURRENT_RE.subn(_vstates_current_repl, out)
        edits += n
        out = new_out

    for before, after in HAND_PATCHES.get(fname, []):
        if before in out:
            out = out.replace(before, after)
            edits += 1

    return out, edits


def walk_targets(panel: dict, fname: str):
    for tgt in panel.get("targets", []):
        sql = tgt.get("rawSql")
        if isinstance(sql, str):
            new_sql, edits = migrate_sql(sql, fname)
            if edits:
                tgt["rawSql"] = new_sql
                yield panel.get("title", "<no title>"), edits
    for sub in panel.get("panels", []):
        yield from walk_targets(sub, fname)


def migrate_file(path: Path) -> tuple[int, int]:
    with open(path, "r", encoding="utf-8") as f:
        doc = json.load(f)

    edits_per_panel = []
    for panel in doc.get("panels", []):
        for title, n in walk_targets(panel, path.name):
            edits_per_panel.append((title, n))

    # Grafana template variables also carry SQL in `definition` / `query`.
    for var in doc.get("templating", {}).get("list", []) or []:
        for key in ("definition", "query"):
            sql = var.get(key)
            if isinstance(sql, str):
                new_sql, edits = migrate_sql(sql, path.name)
                if edits:
                    var[key] = new_sql
                    edits_per_panel.append((f"$var:{var.get('name','?')}.{key}", edits))

    if edits_per_panel:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(doc, f, indent=2, ensure_ascii=False)
            f.write("\n")
        return len(edits_per_panel), sum(n for _, n in edits_per_panel)
    return 0, 0


def main() -> int:
    if not DASHBOARD_DIR.is_dir():
        print(f"FATAL: dashboard dir not found: {DASHBOARD_DIR}", file=sys.stderr)
        return 1

    grand_panels = grand_edits = files_touched = 0
    for jf in sorted(DASHBOARD_DIR.glob("*.json")):
        panels, edits = migrate_file(jf)
        if edits:
            files_touched += 1
            grand_panels += panels
            grand_edits += edits
            print(f"  {jf.name:40s}  panels={panels:3d}  edits={edits:3d}")

    print()
    print(f"Files touched : {files_touched}")
    print(f"Panels edited : {grand_panels}")
    print(f"Total edits   : {grand_edits}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
