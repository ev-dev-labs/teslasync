#!/usr/bin/env python3
"""
Migrate Grafana dashboards from the legacy signal_log column names
(signal / value_num / value_str / value_bool / created_at) to the
Phase-42 schema (field / float_value / int_value / str_value /
bool_value / ts).

Also fixes pre-existing schema-drift bugs that surface on the same
dashboards:

  * `drives` and `charging_sessions` were renamed
    `start_ts`/`end_ts` -> `started_at`/`ended_at`.

  * `vehicle_states` table was dropped (phase-42 mig 000180); current
    state lookups now read from `fsm_transitions`.

  * Phase-48 SI canonical refactor renamed many `drives` and
    `charging_sessions` columns + changed their units to SI base
    units. Conversions injected so display semantics are preserved
    via convert_distance / convert_speed (which expect mi / mph
    inputs and return user-preferred units).

      drives.distance_mi               -> drives.distance_m / 1609.344         (m -> mi)
      drives.duration_min              -> drives.duration_s / 60.0
      drives.avg_speed_mph             -> drives.avg_speed_mps * 2.2369362920544
      drives.max_speed_mph             -> drives.max_speed_mps * 2.2369362920544
      drives.energy_used_kwh           -> drives.energy_used_wh / 1000.0
      drives.regen_energy_kwh          -> drives.regen_energy_wh / 1000.0
      drives.avg_power_kw              -> drives.avg_power_w / 1000.0
      drives.peak_power_kw             -> drives.peak_power_w / 1000.0
      drives.start_battery_pct         -> drives.start_soc_pct
      drives.end_battery_pct           -> drives.end_soc_pct
      drives.start_address             -> drives.start_place
      drives.end_address               -> drives.end_place
      drives.outside_temp_avg_c        -> drives.ambient_temp_c_avg
      drives.score                     -> NULL  (dropped column, no replacement)

      charging_sessions.energy_added_kwh    -> charging_sessions.total_energy_added_wh / 1000.0
      charging_sessions.charger_power_kw_max-> charging_sessions.peak_power_w / 1000.0
      charging_sessions.start_battery_pct   -> charging_sessions.start_soc_pct
      charging_sessions.end_battery_pct     -> charging_sessions.end_soc_pct
      charging_sessions.cost                -> charging_sessions.cost_decimal
      charging_sessions.duration_min        -> EXTRACT(EPOCH FROM (ended_at - started_at)) / 60.0
      charging_sessions.charger_phases      -> NULL    (dropped column)
      charging_sessions.max_charger_voltage -> NULL    (dropped column)
      charging_sessions.charger_location    -> NULL    (dropped column)

  * Three dropped tables get hand-patched per panel:

      daily_mileage          -> derived view from drives (DATE(started_at), SUM(distance_m))
      vampire_drain_events   -> empty-stub VALUES expression (panels show "No data";
                                phase-43a will land replacement handler from
                                signal_log battery delta).
      visited_locations      -> empty-stub VALUES expression (places history; needs
                                phase-43a replacement source).

Safety:
  * value_num/value_str/value_bool/signal/created_at rewrites only run
    on rawSql strings that contain 'signal_log'.
  * start_ts/end_ts and SI rewrites run globally — verified no
    surviving table has those column names via information_schema.
  * vehicle_states / daily_mileage / vampire_drain_events /
    visited_locations rewrites run globally — those tables no longer
    exist.
"""

import json
import re
import sys
from pathlib import Path

DASHBOARD_DIR = Path("D:/repos/teslasync/grafana/dashboards/system")

# Per-query set of CTE / derived-table aliases. _alias_repl reads this
# to skip rewriting `<alias>.col` references when `<alias>` names a
# subquery (the column lives in the subquery's projection, not in the
# underlying real table).
_SUBQUERY_ALIASES: set[str] = set()


_SUBQUERY_KEYWORDS = {
    "AS", "ON", "WHERE", "GROUP", "ORDER", "JOIN", "LEFT", "RIGHT",
    "FULL", "INNER", "CROSS", "UNION", "SELECT", "FROM", "AND", "OR",
    "NOT", "WITH", "HAVING", "LIMIT", "OFFSET", "WINDOW", "USING",
    "RETURNING",
}


