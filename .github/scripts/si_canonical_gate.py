#!/usr/bin/env python3
"""SI canonical gate — Phase-44 / F7.

Inspects /tmp/si.diff (unified=0, added lines only) for new legacy
unit-suffixed identifiers and deprecated frontend conversion callers.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

DIFF_PATH = Path("/tmp/si.diff")

ALLOWED_PREFIXES = [
    "internal/ai/tools/",
    "internal/api/ai_watch_face_nl_response_handler",
    "internal/api/range_projection_handler",
    "docs/",
    "migrations/",
]

BANNED = [
    re.compile(r"\b\w*(?:Distance|Range|Odometer|StartOdometer|EndOdometer)Mi\b"),
    re.compile(r"\b\w*(?:Duration|Idle|Active)Min\b"),
    re.compile(
        r"\b\w*(?:Energy|Charge|Regen|EnergyUsed|EnergyAdded|EnergyDelivered)Kwh\b"
    ),
    re.compile(r"\b\w*(?:Power|AvgPower|MaxPower|ChargerPower)Kw\b"),
    re.compile(r"\b\w*(?:Speed|AvgSpeed|MaxSpeed|GroundSpeed)Mph\b"),
    re.compile(r"\b\w*(?:Pressure|TirePressure)Psi\b"),
    re.compile(r"\b\w*(?:Temp|Temperature|InsideTemp|OutsideTemp)F\b"),
    re.compile(r'json:"\w*_(?:mi|min|kwh|kw|mph|psi)"'),
    re.compile(r'json:"\w*_(?:mi|min|kwh|kw|mph|psi),omitempty"'),
    re.compile(
        r"\b\w+_(?:mi|min|kwh|kw|mph|psi)\b\s+(?:NUMERIC|FLOAT|REAL|DOUBLE|INT|BIGINT|SMALLINT)"
    ),
]

DEPRECATED_CALLERS = re.compile(
    r"\b(convertDistance|convertSpeed|convertTemp|convertEfficiency|"
    r"convertPressure|fmtDistance|fmtSpeed|fmtTemp|fmtPressure)\s*\("
)

ALLOWLIST_PATHS = {
    "web/src/lib/unitConversion.ts",
    "web/src/lib/unitConversion.test.ts",
    "web/src/hooks/useSettings.ts",
    "web/src/hooks/useSettings.test.ts",
}

# Tesla Fleet Telemetry Field enum identifiers are upstream-owned (ADR-004 R2).
# Wire names may contain Kwh/Mph even though TeslaSync stores SI (Wh, m/s).
TESLA_PROTO_FIELD_ALLOWLIST = (
    "NominalFullPackEnergyKwh",
    "LifetimeEnergyChargedKwh",
    "MaxSpeedToReachDestinationMph",
    "SemiCruiseSpeedLimitMph",
    "ChargeRateMilePerHour",
)


def iter_added_lines(diff_text: str):
    current_file = None
    for line in diff_text.splitlines():
        if line.startswith("+++ "):
            path = line[6:].strip()
            current_file = None if path == "dev/null" else path
            continue
        if line.startswith("---"):
            continue
        if not line.startswith("+"):
            continue
        if line.startswith("+++"):
            continue
        if current_file is None:
            continue
        yield current_file, line[1:]


def check_go(diff_text: str) -> list[str]:
    violations: list[str] = []
    for current_file, added in iter_added_lines(diff_text):
        if any(current_file.startswith(pfx) for pfx in ALLOWED_PREFIXES):
            continue
        s = added.lstrip()
        if s.startswith("//") or s.startswith("#") or s.startswith("--"):
            continue
        if any(name in added for name in TESLA_PROTO_FIELD_ALLOWLIST):
            continue
        for pat in BANNED:
            if pat.search(added):
                violations.append(f"{current_file}: {added.rstrip()}")
                break
    return violations


def check_fe(diff_text: str) -> list[str]:
    violations: list[str] = []
    for current_file, added in iter_added_lines(diff_text):
        if current_file in ALLOWLIST_PATHS:
            continue
        if not (current_file.endswith(".ts") or current_file.endswith(".tsx")):
            continue
        s = added.lstrip()
        if s.startswith("//") or s.startswith("*"):
            continue
        if DEPRECATED_CALLERS.search(added):
            violations.append(f"{current_file}: {added.rstrip()}")
    return violations


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    diff_text = DIFF_PATH.read_text(encoding="utf-8", errors="replace") if DIFF_PATH.exists() else ""

    if mode in ("go", "all"):
        violations = check_go(diff_text)
        if violations:
            print("SI canonical gate FAILED. The following added lines introduce")
            print("legacy unit-suffixed identifiers (mi/min/kwh/kw/mph/psi).")
            print("Rename them to SI (m/s/wh/w/mps/kpa) per Phase-48 mandate:")
            print()
            for v in violations:
                print(f"  {v}")
            return 1
        print("SI canonical gate PASSED — no new legacy unit-suffixed identifiers added.")

    if mode in ("fe", "all"):
        violations = check_fe(diff_text)
        if violations:
            print("SI canonical gate FAILED. Added lines call @deprecated unit")
            print("conversion helpers. Use useUnits() + SI helpers instead:")
            print()
            for v in violations:
                print(f"  {v}")
            return 1
        print("SI canonical gate (FE) PASSED.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
