#!/usr/bin/env python3
"""Compare the vendored vehicle schema with a pinned upstream revision."""

import argparse
import hashlib
import re
from pathlib import Path


def block(source: str, declaration: str) -> str:
    match = re.search(rf"\b{declaration}\s*\{{", source)
    if not match:
        raise ValueError(f"missing {declaration} declaration")
    start = match.end()
    depth = 1
    for index in range(start, len(source)):
        if source[index] == "{":
            depth += 1
        elif source[index] == "}":
            depth -= 1
            if depth == 0:
                return source[start:index]
    raise ValueError(f"unterminated {declaration} declaration")


def entries(source: str, declaration: str, pattern: str) -> dict[str, str]:
    source = re.sub(r"/\*.*?\*/|//[^\n]*", "", source, flags=re.DOTALL)
    return {name: value for name, value in re.findall(pattern, block(source, declaration))}


def differences(old: dict[str, str], new: dict[str, str]) -> list[str]:
    changes = [f"+ `{name}` = {new[name]}" for name in sorted(new.keys() - old.keys())]
    changes += [f"- `{name}` = {old[name]}" for name in sorted(old.keys() - new.keys())]
    changes += [
        f"~ `{name}`: {old[name]} -> {new[name]}"
        for name in sorted(old.keys() & new.keys())
        if old[name] != new[name]
    ]
    return changes or ["No entries changed (inspect other schema declarations)."]


def report(vendored: bytes, upstream: bytes, commit: str) -> tuple[bool, str]:
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("upstream revision must be a full commit SHA")
    local_hash = hashlib.sha256(vendored).hexdigest()
    remote_hash = hashlib.sha256(upstream).hexdigest()
    if local_hash == remote_hash:
        return False, "Vendored Tesla vehicle_data.proto matches upstream.\n"

    old, new = vendored.decode("utf-8"), upstream.decode("utf-8")
    fields = r"\b(\w+)\s*=\s*(\d+)\s*;"
    variants = r"\b(\w+\s+\w+)\s*=\s*(\d+)\s*;"
    field_changes = differences(entries(old, "enum Field", fields), entries(new, "enum Field", fields))
    variant_changes = differences(
        entries(old, "oneof value", variants), entries(new, "oneof value", variants)
    )
    body = (
        "Upstream Tesla Fleet Telemetry `vehicle_data.proto` differs from the vendored copy.\n\n"
        f"- Upstream revision: [`{commit}`](https://github.com/teslamotors/fleet-telemetry/blob/{commit}/protos/vehicle_data.proto)\n"
        f"- Vendored SHA256: `{local_hash}`\n"
        f"- Upstream SHA256: `{remote_hash}`\n\n"
        "### Field identifiers\n" + "\n".join(field_changes) + "\n\n"
        "### Value oneof variants\n" + "\n".join(variant_changes) + "\n\n"
        "Review the [upstream schema](https://github.com/teslamotors/fleet-telemetry/commits/main/protos/vehicle_data.proto)"
        " for enum/type/semantic changes not shown above. Re-vendor the proto,"
        " update its provenance and the Go module, regenerate the protomodel,"
        " classify and route every new field, then run the pipeline coverage tests.\n"
    )
    return True, body


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vendored", type=Path, default=Path("api/proto/tesla/vehicle_data.proto"))
    parser.add_argument("--upstream", type=Path, required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    changed, body = report(args.vendored.read_bytes(), args.upstream.read_bytes(), args.commit)
    args.report.write_text(body, encoding="utf-8")
    print("DRIFT" if changed else "IN_SYNC")
    print(body)
    raise SystemExit(2 if changed else 0)


if __name__ == "__main__":
    main()