def _collect_subquery_aliases(sql: str) -> set[str]:
    """Find CTE aliases (WITH x AS (...), chained ", y AS (...)") and
    derived-table aliases (FROM (SELECT ...) x | JOIN (SELECT ...) AS y),
    plus any alias attached to a reference to a CTE name (FROM cte a,
    JOIN cte AS b). The columns inside a subquery are defined by its
    projection, not by the underlying real table — so SI / cost rewrites
    must skip references of the form `<subquery_alias>.col`."""
    aliases: set[str] = set()
    cte_names: set[str] = set()
    for m in re.finditer(r"\bWITH\s+(\w+)\s+AS\s*\(", sql, re.IGNORECASE):
        cte_names.add(m.group(1))
    for m in re.finditer(r",\s*(\w+)\s+AS\s*\(", sql, re.IGNORECASE):
        cte_names.add(m.group(1))
    aliases |= cte_names

    # Derived-table aliases via paren tracking: only `)` that closes a
    # `(SELECT ...)` subquery may be followed by an alias. Function-call
    # `)` (like `SUM(x)`) is followed by AS <colname> — that's a
    # projection alias, NOT a derived-table alias, and must be ignored.
    paren_select_stack: list[bool] = []
    n = len(sql)
    i = 0
    while i < n:
        c = sql[i]
        if c == '(':
            j = i + 1
            while j < n and sql[j].isspace():
                j += 1
            is_select = (
                sql[j:j + 6].upper() == "SELECT"
                and (j + 6 >= n or not (sql[j + 6].isalnum() or sql[j + 6] == '_'))
            )
            paren_select_stack.append(is_select)
        elif c == ')':
            was_select = paren_select_stack.pop() if paren_select_stack else False
            if was_select:
                j = i + 1
                while j < n and sql[j].isspace():
                    j += 1
                if sql[j:j + 2].upper() == "AS" and j + 2 < n and sql[j + 2].isspace():
                    j += 2
                    while j < n and sql[j].isspace():
                        j += 1
                k = j
                while k < n and (sql[k].isalnum() or sql[k] == '_'):
                    k += 1
                if k > j:
                    alias = sql[j:k]
                    if alias.upper() not in _SUBQUERY_KEYWORDS:
                        aliases.add(alias)
        i += 1

    for cte in cte_names:
        pat = rf"\b(?:FROM|JOIN)\s+{re.escape(cte)}\s+(?:AS\s+)?(\w+)\b"
        for m in re.finditer(pat, sql, re.IGNORECASE):
            alias = m.group(1)
            if alias.upper() not in _SUBQUERY_KEYWORDS:
                aliases.add(alias)
    return aliases


def _enclosing_scope(sql: str, pos: int) -> str:
    """Return the innermost (SELECT ...) scope enclosing position `pos`.
    Tracks paren depth to find boundaries. If `pos` is at top level
    (not inside any subquery), returns the full sql."""
    depth = 0
    start = 0
    for i in range(pos - 1, -1, -1):
        c = sql[i]
        if c == ')':
            depth += 1
        elif c == '(':
            if depth == 0:
                j = i + 1
                while j < len(sql) and sql[j].isspace():
                    j += 1
                if sql[j:j + 6].upper() == "SELECT":
                    start = i + 1
                    break
            else:
                depth -= 1
    if start == 0:
        return sql
    depth = 1
    end = len(sql)
    for i in range(start, len(sql)):
        c = sql[i]
        if c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
            if depth == 0:
                end = i
                break
    return sql[start:end]


def _scope_uses_only_subqueries(scope_sql: str) -> bool:
    """True if every FROM/JOIN target in this scope is a CTE / subquery
    alias (no real underlying table). Used to decide whether a bare
    column rewrite is safe — if no real table is in scope, the bare
    column is a passthrough from a subquery and must NOT be rewritten."""
    targets: list[str] = []
    for m in re.finditer(r"\b(?:FROM|JOIN)\s+(\w+)\b", scope_sql, re.IGNORECASE):
        t = m.group(1)
        if t.upper() not in _SUBQUERY_KEYWORDS:
            targets.append(t)
    if not targets:
        return False
    return all(t in _SUBQUERY_ALIASES for t in targets)


