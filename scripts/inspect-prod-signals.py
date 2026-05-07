"""Inspect prod CSV: find drive + charge windows, show signal value-column usage."""
import csv
import sys
from collections import defaultdict
from datetime import datetime

CSV = r'D:\copilot\teslasync\prod-signals\signal_history_last_7d.csv'

# Signals critical to drive/charging FSM
DRIVE_SIG = {'Gear', 'VehicleSpeed', 'Odometer', 'Location'}
CHARGE_SIG = {'ChargeState', 'DetailedChargeState', 'ChargingActive', 'ACChargingPower',
              'ACChargingEnergyIn', 'ChargeRateMilePerHour', 'ChargeAmps', 'ChargerVoltage',
              'ChargerActualCurrent', 'ChargeLimitSoc'}

cols = defaultdict(lambda: {'num':0,'str':0,'bool':0,'examples':[]})
gear_seq = []   # (ts, value_str, value_num)
chst_seq = []   # (ts, signal, value_str, value_num)

with open(CSV) as f:
    rows = csv.DictReader(f)
    for r in rows:
        s = r['signal']
        if s in DRIVE_SIG | CHARGE_SIG:
            c = cols[s]
            if r['value_num']: c['num'] += 1
            if r['value_str']: c['str'] += 1
            if r['value_bool']: c['bool'] += 1
            if len(c['examples']) < 2:
                c['examples'].append(f"{r['created_at']} num={r['value_num']!r} str={r['value_str']!r} bool={r['value_bool']!r}")
        if s == 'Gear':
            gear_seq.append((r['created_at'], r['value_str'], r['value_num']))
        if s in {'ChargeState','DetailedChargeState','ChargingActive'}:
            chst_seq.append((r['created_at'], s, r['value_str'], r['value_num']))

print("=== Value-column usage by signal ===")
for s in sorted(cols):
    c = cols[s]
    print(f"  {s:30s}  num={c['num']:>6}  str={c['str']:>6}  bool={c['bool']:>6}")
    for e in c['examples']:
        print(f"     {e}")

print(f"\n=== Gear sequence (first 30 of {len(gear_seq)}) ===")
for ts, vs, vn in gear_seq[:30]:
    print(f"  {ts}  str={vs!r}  num={vn!r}")

print(f"\n=== Distinct Gear values seen ===")
distinct_gear = set()
for _, vs, vn in gear_seq:
    distinct_gear.add((vs, vn))
for v in sorted(distinct_gear):
    print(f"  str={v[0]!r}  num={v[1]!r}")

print(f"\n=== Charge state transitions (first 40 of {len(chst_seq)}) ===")
for ts, s, vs, vn in chst_seq[:40]:
    print(f"  {ts}  {s:25s}  str={vs!r}  num={vn!r}")

print(f"\n=== Distinct ChargeState values ===")
distinct_chst = set()
for _, _, vs, vn in chst_seq:
    distinct_chst.add((vs, vn))
for v in sorted(distinct_chst):
    print(f"  str={v[0]!r}  num={v[1]!r}")
