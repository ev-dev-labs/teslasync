#!/usr/bin/env python3
"""Partition every Go package and merge complete, validated race/coverage shards."""

import argparse
import json
import re
import subprocess
from pathlib import Path


def discover():
    output = subprocess.check_output(["go", "list", "-race", "-json", "./..."], text=True, encoding="utf-8")
    decoder = json.JSONDecoder()
    packages = []
    while output.strip():
        package, end = decoder.raw_decode(output.lstrip())
        output = output.lstrip()[end:]
        files = package.get("TestGoFiles", []) + package.get("XTestGoFiles", [])
        weight = 1 + sum((Path(package["Dir"]) / name).stat().st_size for name in files)
        packages.append((package["ImportPath"], weight))
    return packages


def partition(packages, count):
    names = [name for name, _ in packages]
    if count < 1 or count > len(names) or len(set(names)) != len(names):
        raise ValueError("shards require distinct packages and a nonempty partition")
    shards = [[] for _ in range(count)]
    weights = [0] * count
    # Large test packages start first; stable tie-breaking is identical on every runner.
    for name, weight in sorted(packages, key=lambda item: (-item[1], item[0])):
        index = min(range(count), key=lambda i: (weights[i], i))
        shards[index].append(name)
        weights[index] += weight
    return [sorted(shard) for shard in shards]


def merge(root, expected, output):
    count = len(expected)
    directories = {path.name for path in root.iterdir()}
    if directories != {f"backend-test-{i}" for i in range(1, count + 1)}:
        raise ValueError("missing or unexpected backend shard artifacts")
    blocks = {}
    events = []
    for index, packages in enumerate(expected, 1):
        directory = root / f"backend-test-{index}"
        manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
        if manifest != {"index": index, "count": count, "packages": packages}:
            raise ValueError(f"shard {index}: package manifest differs from discovery")
        terminal = set()
        for line in (directory / "test-events.json").read_text(encoding="utf-8").splitlines():
            event = json.loads(line)
            package = event.get("Package")
            if package and package not in packages:
                raise ValueError(f"shard {index}: unexpected test package {package}")
            if event.get("Action") == "fail":
                raise ValueError(f"shard {index}: failing test event")
            if not event.get("Test") and event.get("Action") in {"pass", "skip"}:
                terminal.add(package)
            events.append(line)
        if terminal != set(packages):
            raise ValueError(f"shard {index}: incomplete package test events")
        profile = (directory / "coverage.out").read_text(encoding="utf-8").splitlines()
        if not profile or profile[0] != "mode: atomic":
            raise ValueError(f"shard {index}: expected atomic coverage profile")
        for line in profile[1:]:
            match = re.fullmatch(r"(.+:\d+\.\d+,\d+\.\d+) (\d+) (\d+)", line)
            if not match:
                raise ValueError(f"shard {index}: malformed coverage block")
            key, statements, hits = match.groups()
            statements, hits = int(statements), int(hits)
            if key in blocks and blocks[key][0] != statements:
                raise ValueError(f"shard {index}: inconsistent coverage block {key}")
            blocks[key] = (statements, hits + blocks.get(key, (0, 0))[1])
    if not blocks:
        raise ValueError("merged coverage is empty")
    output.mkdir(parents=True, exist_ok=True)
    (output / "coverage.out").write_text(
        "mode: atomic\n"
        + "".join(f"{key} {statements} {hits}\n" for key, (statements, hits) in sorted(blocks.items())),
        encoding="utf-8",
    )
    (output / "test-events.json").write_text("\n".join(events) + "\n", encoding="utf-8")
    print(f"Merged {count} shards: {sum(map(len, expected))} packages, {len(blocks)} coverage blocks")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["plan", "merge"])
    parser.add_argument("--count", type=int, required=True)
    parser.add_argument("--index", type=int)
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    shards = partition(discover(), args.count)
    if args.command == "merge":
        if args.input is None:
            parser.error("merge requires --input")
        merge(args.input, shards, args.output)
        return
    if args.index is None or not 1 <= args.index <= args.count:
        parser.error("plan requires --index in 1..count")
    packages = shards[args.index - 1]
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "packages.txt").write_text("\n".join(packages) + "\n", encoding="utf-8")
    (args.output / "manifest.json").write_text(json.dumps({
        "index": args.index, "count": args.count, "packages": packages,
    }), encoding="utf-8")
    print(f"Shard {args.index}/{args.count}: {len(packages)} packages")


if __name__ == "__main__":
    main()