def _alias_repl(template_with_alias: str, no_alias: str):
    """Build a re.sub callback that handles `<alias>.col` and bare `col`.

    `template_with_alias` should contain `{a}` placeholder for the alias
    INCLUDING the trailing dot (e.g. `({a}distance_m / 1609.344)`).

    Skips matches where the alias names a CTE / derived table, AND
    skips bare matches whose enclosing SELECT scope only references
    subqueries (no real underlying table)."""
    def fn(m: "re.Match[str]") -> str:
        alias = m.group(1)
        if alias:
            if alias in _SUBQUERY_ALIASES:
                return m.group(0)
            return template_with_alias.format(a=f"{alias}.")
        scope = _enclosing_scope(m.string, m.start())
        if _scope_uses_only_subqueries(scope):
            return m.group(0)
        return no_alias
    return fn


# `(?<![Aa][Ss] )` — fixed-width negative lookbehind that skips the
# column name when it appears in `... AS <name>` position (CTE / select
# alias). Without this, `SUM(distance_mi) AS distance_mi` becomes
# `SUM((distance_m / 1609.344)) AS (distance_m / 1609.344)` — invalid.
_NOT_AFTER_AS = r"(?<![Aa][Ss] )"


# value_num is special: an optional table alias must be carried into
# both args of the COALESCE so `sl.value_num` becomes
# `COALESCE(sl.float_value, sl.int_value::float8)`, NOT the broken
# `sl.COALESCE(...)`.
VALUE_NUM_RE = re.compile(r"(?:(\w+)\.)?\bvalue_num\b")
SIGNAL_LOG_RULES = [
    (VALUE_NUM_RE, _alias_repl(
        "COALESCE({a}float_value, {a}int_value::float8)",
        "COALESCE(float_value, int_value::float8)",
    )),
    (re.compile(r"\bvalue_str\b"),  "str_value"),
    (re.compile(r"\bvalue_bool\b"), "bool_value"),
    # `\bsignal\b` matches the bare column name. signal_log / signal_name
    # contain `_` which IS a \w character → they are NOT matched.
    (re.compile(r"\bsignal\b"),     "field"),
    (re.compile(r"\bcreated_at\b"), "ts"),
]

