#!/usr/bin/env python3
"""Render an extensive GitHub Actions job summary from Go test + cover data.

The previous CI summary listed the *highest* package percentages (almost
all 100%), which hid gaps and never mentioned failing tests. This script
leads with failures, then lowest-coverage packages/files/functions.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

MODULE = "github.com/ev-dev-labs/teslasync/"
COVER_LINE = re.compile(
    r"^(?P<file>.+):(?P<start>\d+\.\d+),(?P<end>\d+\.\d+) (?P<stmts>\d+) (?P<count>\d+)$"
)
FUNC_LINE = re.compile(
    r"^(?P<file>.+):(?P<line>\d+):\s+(?P<name>\S+)\s+(?P<pct>[\d.]+)%$"
)


@dataclass
class Block:
    file: str
    stmts: int
    covered: int


@dataclass
class Func:
    file: str
    name: str
    pct: float


@dataclass
class TestEvent:
    action: str
    package: str
    test: str = ""
    elapsed: float = 0.0
    output: str = ""


@dataclass
class Report:
    blocks: list[Block] = field(default_factory=list)
    funcs: list[Func] = field(default_factory=list)
    events: list[TestEvent] = field(default_factory=list)


def short_pkg(path: str) -> str:
    rel = path
    if rel.startswith(MODULE):
        rel = rel[len(MODULE) :]
    if rel.endswith(".go"):
        rel = rel.rsplit("/", 1)[0]
    return rel or path


def layer_of(pkg: str) -> str:
    parts = pkg.split("/")
    if not parts:
        return "other"
    if parts[0] == "cmd":
        return "cmd"
    if parts[0] == "tools":
        return "tools"
    if parts[0] == "internal" and len(parts) > 1:
        return f"internal/{parts[1]}"
    return parts[0]


def pct(covered: int, total: int) -> float:
    if total <= 0:
        return 100.0
    return 100.0 * covered / total


def parse_coverprofile(text: str) -> list[Block]:
    out: list[Block] = []
    for raw in text.splitlines():
        if raw.startswith("mode:") or not raw.strip():
            continue
        m = COVER_LINE.match(raw)
        if not m:
            continue
        stmts = int(m.group("stmts"))
        count = int(m.group("count"))
        out.append(
            Block(
                file=m.group("file"),
                stmts=stmts,
                covered=stmts if count > 0 else 0,
            )
        )
    return out


def parse_func(text: str) -> list[Func]:
    out: list[Func] = []
    for raw in text.splitlines():
        if raw.startswith("total:"):
            continue
        m = FUNC_LINE.match(raw)
        if not m:
            continue
        out.append(
            Func(
                file=m.group("file"),
                name=m.group("name"),
                pct=float(m.group("pct")),
            )
        )
    return out


def parse_test_json(text: str) -> list[TestEvent]:
    events: list[TestEvent] = []
    for raw in text.splitlines():
        raw = raw.strip()
        if not raw:
            continue
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError:
            continue
        action = str(obj.get("Action") or "")
        if action not in {"pass", "fail", "skip", "output"}:
            continue
        events.append(
            TestEvent(
                action=action,
                package=str(obj.get("Package") or ""),
                test=str(obj.get("Test") or ""),
                elapsed=float(obj.get("Elapsed") or 0),
                output=str(obj.get("Output") or ""),
            )
        )
    return events


def load_report(profile: Path | None, func_path: Path | None, json_path: Path | None) -> Report:
    r = Report()
    if profile and profile.exists():
        r.blocks = parse_coverprofile(profile.read_text(encoding="utf-8", errors="replace"))
    if func_path and func_path.exists():
        r.funcs = parse_func(func_path.read_text(encoding="utf-8", errors="replace"))
    if json_path and json_path.exists():
        r.events = parse_test_json(json_path.read_text(encoding="utf-8", errors="replace"))
    return r


def aggregate_files(blocks: Iterable[Block]) -> dict[str, tuple[int, int]]:
    acc: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for b in blocks:
        acc[b.file][0] += b.stmts
        acc[b.file][1] += b.covered
    return {k: (v[0], v[1]) for k, v in acc.items()}


def aggregate_packages(files: dict[str, tuple[int, int]]) -> dict[str, tuple[int, int]]:
    acc: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for file, (stmts, covered) in files.items():
        pkg = short_pkg(file)
        acc[pkg][0] += stmts
        acc[pkg][1] += covered
    return {k: (v[0], v[1]) for k, v in acc.items()}


def aggregate_layers(packages: dict[str, tuple[int, int]]) -> dict[str, tuple[int, int]]:
    acc: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for pkg, (stmts, covered) in packages.items():
        layer = layer_of(pkg)
        acc[layer][0] += stmts
        acc[layer][1] += covered
    return {k: (v[0], v[1]) for k, v in acc.items()}


def band(p: float) -> str:
    if p >= 100:
        return "100%"
    if p >= 80:
        return "80–99%"
    if p >= 50:
        return "50–79%"
    if p > 0:
        return "1–49%"
    return "0%"


def md_table(headers: list[str], rows: list[list[str]]) -> list[str]:
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(row) + " |")
    return lines


def fmt_pct(p: float) -> str:
    return f"{p:.1f}%"


def rel_file(path: str) -> str:
    if path.startswith(MODULE):
        return path[len(MODULE) :]
    return path


def test_outcome(report: Report) -> dict[str, object]:
    failed_tests: list[tuple[str, str]] = []
    passed_tests = 0
    skipped_tests = 0
    failed_pkgs: list[str] = []
    passed_pkgs = 0
    skipped_pkgs = 0
    slow: list[tuple[float, str, str]] = []
    fail_output: dict[tuple[str, str], list[str]] = defaultdict(list)

    for ev in report.events:
        if ev.action == "output" and ev.test:
            fail_output[(ev.package, ev.test)].append(ev.output)
            continue
        if ev.test:
            if ev.action == "fail":
                failed_tests.append((ev.package, ev.test))
                slow.append((ev.elapsed, ev.package, ev.test))
            elif ev.action == "pass":
                passed_tests += 1
                slow.append((ev.elapsed, ev.package, ev.test))
            elif ev.action == "skip":
                skipped_tests += 1
            continue
        if ev.action == "fail" and ev.package:
            failed_pkgs.append(ev.package)
        elif ev.action == "pass" and ev.package:
            passed_pkgs += 1
        elif ev.action == "skip" and ev.package:
            skipped_pkgs += 1

    slow.sort(reverse=True)
    snippets: dict[tuple[str, str], str] = {}
    for key in failed_tests:
        buf = "".join(fail_output.get(key, []))
        lines = [ln.rstrip() for ln in buf.splitlines() if ln.strip()]
        # Keep FAIL lines and assertion context, drop RUN noise.
        keep = [
            ln
            for ln in lines
            if not ln.startswith("=== RUN") and not ln.startswith("=== PAUSE")
        ]
        snippets[key] = "\n".join(keep[-24:])
    return {
        "failed_tests": failed_tests,
        "passed_tests": passed_tests,
        "skipped_tests": skipped_tests,
        "failed_pkgs": failed_pkgs,
        "passed_pkgs": passed_pkgs,
        "skipped_pkgs": skipped_pkgs,
        "slow": slow[:15],
        "snippets": snippets,
    }


def render(report: Report) -> str:
    files = aggregate_files(report.blocks)
    packages = aggregate_packages(files)
    layers = aggregate_layers(packages)
    total_stmts = sum(s for s, _ in files.values())
    total_cov = sum(c for _, c in files.values())
    overall = pct(total_cov, total_stmts)
    outcome = test_outcome(report)

    lines: list[str] = []
    lines.append("## Backend tests")
    lines.append("")

    failed_tests: list[tuple[str, str]] = outcome["failed_tests"]  # type: ignore[assignment]
    failed_pkgs: list[str] = outcome["failed_pkgs"]  # type: ignore[assignment]
    if failed_tests or failed_pkgs:
        lines.append("### Failures — start here")
        lines.append("")
        lines.append(
            f"**{len(failed_tests)} test(s)** failed in **{len(failed_pkgs)} package(s)**."
        )
        lines.append("New red tests show up in this section on the next run.")
        lines.append("")
        rows = []
        for pkg, name in failed_tests[:80]:
            rows.append([f"`{name}`", f"`{short_pkg(pkg)}`"])
        if rows:
            lines.extend(md_table(["Test", "Package"], rows))
            lines.append("")
        snippets: dict[tuple[str, str], str] = outcome["snippets"]  # type: ignore[assignment]
        shown = 0
        for key in failed_tests:
            snippet = snippets.get(key, "").strip()
            if not snippet:
                continue
            pkg, name = key
            lines.append(f"<details><summary>Log: `{name}` (`{short_pkg(pkg)}`)</summary>")
            lines.append("")
            lines.append("```")
            lines.append(snippet[:4000])
            lines.append("```")
            lines.append("</details>")
            lines.append("")
            shown += 1
            if shown >= 12:
                break
        if len(failed_tests) > 80:
            lines.append(f"_…and {len(failed_tests) - 80} more failing tests._")
            lines.append("")
    else:
        lines.append(
            f"**All reported tests passed** "
            f"({outcome['passed_tests']} pass, {outcome['skipped_tests']} skip, "
            f"{outcome['passed_pkgs']} packages)."
        )
        lines.append("")

    lines.append("| Result | Tests | Packages |")
    lines.append("| --- | ---: | ---: |")
    lines.append(
        f"| Fail | {len(failed_tests)} | {len(failed_pkgs)} |"
    )
    lines.append(
        f"| Pass | {outcome['passed_tests']} | {outcome['passed_pkgs']} |"
    )
    lines.append(
        f"| Skip | {outcome['skipped_tests']} | {outcome['skipped_pkgs']} |"
    )
    lines.append("")

    slow: list[tuple[float, str, str]] = outcome["slow"]  # type: ignore[assignment]
    if slow:
        lines.append("<details><summary>Slowest tests</summary>")
        lines.append("")
        lines.extend(
            md_table(
                ["Seconds", "Test", "Package"],
                [
                    [f"{elapsed:.2f}", f"`{name}`", f"`{short_pkg(pkg)}`"]
                    for elapsed, pkg, name in slow
                    if name
                ],
            )
        )
        lines.append("")
        lines.append("</details>")
        lines.append("")

    lines.append("## Backend coverage")
    lines.append("")
    if total_stmts == 0:
        lines.append("_No coverage profile was produced for this run._")
        lines.append("")
        return "\n".join(lines).rstrip() + "\n"
    lines.append(
        f"**{fmt_pct(overall)}** of statements covered "
        f"(`{total_cov} / {total_stmts}`)."
    )
    lines.append("")
    lines.append(
        "Lowest packages and files are listed first. "
        "HTML + per-function reports are on the **backend-coverage** artifact."
    )
    lines.append("")

    band_counts: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for stmts, covered in packages.values():
        b = band(pct(covered, stmts))
        band_counts[b][0] += 1
        band_counts[b][1] += stmts
    order = ["0%", "1–49%", "50–79%", "80–99%", "100%"]
    lines.append("### Package coverage bands")
    lines.append("")
    lines.extend(
        md_table(
            ["Band", "Packages", "Statements"],
            [
                [b, str(band_counts[b][0]), str(band_counts[b][1])]
                for b in order
                if band_counts[b][0]
            ],
        )
    )
    lines.append("")

    if layers:
        lines.append("### Coverage by area")
        lines.append("")
        layer_rows = []
        for name, (stmts, covered) in sorted(
            layers.items(), key=lambda kv: pct(kv[1][1], kv[1][0])
        ):
            layer_rows.append(
                [
                    f"`{name}`",
                    fmt_pct(pct(covered, stmts)),
                    str(covered),
                    str(stmts),
                    str(stmts - covered),
                ]
            )
        lines.extend(
            md_table(["Area", "Covered", "Hit", "Stmts", "Missed"], layer_rows)
        )
        lines.append("")

    ranked_pkgs = sorted(
        packages.items(),
        key=lambda kv: (pct(kv[1][1], kv[1][0]), -(kv[1][0] - kv[1][1]), kv[0]),
    )
    lowest = [(p, s, c) for p, (s, c) in ranked_pkgs if s > 0 and pct(c, s) < 100][:40]
    if lowest:
        lines.append("### Lowest packages (actionable)")
        lines.append("")
        lines.extend(
            md_table(
                ["Covered", "Hit", "Stmts", "Missed", "Package"],
                [
                    [
                        fmt_pct(pct(c, s)),
                        str(c),
                        str(s),
                        str(s - c),
                        f"`{p}`",
                    ]
                    for p, s, c in lowest
                ],
            )
        )
        lines.append("")

    ranked_files = sorted(
        files.items(),
        key=lambda kv: (pct(kv[1][1], kv[1][0]), -(kv[1][0] - kv[1][1]), kv[0]),
    )
    low_files = [
        (f, s, c) for f, (s, c) in ranked_files if s > 0 and pct(c, s) < 100
    ][:30]
    if low_files:
        lines.append("### Lowest files")
        lines.append("")
        lines.extend(
            md_table(
                ["Covered", "Missed", "File"],
                [
                    [fmt_pct(pct(c, s)), str(s - c), f"`{rel_file(f)}`"]
                    for f, s, c in low_files
                ],
            )
        )
        lines.append("")

    low_funcs = sorted(
        [fn for fn in report.funcs if fn.pct < 100],
        key=lambda fn: (fn.pct, fn.file, fn.name),
    )[:30]
    if low_funcs:
        lines.append("### Lowest functions")
        lines.append("")
        lines.extend(
            md_table(
                ["Covered", "Function", "File"],
                [
                    [fmt_pct(fn.pct), f"`{fn.name}`", f"`{rel_file(fn.file)}`"]
                    for fn in low_funcs
                ],
            )
        )
        lines.append("")

    zero = [p for p, (s, c) in ranked_pkgs if s > 0 and c == 0]
    full = [p for p, (s, c) in ranked_pkgs if s > 0 and c == s]
    if zero:
        lines.append(f"<details><summary>Zero-coverage packages ({len(zero)})</summary>")
        lines.append("")
        for p in zero[:80]:
            lines.append(f"- `{p}`")
        if len(zero) > 80:
            lines.append(f"- …and {len(zero) - 80} more")
        lines.append("")
        lines.append("</details>")
        lines.append("")
    if full:
        lines.append(
            f"<details><summary>Fully covered packages ({len(full)})</summary>"
        )
        lines.append("")
        for p in full[:80]:
            lines.append(f"- `{p}`")
        if len(full) > 80:
            lines.append(f"- …and {len(full) - 80} more")
        lines.append("")
        lines.append("</details>")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def write_package_table(packages: dict[str, tuple[int, int]], dest: Path) -> None:
    rows = sorted(
        packages.items(),
        key=lambda kv: (pct(kv[1][1], kv[1][0]), kv[0]),
    )
    lines = ["coverage  stmts  covered  missed  package"]
    for pkg, (stmts, covered) in rows:
        lines.append(
            f"{pct(covered, stmts):7.2f}%  {stmts:5d}  {covered:7d}  {stmts - covered:6d}  {pkg}"
        )
    dest.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_file_table(files: dict[str, tuple[int, int]], dest: Path) -> None:
    rows = sorted(
        files.items(),
        key=lambda kv: (pct(kv[1][1], kv[1][0]), kv[0]),
    )
    lines = ["coverage  stmts  covered  missed  file"]
    for file, (stmts, covered) in rows:
        lines.append(
            f"{pct(covered, stmts):7.2f}%  {stmts:5d}  {covered:7d}  {stmts - covered:6d}  {rel_file(file)}"
        )
    dest.write_text("\n".join(lines) + "\n", encoding="utf-8")


SELF_TEST_PROFILE = """mode: set
github.com/ev-dev-labs/teslasync/internal/api/foo/a.go:10.1,12.2 5 1
github.com/ev-dev-labs/teslasync/internal/api/foo/a.go:12.2,14.3 5 0
github.com/ev-dev-labs/teslasync/internal/models/alert/alert.go:1.1,2.2 10 10
github.com/ev-dev-labs/teslasync/cmd/teslasync/main.go:1.1,2.2 4 0
"""

SELF_TEST_FUNC = """github.com/ev-dev-labs/teslasync/internal/api/foo/a.go:10:\tServeHTTP\t50.0%
github.com/ev-dev-labs/teslasync/internal/models/alert/alert.go:1:\tValidate\t100.0%
github.com/ev-dev-labs/teslasync/cmd/teslasync/main.go:1:\tmain\t0.0%
total:\t\t(statements)\t60.0%
"""

SELF_TEST_JSON = """
{"Action":"fail","Package":"github.com/ev-dev-labs/teslasync/internal/api/foo","Test":"TestWakeUp","Elapsed":0.04}
{"Action":"output","Package":"github.com/ev-dev-labs/teslasync/internal/api/foo","Test":"TestWakeUp","Output":"    client_test.go:250: status 408\\n"}
{"Action":"fail","Package":"github.com/ev-dev-labs/teslasync/internal/api/foo","Elapsed":0.2}
{"Action":"pass","Package":"github.com/ev-dev-labs/teslasync/internal/models/alert","Test":"TestValidate","Elapsed":0.01}
{"Action":"pass","Package":"github.com/ev-dev-labs/teslasync/internal/models/alert","Elapsed":0.02}
"""


def self_test() -> None:
    report = Report(
        blocks=parse_coverprofile(SELF_TEST_PROFILE),
        funcs=parse_func(SELF_TEST_FUNC),
        events=parse_test_json(SELF_TEST_JSON),
    )
    md = render(report)
    assert "Failures — start here" in md, md
    assert "TestWakeUp" in md, md
    assert "Lowest packages" in md, md
    assert "cmd" in md, md
    assert "0.0%" in md or "0%" in md
    files = aggregate_files(report.blocks)
    pkgs = aggregate_packages(files)
    assert pkgs["cmd/teslasync"][1] == 0
    assert pkgs["internal/models/alert"][1] == 10
    print("backend_coverage_summary self-test OK")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--profile", type=Path, help="go coverprofile (coverage.out)")
    p.add_argument("--func", type=Path, dest="func_path", help="go tool cover -func output")
    p.add_argument("--json", type=Path, dest="json_path", help="go test -json NDJSON")
    p.add_argument("--summary", type=Path, help="append markdown (GITHUB_STEP_SUMMARY)")
    p.add_argument("--markdown-out", type=Path, help="write markdown file")
    p.add_argument("--package-out", type=Path)
    p.add_argument("--file-out", type=Path)
    p.add_argument("--self-test", action="store_true")
    args = p.parse_args(argv)

    if args.self_test:
        self_test()
        return 0

    report = load_report(args.profile, args.func_path, args.json_path)
    md = render(report)
    if args.markdown_out:
        args.markdown_out.write_text(md, encoding="utf-8")
    if args.summary:
        with args.summary.open("a", encoding="utf-8") as fh:
            fh.write(md if md.endswith("\n") else md + "\n")
    if not args.summary and not args.markdown_out:
        sys.stdout.write(md)

    files = aggregate_files(report.blocks)
    packages = aggregate_packages(files)
    if args.package_out:
        write_package_table(packages, args.package_out)
    if args.file_out:
        write_file_table(files, args.file_out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
