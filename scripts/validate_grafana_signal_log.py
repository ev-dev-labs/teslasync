#!/usr/bin/env python3
"""
Validate every signal_log-referencing rawSql in the system dashboards
against the live Postgres. Substitutes Grafana macros with concrete
values then runs EXPLAIN — anything that returns an error is reported.

Macros substituted:
    ${vehicle_id}            -> 1
    $__timeFrom()            -> NOW() - INTERVAL '7 day'
    $__timeTo()              -> NOW()
    $__timeFilter(col)       -> col BETWEEN NOW() - INTERVAL '7 day' AND NOW()
    $__timeGroup(col, '1m')  -> time_bucket('1 minute', col)
    $__timeGroup(col, '1h')  -> time_bucket('1 hour', col)
    $__timeGroup(col, '1d')  -> time_bucket('1 day', col)
    $__timeGroup(col, '1M')  -> date_trunc('month', col)
    $__timeGroup(col, '1w')  -> date_trunc('week', col)
"""

import json
import re
import subprocess
import sys
from pathlib import Path

DASHBOARD_DIR = Path(__file__).resolve().parent.parent / "grafana" / "dashboards" / "system"
PSQL = ["docker", "exec", "-i", "teslasync-postgres",
        "psql", "-U", "teslasync", "-d", "teslasync",
        "-v", "ON_ERROR_STOP=1", "-X", "-q", "-f", "-"]


def substitute_macros(sql: str) -> str:
    sql = re.sub(r"\$\{vehicle_id(?::[^}]*)?\}", "1", sql)
    sql = re.sub(r"\$\{drive_id(?::[^}]*)?\}", "1", sql)
    sql = re.sub(r"\$\{session_id(?::[^}]*)?\}", "1", sql)
    sql = re.sub(r"\$\{unit_length(?::[^}]*)?\}", "mi", sql)
    sql = re.sub(r"\$\{unit_temp(?::[^}]*)?\}", "°F", sql)
    sql = re.sub(r"\$\{route_start(?::[^}]*)?\}", "'Home'", sql)
    sql = re.sub(r"\$\{route_end(?::[^}]*)?\}", "'Work'", sql)
    sql = re.sub(r"\$\{__from(?::[^}]*)?\}", "(NOW() - INTERVAL '7 day')", sql)
    sql = re.sub(r"\$\{__to(?::[^}]*)?\}", "(NOW())", sql)
    sql = re.sub(r"\$__timeFrom\(\)", "(NOW() - INTERVAL '7 day')", sql)
    sql = re.sub(r"\$__timeTo\(\)", "(NOW())", sql)

    def tf(m: re.Match) -> str:
        return f"{m.group(1)} BETWEEN NOW() - INTERVAL '7 day' AND NOW()"
    sql = re.sub(r"\$__timeFilter\(([^)]+)\)", tf, sql)

    bucket_map = {
        "1m": "1 minute", "5m": "5 minutes", "10m": "10 minutes",
        "15m": "15 minutes", "30m": "30 minutes", "1h": "1 hour",
        "1d": "1 day", "1w": "1 week", "1M": "month", "1y": "year",
    }

    def tg(m: re.Match) -> str:
        col, unit = m.group(1).strip(), m.group(2).strip().strip("'\"")
        if unit in ("1M", "1y", "1w"):
            dt_unit = bucket_map[unit]
            return f"date_trunc('{dt_unit}', {col})"
        return f"time_bucket('{bucket_map.get(unit, '1 hour')}', {col})"
    sql = re.sub(r"\$__timeGroup\(([^,]+),\s*([^)]+)\)", tg, sql)
    sql = sql.replace("$__interval", "'5 minutes'")

    return sql


def explain(sql: str) -> tuple[bool, str]:
    payload = f"EXPLAIN {sql}\n"
    res = subprocess.run(PSQL, input=payload, capture_output=True, text=True,
                         encoding="utf-8")
    if res.returncode == 0:
        return True, ""
    err = (res.stderr or "").strip()
    # Flatten so each failure is one line in the report.
    return False, " | ".join(line.strip() for line in err.splitlines()
                             if line.strip())


def walk(panel: dict):
    for tgt in panel.get("targets", []):
        sql = tgt.get("rawSql")
        if isinstance(sql, str) and sql.strip():
            yield panel.get("title", "<no title>"), tgt.get("refId", "?"), sql
    for sub in panel.get("panels", []):
        yield from walk(sub)


def main() -> int:
    failures = []
    total = 0
    for jf in sorted(DASHBOARD_DIR.glob("*.json")):
        with open(jf, "r", encoding="utf-8") as f:
            doc = json.load(f)
        for panel in doc.get("panels", []):
            for title, ref, sql in walk(panel):
                total += 1
                ok, err = explain(substitute_macros(sql))
                if not ok:
                    failures.append((jf.name, title, ref, err, sql))
        # Also validate template variable queries.
        for var in doc.get("templating", {}).get("list", []) or []:
            for key in ("definition", "query"):
                sql = var.get(key)
                if not isinstance(sql, str) or not sql.strip():
                    continue
                # Skip non-SQL queries (some vars use Grafana metric names).
                low = sql.lower()
                if "select" not in low and "show" not in low:
                    continue
                total += 1
                ok, err = explain(substitute_macros(sql))
                if not ok:
                    failures.append((jf.name, f"$var:{var.get('name','?')}", key, err, sql))

    print(f"Validated {total} dashboard SQL queries")
    print(f"Failures  : {len(failures)}")
    print()
    for fname, title, ref, err, sql in failures:
        safe_title = title.encode("ascii", errors="replace").decode("ascii")
        print(f"  {fname}  panel='{safe_title}'  ref={ref}")
        print(f"    ERR: {err[:300]}")
        print()
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