# drives + charging_sessions Phase-48 SI canonical rewrites. All
# alias-aware. Each runs globally because no surviving table has the
# legacy identifiers. The `_NOT_AFTER_AS` lookbehind preserves CTE /
# select-alias positions like `SUM(distance_mi) AS distance_mi` (the
# alias remains the legacy name so downstream `cte.distance_mi`
# references still work without their own rewrite).
SI_RESCALE_RULES = [
    # drives: distance / speed / power / energy / temp / battery
    (re.compile(_NOT_AFTER_AS + r"(?:(\w+)\.)?\bdistance_mi\b"),
     _alias_repl("({a}distance_m / 1609.344)", "(distance_m / 1609.344)")),
    (re.compile(_NOT_AFTER_AS + r"(?:(\w+)\.)?\bavg_speed_mph\b"),
     _alias_repl("({a}avg_speed_mps * 2.2369362920544)", "(avg_speed_mps * 2.2369362920544)")),
    (re.compile(_NOT_AFTER_AS + r"(?:(\w+)\.)?\bmax_speed_mph\b"),
     _alias_repl("({a}max_speed_mps * 2.2369362920544)", "(max_speed_mps * 2.2369362920544)")),
    (re.compile(_NOT_AFTER_AS + r"(?:(\w+)\.)?\benergy_used_kwh\b"),
     _alias_repl("({a}energy_used_wh / 1000.0)", "(energy_used_wh / 1000.0)")),
    (re.compile(_NOT_AFTER_AS + r"(?:(\w+)\.)?\bregen_energy_kwh\b"),
     _alias_repl("({a}regen_energy_wh / 1000.0)", "(regen_energy_wh / 1000.0)")),
    # `regen_kwh` (note: NO _energy_ infix) is a separate alias used in
    # some panels for the same column.
    (re.compile(_NOT_AFTER_AS + r"(?:(\w+)\.)?\bregen_kwh\b"),
     _alias_repl("({a}regen_energy_wh / 1000.0)", "(regen_energy_wh / 1000.0)")),
    (re.compile(_NOT_AFTER_AS + r"(?:(\w+)\.)?\bavg_power_kw\b"),
     _alias_repl("({a}avg_power_w / 1000.0)", "(avg_power_w / 1000.0)")),
    (re.compile(_NOT_AFTER_AS + r"(?:(\w+)\.)?\bpeak_power_kw\b"),
     _alias_repl("({a}peak_power_w / 1000.0)", "(peak_power_w / 1000.0)")),
    (re.compile(_NOT_AFTER_AS + r"(?:(\w+)\.)?\boutside_temp_avg_c\b"),
     _alias_repl("{a}ambient_temp_c_avg", "ambient_temp_c_avg")),
    (re.compile(_NOT_AFTER_AS + r"(?:(\w+)\.)?\bstart_address\b"),
     _alias_repl("{a}start_place", "start_place")),
    (re.compile(_NOT_AFTER_AS + r"(?:(\w+)\.)?\bend_address\b"),
     _alias_repl("{a}end_place", "end_place")),
    # charging_sessions
    (re.compile(_NOT_AFTER_AS + r"(?:(\w+)\.)?\benergy_added_kwh\b"),
     _alias_repl("({a}total_energy_added_wh / 1000.0)", "(total_energy_added_wh / 1000.0)")),
    (re.compile(_NOT_AFTER_AS + r"(?:(\w+)\.)?\bcharger_power_kw_max\b"),
     _alias_repl("({a}peak_power_w / 1000.0)", "(peak_power_w / 1000.0)")),
    # SOC rename — applies to BOTH drives and charging_sessions.
    (re.compile(_NOT_AFTER_AS + r"(?:(\w+)\.)?\bstart_battery_pct\b"),
     _alias_repl("{a}start_soc_pct", "start_soc_pct")),
    (re.compile(_NOT_AFTER_AS + r"(?:(\w+)\.)?\bend_battery_pct\b"),
     _alias_repl("{a}end_soc_pct", "end_soc_pct")),
    # Dropped charging_sessions text columns → typed-text NULL so they
    # remain valid in GROUP BY / DISTINCT contexts (a bare `NULL` alone
    # is "non-integer constant in GROUP BY").
    (re.compile(_NOT_AFTER_AS + r"(?:\w+\.)?\bcharger_phases\b"),
     "(NULL::int)"),
    (re.compile(_NOT_AFTER_AS + r"(?:\w+\.)?\bmax_charger_voltage\b"),
     "(NULL::float8)"),
    (re.compile(_NOT_AFTER_AS + r"(?:\w+\.)?\bcharger_location\b"),
     "(NULL::text)"),
    # Dropped drives column. Cast to float8 so AVG(score) doesn't trip
    # the "function avg(unknown) is not unique" error.
    (re.compile(_NOT_AFTER_AS + r"(?:\w+\.)?\bscore\b"),
     "(NULL::float8)"),
]


# `cost` rename (charging_sessions: cost -> cost_decimal). Risky because
# `cost` is a common identifier. Apply only when the rawSql clearly
# references `charging_sessions` (FROM or JOIN). Alias-aware. Skip
# `AS cost` alias context (otherwise the alias gets renamed too).
COST_RE = re.compile(_NOT_AFTER_AS + r"(?:(\w+)\.)?\bcost\b")


def _cost_repl(m: "re.Match[str]") -> str:
    alias = m.group(1)
    if alias and alias in _SUBQUERY_ALIASES:
        return m.group(0)
    return f"{alias}.cost_decimal" if alias else "cost_decimal"


