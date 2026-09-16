"""Behavioral dashboard checks using transaction-local fixtures, never fleet data.

Run with TESLASYNC_GRAFANA_SQL_TEST=1 against the local Compose PostgreSQL.
"""
import json
import os
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(os.environ.get("TESLASYNC_GRAFANA_SQL_TEST") == "1", "requires local Compose PostgreSQL")
class DashboardAnalysisTests(unittest.TestCase):
    def query(self, dashboard, title, rows):
        document = json.loads((ROOT / "grafana" / "dashboards" / "system" / f"{dashboard}.json").read_text(encoding="utf-8"))
        panel = next(p for p in document["panels"] if p["title"] == title)
        sql = panel["targets"][0]["rawSql"].replace("${vehicle_id}", "1")
        sql = re.sub(r"\$__timeFilter\(([^)]+)\)", r"(\1 >= '2026-01-01'::timestamptz AND \1 < '2026-01-02'::timestamptz)", sql)
        inserts = []
        for seconds, field, value in rows:
            column = "str_value" if isinstance(value, str) else "float_value"
            literal = "'" + value.replace("'", "''") + "'" if isinstance(value, str) else str(value)
            inserts.append(f"INSERT INTO signal_log(vehicle_id,ts,field,{column}) VALUES (1,'2026-01-01'::timestamptz+INTERVAL '{seconds} seconds','{field}',{literal});")
        request = """BEGIN;
SET LOCAL statement_timeout='5s';
CREATE TEMP TABLE signal_log(vehicle_id bigint,ts timestamptz,field text,float_value double precision,str_value text,bool_value boolean) ON COMMIT DROP;
""" + "\n".join(inserts) + "\n" + sql + ";\nROLLBACK;"
        result = subprocess.run(
            ["docker", "exec", "-i", "teslasync-postgres", "sh", "-c",
             'psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
            input=request, text=True, encoding="utf-8", capture_output=True, timeout=15,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def test_irregular_cadence_integrates_real_elapsed_time(self):
        rows = [(0, "Gear", "D")]
        for sec in (0, 7, 20):
            rows.extend([(sec, "PackVoltage", 400), (sec, "PackCurrent", -100)])
        self.assertAlmostEqual(float(self.query("physics-ledger", "Observed drive Wh (partial aligned coverage)", rows)), 222.2)
        rows.append((6, "Gear", "P"))
        self.assertEqual(self.query("physics-ledger", "Observed drive Wh (partial aligned coverage)", rows), "")

    def test_latch_release_is_not_unplug(self):
        rows = [(0, "ChargePortLatch", "Engaged"), (7, "ChargePortLatch", "Disengaged")]
        self.assertEqual(self.query("black-box-90s", "Disconnected observations", rows), "0")
        rows.append((8, "DetailedChargeState", "Disconnected"))
        self.assertEqual(self.query("black-box-90s", "Disconnected observations", rows), "1")

    def test_park_energy_change_keeps_sign_and_actual_duration(self):
        rows = [(0, "Gear", "P"), (0, "DetailedChargeState", "Disconnected"),
                (0, "EnergyRemaining", 40000), (60, "EnergyRemaining", 39900),
                (120, "EnergyRemaining", 40100)]
        self.assertAlmostEqual(float(self.query("vampire-watts", "Avg parked watts", rows)), -3000)
        self.assertAlmostEqual(float(self.query("vampire-watts", "Parked Wh lost", rows)), -100)

    def test_latest_range_uses_distinct_estimators(self):
        rows = [(0, "RatedRange", 10000), (0, "EstBatteryRange", 11000),
                (0, "IdealBatteryRange", 12000), (5, "RatedRange", 10000),
                (10, "RatedRange", 10000), (15, "RatedRange", 10000)]
        self.assertGreater(float(self.query("range-disagreement", "Spread (latest)", rows)), 0)


if __name__ == "__main__":
    unittest.main()