# duration_min is table-dependent:
#   drives.duration_min            -> (duration_s / 60.0)            (alias-aware)
#   charging_sessions.duration_min -> EXTRACT(EPOCH FROM (ended_at - started_at)) / 60.0
DURATION_MIN_RE = re.compile(r"(?:(\w+)\.)?\bduration_min\b")


def _duration_min_drives(m: "re.Match[str]") -> str:
    alias = m.group(1)
    if alias and alias in _SUBQUERY_ALIASES:
        return m.group(0)
    pfx = f"{alias}." if alias else ""
    return f"({pfx}duration_s / 60.0)"


def _duration_min_charging(m: "re.Match[str]") -> str:
    alias = m.group(1)
    if alias and alias in _SUBQUERY_ALIASES:
        return m.group(0)
    pfx = f"{alias}." if alias else ""
    return f"(EXTRACT(EPOCH FROM ({pfx}ended_at - {pfx}started_at)) / 60.0)"


GLOBAL_RULES = [
    (re.compile(r"\bstart_ts\b"), "started_at"),
    (re.compile(r"\bend_ts\b"),   "ended_at"),
]

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


# Empty stubs for dropped tables. Match `FROM <table>` / `JOIN <table>`
# / `<table> alias` patterns and replace with a CTE that yields the
# expected column shape but no rows. The panels then render "No data"
# instead of erroring.
#
# Stubs include EVERY column referenced by ANY dashboard query against
# the dropped table — checked via grep against the JSON files.
VAMPIRE_DRAIN_STUB = (
    "(SELECT NULL::timestamptz AS start_date, "
    "NULL::timestamptz AS end_date, "
    "NULL::float8 AS duration_hours, "
    "NULL::float8 AS battery_lost, "
    "NULL::float8 AS start_battery, "
    "NULL::float8 AS end_battery, "
    "NULL::float8 AS drain_rate_pct_per_hour, "
    "NULL::float8 AS range_lost_km, "
    "NULL::float8 AS outside_temp_avg, "
    "NULL::bool AS sentry_mode, "
    "NULL::bigint AS vehicle_id WHERE FALSE)"
)
VISITED_LOCATIONS_STUB = (
    "(SELECT NULL::bigint AS address_id, "
    "NULL::bigint AS vehicle_id, "
    "NULL::bigint AS visit_count, "
    "NULL::float8 AS total_duration_min, "
    "NULL::timestamptz AS first_visited, "
    "NULL::timestamptz AS last_visited WHERE FALSE)"
)
# daily_mileage is derivable from drives — provide a real view-equivalent
# CTE so panels show real data, not just empty.
DAILY_MILEAGE_DERIVED = (
    "(SELECT DATE(started_at) AS date, "
    "vehicle_id, "
    "SUM(distance_m) / 1000.0 AS distance_km "
    "FROM drives GROUP BY 1, 2)"
)

DROPPED_TABLE_RULES = [
    (re.compile(r"\bvampire_drain_events\b"),  VAMPIRE_DRAIN_STUB),
    (re.compile(r"\bvisited_locations\b"),     VISITED_LOCATIONS_STUB),
    (re.compile(r"\bdaily_mileage\b"),         DAILY_MILEAGE_DERIVED),
]


# Hand-patches: queries that need structural rewrites, keyed by file.
# Applied AFTER all regex rules. Each entry is (before, after) and the
# `before` must match the rawSql exactly (post-regex-rules).
HAND_PATCHES = {
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
    "trips.json": [
        # The trips table is metadata-only (no aggregate columns).
        # Derive distance/energy/drive-count from drives by time-window
        # overlap (no FK exists post-Phase-48).
        (
            "SELECT\n  t.name AS \"\u2708\ufe0f Trip\",\n"
            "  t.started_at AS \"\U0001F4C5 Start\",\n"
            "  t.ended_at AS \"\U0001F4C5 End\",\n"
            "  ROUND(convert_distance(t.total_distance_mi)::numeric, 1) AS \"\U0001F4CF Distance\",\n"
            "  ROUND(t.total_energy_kwh::numeric, 1) AS \"\u26a1 Energy\",\n"
            "  ROUND(NULL::numeric, 2) AS \"\U0001F4B0 Cost\",\n"
            "  NULL AS \"\U0001F6E3\ufe0f Drives\",\n"
            "  NULL AS \"\u26a1 Charges\",\n"
            "  ROUND((convert_efficiency(t.total_energy_kwh * 1000 / NULLIF(t.total_distance_mi, 0)))::numeric, 1) AS \"\u26a1 Efficiency\"\n"
            "FROM trips t\nWHERE t.vehicle_id = ${vehicle_id}\n"
            "ORDER BY t.started_at DESC\nLIMIT 50",
            "SELECT\n  t.name AS \"\u2708\ufe0f Trip\",\n"
            "  t.started_at AS \"\U0001F4C5 Start\",\n"
            "  t.ended_at AS \"\U0001F4C5 End\",\n"
            "  ROUND(convert_distance(COALESCE(SUM(d.distance_m) / 1609.344, 0))::numeric, 1) AS \"\U0001F4CF Distance\",\n"
            "  ROUND(COALESCE(SUM(d.energy_used_wh) / 1000.0, 0)::numeric, 1) AS \"\u26a1 Energy\",\n"
            "  ROUND(NULL::numeric, 2) AS \"\U0001F4B0 Cost\",\n"
            "  COUNT(d.id) AS \"\U0001F6E3\ufe0f Drives\",\n"
            "  NULL AS \"\u26a1 Charges\",\n"
            "  ROUND((convert_efficiency(COALESCE(SUM(d.energy_used_wh), 0) / NULLIF(SUM(d.distance_m) / 1609.344, 0)))::numeric, 1) AS \"\u26a1 Efficiency\"\n"
            "FROM trips t\nLEFT JOIN drives d ON d.vehicle_id = t.vehicle_id\n"
            "  AND d.started_at >= t.started_at AND d.ended_at <= t.ended_at\n"
            "WHERE t.vehicle_id = ${vehicle_id}\n"
            "GROUP BY t.id, t.name, t.started_at, t.ended_at\n"
            "ORDER BY t.started_at DESC\nLIMIT 50",
        ),
    ],
    "drive-score.json": [
        # Outer query references CTE columns bare (`distance_mi`,
        # `score`, `wh_per_mi`). The CTE `scored` is in scope; prefix
        # the outer-query refs with `scored.` so the CTE-alias guard
        # in `_alias_repl` protects them from regex rewrite.
        (
            "  ROUND(convert_distance(distance_mi, '${unit_length}')::numeric, 1) AS \"\U0001F4CF Distance\",\n"
            "  ROUND(convert_speed(avg_speed, '${unit_length}')::numeric, 1) AS \"\U0001F697 Avg Speed\",\n"
            "  score AS \"\u2b50 Score\",\n"
            "  grade AS \"\U0001F3C5 Grade\",\n"
            "  CASE WHEN wh_per_mi IS NOT NULL\n"
            "    THEN ROUND(convert_efficiency(wh_per_mi, '${unit_length}')::numeric, 0)\n"
            "    ELSE NULL\n"
            "  END AS \"\u26a1 Efficiency\"",
            "  ROUND(convert_distance(scored.distance_mi, '${unit_length}')::numeric, 1) AS \"\U0001F4CF Distance\",\n"
            "  ROUND(convert_speed(scored.avg_speed, '${unit_length}')::numeric, 1) AS \"\U0001F697 Avg Speed\",\n"
            "  scored.score AS \"\u2b50 Score\",\n"
            "  scored.grade AS \"\U0001F3C5 Grade\",\n"
            "  CASE WHEN scored.wh_per_mi IS NOT NULL\n"
            "    THEN ROUND(convert_efficiency(scored.wh_per_mi, '${unit_length}')::numeric, 0)\n"
            "    ELSE NULL\n"
            "  END AS \"\u26a1 Efficiency\"",
        ),
    ],
}


def _references_charging_sessions(sql: str) -> bool:
    """True iff the SQL references the charging_sessions table (FROM/JOIN)."""
    return re.search(r"\b(?:from|join)\s+charging_sessions\b", sql, re.IGNORECASE) is not None


def _references_drives(sql: str) -> bool:
    return re.search(r"\b(?:from|join)\s+drives\b", sql, re.IGNORECASE) is not None


def _apply_table_dependent_rules(sql: str) -> tuple[str, int]:
    """Apply rules that depend on which table is referenced (cost,
    duration_min). Run on a single SELECT scope — caller is responsible
    for splitting UNION queries first so each half is processed against
    its own FROM/JOIN context."""
    out = sql
    edits = 0

    if _references_charging_sessions(out):
        new_out, n = COST_RE.subn(_cost_repl, out)
        edits += n
        out = new_out

    refs_cs = _references_charging_sessions(out)
    refs_dr = _references_drives(out)
    if refs_cs and not refs_dr:
        new_out, n = DURATION_MIN_RE.subn(_duration_min_charging, out)
        edits += n
        out = new_out
    elif refs_dr and not refs_cs:
        new_out, n = DURATION_MIN_RE.subn(_duration_min_drives, out)
        edits += n
        out = new_out
    elif refs_cs and refs_dr:
        # Both tables referenced — alias prefix MUST disambiguate.
        def _mixed(m: "re.Match[str]") -> str:
            alias = m.group(1)
            if not alias:
                return m.group(0)
            cs_alias = re.search(rf"\bcharging_sessions\s+{re.escape(alias)}\b", out)
            dr_alias = re.search(rf"\bdrives\s+{re.escape(alias)}\b", out)
            if cs_alias and not dr_alias:
                return _duration_min_charging(m)
            if dr_alias and not cs_alias:
                return _duration_min_drives(m)
            return m.group(0)
        new_out, n = DURATION_MIN_RE.subn(_mixed, out)
        edits += n
        out = new_out

    return out, edits


def migrate_sql(sql: str, fname: str) -> tuple[str, int]:
    """Apply all rewrite rules to one rawSql string. Returns (new_sql, edit_count)."""
    out = sql
    edits = 0

    # File-specific hand-patches FIRST so they operate on the ORIGINAL
    # SQL (no surprise mutations from regex). Patched output then flows
    # through the regex rules normally — this is desirable since most
    # patches still benefit from generic rewrites (e.g., `start_ts` →
    # `started_at`) on the rest of the query.
    for before, after in HAND_PATCHES.get(fname, []):
        if before in out:
            out = out.replace(before, after)
            edits += 1

    global _SUBQUERY_ALIASES
    _SUBQUERY_ALIASES = _collect_subquery_aliases(out)

    # signal_log rules: only when sql references signal_log.
    if "signal_log" in out:
        for pat, repl in SIGNAL_LOG_RULES:
            new_out, n = pat.subn(repl, out)
            edits += n
            out = new_out

    # Always-safe global renames.
    for pat, repl in GLOBAL_RULES:
        new_out, n = pat.subn(repl, out)
        edits += n
        out = new_out

    # SI canonical rewrites (drives + charging_sessions). All identifiers
    # are gone from current schema, so global apply is safe.
    for pat, repl in SI_RESCALE_RULES:
        new_out, n = pat.subn(repl, out)
        edits += n
        out = new_out

    # Table-context-dependent rules (cost, duration_min). Split on UNION
    # so each half resolves against its own FROM/JOIN context.
    parts = re.split(r"(\bUNION(?:\s+ALL)?\b)", out, flags=re.IGNORECASE)
    rebuilt: list[str] = []
    for part in parts:
        if re.match(r"^\s*UNION", part, re.IGNORECASE):
            rebuilt.append(part)
            continue
        new_part, n = _apply_table_dependent_rules(part)
        rebuilt.append(new_part)
        edits += n
    out = "".join(rebuilt)

    # vehicle_states current-state pattern.
    if "vehicle_states" in out:
        new_out, n = VEHICLE_STATES_CURRENT_RE.subn(_vstates_current_repl, out)
        edits += n
        out = new_out

    # Dropped tables → empty stubs (or derived view for daily_mileage).
    for pat, repl in DROPPED_TABLE_RULES:
        new_out, n = pat.subn(repl, out)
        edits += n
        out = new_out

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
