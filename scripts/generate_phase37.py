#!/usr/bin/env python3
"""Generate Phase 37 prompt files for Go monolith decomposition.

Source of truth for the 54 atomic prompt files under
.github/prompts/db-refactor/phase-37/. Re-run anytime to regenerate the
entire prompt suite from scratch.

Usage (from repo root):
    Remove-Item .github/prompts/db-refactor/phase-37/*.prompt.md -Force
    python scripts/generate_phase37.py

Review history (each builds on the previous):
  1. Staff Engineer review              (commit e38cef54)
  2. Principal Engineer review          (commit d5a2d59e)
  3. Principal Architect review         (commit 959aa416)
  4. Distinguished Chief Architect      (current)

Editing this file requires regenerating all 54 prompts and committing both
in the same change. The prompts and this generator MUST stay in sync.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PHASE_DIR = ROOT / ".github" / "prompts" / "db-refactor" / "phase-37"
LOG_DIR = ".github/prompts/db-refactor/logs"

CO_AUTHOR = "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"

COVENANT = """<!-- BEGIN COVENANT -->
1. No red-as-green - EXIT != 0 means STATUS=BLOCKED, no exceptions.
2. No scope narrowing - run the exact gate command, no subsets.
3. No skip-and-assume - cannot run gate means BLOCKED, never DONE.
4. No field resurrection - do not add back deleted fields to "fix" things.
5. No stubs - no `return nil`, `// TODO`, or `panic("not impl")`.
6. No delegation - NO sub-agents, NO parallel, NO background tasks.
7. No predecessor bypass - verify predecessor STATUS=DONE first when a predecessor exists.
8. No commit on red - commit only the log when BLOCKED.
9. No silent drift - `git status` outside allowed files means BLOCKED.
10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED> on their own lines.
<!-- END COVENANT -->"""

MECHANICAL_BLOCK = (
    "Mechanical decomposition only. Move cohesive code into new files in the same "
    "package. Do not change behavior, exported names, public APIs, route paths, SQL, "
    "JSON tags, config, migrations, logging semantics, error wrapping, validation "
    "behavior, or runtime ordering. Do not introduce new abstractions unless required "
    "to preserve behavior. Run `gofmt` on touched Go files and targeted `go test` for "
    "the affected package."
)

LOGGING_REQS = (
    "Append the following sections to the log in order: `## PREFLIGHT`, `## SURVEY`, "
    "`## REASONING`, `## CHANGES`, `## GATE`, `## COMMIT`. The GATE section MUST end "
    "with two lines containing exactly `EXIT=<int>` and `STATUS=DONE` or `STATUS=BLOCKED`."
)


def pkg_for(src_fwd: str) -> str:
    parts = src_fwd.split("/")
    if parts[0] == "cmd":
        return "main"
    return parts[-2]


def test_target_for(src_fwd: str) -> str:
    parts = src_fwd.split("/")
    return "./" + "/".join(parts[:-1])


def regex_alt(items):
    escaped = []
    for it in items:
        e = it.replace(".", r"\.")
        e = e.replace("/", r"[\\/]")
        escaped.append(e)
    return "(" + "|".join(escaped) + ")"


def pred_log(num: int, slug: str) -> str:
    return f"{LOG_DIR}/phase-37-{num:02d}-{slug}.log"


def header(num: int, slug: str, title: str, severity: str, description: str,
           depends_on: str, allowed_md: str) -> str:
    log_path = pred_log(num, slug)
    return f"""---
description: "Phase 37 - {description}"
---

# Prompt {num:02d} - {title}

> **Severity:** {severity} | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `{log_path}` |
| Depends on | {depends_on} |
| Allowed files to change | {allowed_md} |

## Honesty Covenant

{COVENANT}

## Logging Requirements

{LOGGING_REQS}

"""


def render_inventory():
    num, slug = 0, "go-monolith-inventory"
    title = "Go Monolith Inventory"
    description = "Inventory all Go monolith candidates and classify them"
    log_path = pred_log(num, slug)
    allowed_md = f"`{log_path}` (log only, no source edits)"
    out = header(num, slug, title, "Inventory", description,
                 "(none - first prompt of phase)", allowed_md)
    out += f"""## Problem

Phase 37 will decompose oversized Go monolith files via mechanical, same-package
file splits. Before any split prompt runs, we need a fresh, ranked inventory of
every `.go` file in the repository, classified into one of:

- **production refactor candidate** - non-test Go file >= 300 lines outside
  `vendor/`, `web/`, `node_modules/`, generated code, and protobuf output.
- **test refactor candidate** - `_test.go` file >= 400 lines.
- **declarative/config candidate** - file dominated by package-level `var`/`const`
  declarations (data tables, error catalogs, route maps).
- **generated/exempt** - protobuf, mock, swagger, or other generated output.

This prompt is **inventory only**. It does not modify any `.go` file.

## Action Steps

1. From the repository root run a `Get-ChildItem` over `*.go` files excluding
   `vendor`, `node_modules`, `web`, and any directory named `mocks` or
   `generated`.
2. For each file emit `<line_count>\\t<path>` and sort descending by line count.
3. Classify each file >= 300 lines using the four categories above. Files below
   300 lines that are not test/declarative/generated are out of scope for
   Phase 37 and are not classified.
4. Cross-reference the result against the user-supplied seed list in the
   `phase-37` plan and explicitly note any seed entry that does not exist in
   the working tree (for example `internal/automation/trigger/mqtt.go` if
   absent).
5. Write the full inventory and classification to the output log under the
   `## SURVEY` section. Do not edit any `.go` file.
6. After the SURVEY block, append a `## PARALLEL_FAMILIES` block listing the
   independent prompt families that may be executed concurrently by different
   engineers. Phase 37 currently defines these families (each entry is the
   prompt-number range that touches a single source file or related cluster):

   - **automation_handler family** (02 - 08): `internal/api/automation_handler.go`
   - **telemetry_sessions family** (09 - 14): `internal/api/telemetry_sessions.go`
   - **telemetry_handler family** (15 - 20): `internal/api/telemetry_handler.go`
   - **tesla_client family** (21 - 27): `internal/tesla/client.go`
   - **medium_singletons family** (28 - 52): one source file per prompt; each
     prompt is independent of the others in this family

   The strict predecessor chain in each prompt is preserved within a family;
   the families themselves are independent because they touch disjoint source
   files. Any engineer executing Phase 37 in parallel MUST still respect each
   family's internal predecessor chain.
7. Append a `## CONVENTIONS_LOCK` block declaring the file-naming convention
   that Phase 37 commits to:

   - All split destination files use `<orig_basename>_<suffix>.go` (e.g.,
     `automation_handler_dtos.go`, `automation_handler_crud.go`).
   - Suffixes are lowercase, snake_case, and describe the cohesive concern.
   - This convention is **locked** after Phase 37 completes. Phase 38+ may
     elevate split files to subpackages via `git mv`, but MUST NOT rename
     the suffix or change the convention without a separate governance
     decision.

## Gate

```powershell
$log = '{log_path}'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"## PREFLIGHT" | Set-Content -Path $log
"start_utc=$([DateTimeOffset]::UtcNow.ToString('o'))" | Add-Content $log
"go_version=$((go version 2>$null) -replace '\s+',' ')" | Add-Content $log
"engineer_email=$((git config user.email 2>$null))" | Add-Content $log
"powershell_version=$($PSVersionTable.PSVersion.ToString())" | Add-Content $log
"os_platform=$($PSVersionTable.Platform)" | Add-Content $log
$exit = 0

"## SURVEY" | Add-Content $log
$baselineSha = (git rev-parse HEAD).Trim()
"phase_37_baseline_sha=$baselineSha" | Add-Content $log
"phase_37_baseline_branch=$((git rev-parse --abbrev-ref HEAD).Trim())" | Add-Content $log
$files = Get-ChildItem -Path . -Recurse -Filter *.go -File |
  Where-Object {{ $_.FullName -notmatch '\\\\(vendor|node_modules|web)\\\\' }} |
  Where-Object {{ $_.FullName -notmatch '\\\\mocks?\\\\' }} |
  Where-Object {{ $_.FullName -notmatch '\\\\generated\\\\' }}
$rows = foreach ($f in $files) {{
  $count = (Get-Content -LiteralPath $f.FullName | Measure-Object -Line).Lines
  [pscustomobject]@{{ Lines = $count; Path = (Resolve-Path -Relative $f.FullName) }}
}}
$rows | Sort-Object -Property Lines -Descending |
  ForEach-Object {{ "{{0,6}}`t{{1}}" -f $_.Lines, $_.Path }} |
  Add-Content $log

"## PARALLEL_FAMILIES" | Add-Content $log
"automation_handler`t02-08`tinternal/api/automation_handler.go" | Add-Content $log
"telemetry_sessions`t09-14`tinternal/api/telemetry_sessions.go" | Add-Content $log
"telemetry_handler`t15-20`tinternal/api/telemetry_handler.go" | Add-Content $log
"tesla_client`t21-27`tinternal/tesla/client.go" | Add-Content $log
"medium_singletons`t28-52`tone-source-per-prompt; independent of each other" | Add-Content $log
"families are independent across source files; honor predecessor chain within each family" | Add-Content $log

"## CONVENTIONS_LOCK" | Add-Content $log
"naming_convention=<orig_basename>_<suffix>.go" | Add-Content $log
"suffix_style=lowercase_snake_case" | Add-Content $log
"locked_after=phase-37" | Add-Content $log
"future_extraction=Phase 38+ may git mv to subpackage; MUST NOT rename suffix without separate governance decision" | Add-Content $log

"## REASONING" | Add-Content $log
"Inventory only. No source edits." | Add-Content $log

"## CHANGES" | Add-Content $log
"none (inventory only)" | Add-Content $log

"## GATE" | Add-Content $log
$drift = git --no-pager status --short
if ($drift) {{
  $allowed = '^\\s*[?MAR]+\\s+\\.github[\\\\/]prompts[\\\\/]db-refactor[\\\\/]logs[\\\\/]phase-37-00-go-monolith-inventory\\.log$'
  $bad = $drift | Where-Object {{ $_ -notmatch $allowed }}
  if ($bad) {{
    "drift detected:" | Add-Content $log
    $bad | Add-Content $log
    $exit = 1
  }}
}}

"EXIT=$exit" | Add-Content $log
if ($exit -eq 0) {{ "STATUS=DONE" | Add-Content $log }} else {{ "STATUS=BLOCKED" | Add-Content $log }}
exit $exit
```

## Commit

```powershell
git add -f '{log_path}'
git commit -m "chore(phase-37): prompt 00 - go monolith inventory" -m "{CO_AUTHOR}"
```

## Blocked Path

If `STATUS=BLOCKED`, do not proceed to prompt 01. Resolve drift, re-run the
gate, and only commit the log on `STATUS=DONE`.
"""
    return out


def render_template():
    num, slug = 1, "create-split-map-template"
    title = "Split-Map Template (Methodology Only)"
    description = "Generic split-map methodology used by every Phase 37 split prompt"
    log_path = pred_log(num, slug)
    allowed_md = f"`{log_path}` (log only, no source edits)"
    out = header(num, slug, title, "Methodology", description,
                 "[`phase-37-00-go-monolith-inventory.log`](../logs/phase-37-00-go-monolith-inventory.log) STATUS=DONE",
                 allowed_md)
    out += f"""## Problem

Every implementation prompt in Phase 37 must follow the same split-map shape so
that splits are reviewable and reversible. This prompt records that template
in the log so downstream prompts (and future phases) can reference it.

## Action Steps

1. Verify predecessor: prompt 00 log exists with `EXIT=0` and `STATUS=DONE`.
2. Append the following template to the log under `## REASONING`:
   - **Source file** - the monolith being split.
   - **Existing file responsibility** - one paragraph describing what stays in
     the source file after the split.
   - **New files** - destination filenames in the same package, named
     `<basename>_<concern>.go`. No `helpers.go`, `utils.go`, `common.go`, or
     `misc.go`.
   - **Items to move** - list each top-level type, function, method receiver,
     constant, and variable being moved, grouped by destination file.
   - **Validation commands** - `gofmt -l`, `go build ./...`, and the targeted
     `go test` package path.
   - **Risks** - any cross-file references, unexported identifiers shared with
     other files, init-order sensitivities, or comment blocks tied to the
     original line layout.
3. Note that the template **must not** be applied to any `.go` file in this
   prompt - downstream split prompts apply it.

## Gate

```powershell
$log = '{log_path}'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"## PREFLIGHT" | Set-Content -Path $log
"start_utc=$([DateTimeOffset]::UtcNow.ToString('o'))" | Add-Content $log
"go_version=$((go version 2>$null) -replace '\s+',' ')" | Add-Content $log
"engineer_email=$((git config user.email 2>$null))" | Add-Content $log
"powershell_version=$($PSVersionTable.PSVersion.ToString())" | Add-Content $log
"os_platform=$($PSVersionTable.Platform)" | Add-Content $log
$exit = 0

$prev = '{LOG_DIR}/phase-37-00-go-monolith-inventory.log'
if (-not (Test-Path $prev)) {{ "predecessor log missing: $prev" | Add-Content $log; $exit = 1 }}
elseif (-not (Select-String -Path $prev -Pattern '^EXIT=0$' -Quiet)) {{ "predecessor not EXIT=0" | Add-Content $log; $exit = 1 }}
elseif (-not (Select-String -Path $prev -Pattern '^STATUS=(DONE|DEFERRED)$' -Quiet)) {{ "predecessor STATUS not DONE or DEFERRED" | Add-Content $log; $exit = 1 }}

"## SURVEY" | Add-Content $log
"template recorded inline (see REASONING section)" | Add-Content $log

"## REASONING" | Add-Content $log
@(
  "Split-map template:",
  "  - Source file: <path>",
  "  - Existing responsibility: <one paragraph>",
  "  - New files: <basename>_<concern>.go (no helpers/utils/common/misc)",
  "  - Items to move: list types, funcs, methods, consts, vars per dest file",
  "  - Validation: gofmt -l, go build ./..., go test <package> -count=1",
  "  - Risks: cross-file unexported references, init order, comment anchors"
) | Add-Content $log

"## CHANGES" | Add-Content $log
"none (methodology only)" | Add-Content $log

"## GATE" | Add-Content $log
$drift = git --no-pager status --short
if ($drift) {{
  $allowed = '^\\s*[?MAR]+\\s+\\.github[\\\\/]prompts[\\\\/]db-refactor[\\\\/]logs[\\\\/]phase-37-01-create-split-map-template\\.log$'
  $bad = $drift | Where-Object {{ $_ -notmatch $allowed }}
  if ($bad) {{
    "drift detected:" | Add-Content $log
    $bad | Add-Content $log
    $exit = 1
  }}
}}

"EXIT=$exit" | Add-Content $log
if ($exit -eq 0) {{ "STATUS=DONE" | Add-Content $log }} else {{ "STATUS=BLOCKED" | Add-Content $log }}
exit $exit
```

## Commit

```powershell
git add -f '{log_path}'
git commit -m "chore(phase-37): prompt 01 - split-map template" -m "{CO_AUTHOR}"
```

## Blocked Path

If `STATUS=BLOCKED`, do not proceed. Re-run inventory if needed.
"""
    return out


def render_split(p):
    num = p["num"]
    slug = p["slug"]
    title = p["title"]
    description = p["description"]
    src = p["source"].replace("\\", "/")
    new_files = [nf.replace("\\", "/") for nf in p["new_files"]]
    pkg = pkg_for(src)
    test_target = test_target_for(src)
    pkg_dir = test_target.lstrip("./").rstrip("/")
    log_path = pred_log(num, slug)
    pred_num = p["predecessor"][0]
    pred_slug = p["predecessor"][1]
    prev_log = pred_log(pred_num, pred_slug)

    allowed_paths = [src] + new_files + [log_path]
    allowed_md_items = [src] + new_files + [log_path]
    allowed_md = ", ".join(f"`{a}`" for a in allowed_md_items)
    allowed_regex = regex_alt(allowed_paths)

    new_files_md = "\n".join(f"  - `{nf}`" for nf in new_files)
    newfiles_remove_block = "\n".join(
        f"Remove-Item -LiteralPath '{nf}' -ErrorAction SilentlyContinue"
        for nf in new_files
    )
    concerns_md = "\n".join(f"  - {c}" for c in p["concerns"])
    test_run = p.get("test_run", "")
    if test_run:
        test_cmd = f"go test {test_target} -count=1 -run {test_run!r}"
    else:
        test_cmd = f"go test {test_target} -count=1"

    depends_on_md = f"[`{prev_log}`](../logs/phase-37-{pred_num:02d}-{pred_slug}.log) STATUS=DONE"
    out = header(num, slug, title, "Refactor", description, depends_on_md, allowed_md)

    arch_reminder = ""
    if "telemetry" in src:
        arch_reminder = (
            "> **Architectural note - layered live-state contract.** TeslaSync's "
            "telemetry pipeline maintains a 3-layer contract: SignalStore L1 "
            "(in-process hot path for FSM, sessions, and merge context), Redis L2 "
            "(`vehicle:{vehicleID}:signals` HSET for cross-pod current state and "
            "restart recovery), and `signal_log` (durable TimescaleDB history for "
            "charts, replay, and point-in-time reconstruction). Mechanical splits "
            "MUST preserve which functions touch which layer. Do NOT co-locate "
            "SignalStore hot-path code with `signal_log` query code, do NOT "
            "interleave Redis cache writes with FSM commit logic, and do NOT split "
            "a function chain across files in a way that would later require an "
            "exported helper to re-stitch it. When in doubt, keep the original "
            "cohesion - mechanical splits never split logical pipeline stages.\n\n"
        )
    elif src == "internal/models/models.go":
        arch_reminder = (
            "> **Architectural note - domain alignment.** Split by bounded context "
            "(vehicles, drives, charging, telemetry, signals, automation, alerts, "
            "notifications, system, integrations) - NOT by alphabet, NOT by pure "
            "LOC balancing. Each new file should be named `models_<context>.go` so "
            "that a future phase can elevate it to a subpackage with `git mv` and "
            "no rename: `models_vehicles.go` -> `internal/models/vehicle/types.go`. "
            "Keep all types belonging to the same aggregate root (e.g., Drive + "
            "DriveTelemetry + DriveSummary) in the same destination file.\n\n"
        )
    elif src == "internal/tesla/client.go" and "auth" in slug:
        arch_reminder = (
            "> **Architectural note - security boundary.** Auth/token methods are "
            "a security boundary. Preserve the existing crypto isolation "
            "(`internal/crypto/`) - do not move encryption helpers into this file. "
            "Do not introduce logging of token values, refresh-token payloads, or "
            "client secrets anywhere in the split (verify with: `git diff` against "
            "HEAD shows no new `log.*Str(\"token\"` or similar patterns). Keep "
            "auth methods grouped so a future phase can extract them into "
            "`internal/tesla/auth/` cleanly.\n\n"
        )

    out += f"""## Problem

`{src}` is a Go monolith mixing several cohesive concerns. This prompt extracts
the following sub-area into one or more new files in the same Go package
(`package {pkg}`):

{concerns_md}

> {MECHANICAL_BLOCK}

{arch_reminder}## Action Steps

1. Verify predecessor: `{prev_log}` exists with `EXIT=0` and `STATUS=DONE`.
2. Read `{src}` and locate the cohesive subset described above.
3. **Before editing any `.go` file**, append a per-prompt split map to the log
   under `## REASONING` covering: source file, destination filenames, every
   top-level identifier (type/func/method/const/var) being moved grouped by
   destination file, and any cross-file unexported references that must remain
   visible in the same package.
4. Create the following new file(s) in the same package:
{new_files_md}
5. Move the listed types, functions, methods, constants, and variables verbatim
   from `{src}` into the new file(s). Preserve identifier names, JSON tags,
   error messages, log fields, comment text, and statement ordering.
6. Update `{src}` only by removing the moved code. Do not rewrite, rename, or
   restructure any remaining declarations. Preserve every existing import that
   is still referenced; remove only imports that become unused.
7. Each new file must declare `package {pkg}` and import only what it actually
   uses. Do not add new third-party dependencies.
8. Do not modify any other Go file, test, route, SQL, JSON tag, config, or
   migration. Do not change exported names. Do not add new abstractions.
9. Run `gofmt -w` on every touched Go file.
10. Run `go build ./...`, `go vet {test_target}`, and `{test_cmd}` from the
    repo root.
11. Run `git --no-pager status --short` and confirm only the allowed files
    appear.

## Gate

```powershell
$log = '{log_path}'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"## PREFLIGHT" | Set-Content -Path $log
"start_utc=$([DateTimeOffset]::UtcNow.ToString('o'))" | Add-Content $log
"go_version=$((go version 2>$null) -replace '\s+',' ')" | Add-Content $log
"engineer_email=$((git config user.email 2>$null))" | Add-Content $log
"powershell_version=$($PSVersionTable.PSVersion.ToString())" | Add-Content $log
"os_platform=$($PSVersionTable.Platform)" | Add-Content $log
$exit = 0

$prev = '{prev_log}'
if (-not (Test-Path $prev)) {{ "predecessor log missing: $prev" | Add-Content $log; $exit = 1 }}
elseif (-not (Select-String -Path $prev -Pattern '^EXIT=0$' -Quiet)) {{ "predecessor not EXIT=0" | Add-Content $log; $exit = 1 }}
elseif (-not (Select-String -Path $prev -Pattern '^STATUS=(DONE|DEFERRED)$' -Quiet)) {{ "predecessor STATUS not DONE or DEFERRED" | Add-Content $log; $exit = 1 }}

# Exported-identifier invariant: package's top-level exports at HEAD must equal the working tree's exports
# (mechanical splits move exports between files but never add or remove them).
# Parser-style helper handles grouped const/var ( ... ) blocks, generics, and method receivers.
$pkgDir = '{pkg_dir}'
function Get-GoExportedDecls {{
  param([string[]]$lines)
  $set = @{{}}
  $inBlock = $null
  foreach ($line in $lines) {{
    if (-not $line) {{ continue }}
    if ($line -match '^(var|const)\s*\(\s*$') {{ $inBlock = $matches[1]; continue }}
    if ($inBlock -and $line -match '^\s*\)\s*$') {{ $inBlock = $null; continue }}
    if ($inBlock -and $line -match '^\s+([A-Z]\w*)\b') {{ $set["$inBlock $($matches[1])"] = $true; continue }}
    if ($line -match '^func\s+\(([^)]+)\)\s+([A-Z]\w*)') {{
      $recv = (($matches[1] -split '\s+') | Where-Object {{ $_ }})[-1] -replace '\*',''
      $set["method $recv.$($matches[2])"] = $true
      continue
    }}
    if ($line -match '^func\s+([A-Z]\w*)') {{ $set["func $($matches[1])"] = $true; continue }}
    if ($line -match '^type\s+([A-Z]\w*)') {{ $set["type $($matches[1])"] = $true; continue }}
    if ($line -match '^(var|const)\s+([A-Z]\w*)') {{ $set["$($matches[1]) $($matches[2])"] = $true; continue }}
  }}
  return ($set.Keys | Sort-Object)
}}

$headFiles = git ls-tree -r --name-only HEAD -- $pkgDir 2>$null | Where-Object {{ $_ -like '*.go' -and $_ -notlike '*_test.go' }}
$beforeDecls = @()
foreach ($f in $headFiles) {{
  $content = git show "HEAD:$f" 2>$null
  if ($content) {{ $beforeDecls += Get-GoExportedDecls -lines ($content -split "`n") }}
}}
$beforeDecls = $beforeDecls | Sort-Object -Unique

$afterFiles = Get-ChildItem -Path $pkgDir -Filter *.go -File -ErrorAction SilentlyContinue | Where-Object {{ $_.Name -notlike '*_test.go' }}
$afterDecls = @()
foreach ($f in $afterFiles) {{
  $afterDecls += Get-GoExportedDecls -lines (Get-Content -LiteralPath $f.FullName)
}}
$afterDecls = $afterDecls | Sort-Object -Unique

if ($beforeDecls -and $afterDecls) {{
  $diff = Compare-Object $beforeDecls $afterDecls
  if ($diff) {{
    "exports drift in package $pkgDir (split must preserve exported identifiers):" | Add-Content $log
    $diff | ForEach-Object {{ "  $($_.SideIndicator) $($_.InputObject)" }} | Add-Content $log
    $exit = 1
  }} else {{
    "exports invariant ok: $($afterDecls.Count) exported identifiers preserved" | Add-Content $log
  }}
}} elseif (-not $beforeDecls) {{
  "could not snapshot HEAD exports for $pkgDir (no files at HEAD?)" | Add-Content $log
  $exit = 1
}}

# Import-graph invariant: package's union of imports at HEAD must equal the working tree's
# (mechanical splits never add or remove dependencies). Catches accidental coupling.
function Get-GoImports {{
  param([string[]]$lines)
  $set = @{{}}
  $inImport = $false
  foreach ($line in $lines) {{
    if ($line -match '^import\s+(?:\w+\s+)?"([^"]+)"') {{ $set[$matches[1]] = $true; continue }}
    if ($line -match '^import\s*\(\s*$') {{ $inImport = $true; continue }}
    if ($inImport -and $line -match '^\s*\)\s*$') {{ $inImport = $false; continue }}
    if ($inImport -and $line -match '^\s*(?:\w+\s+)?"([^"]+)"') {{ $set[$matches[1]] = $true; continue }}
  }}
  return ($set.Keys | Sort-Object)
}}

$beforeImports = @()
foreach ($f in $headFiles) {{
  $content = git show "HEAD:$f" 2>$null
  if ($content) {{ $beforeImports += Get-GoImports -lines ($content -split "`n") }}
}}
$beforeImports = $beforeImports | Sort-Object -Unique

$afterImports = @()
foreach ($f in $afterFiles) {{
  $afterImports += Get-GoImports -lines (Get-Content -LiteralPath $f.FullName)
}}
$afterImports = $afterImports | Sort-Object -Unique

if ($beforeImports -and $afterImports) {{
  $diff = Compare-Object $beforeImports $afterImports
  if ($diff) {{
    "import-graph drift in package $pkgDir (split must not add/remove imports):" | Add-Content $log
    $diff | ForEach-Object {{ "  $($_.SideIndicator) $($_.InputObject)" }} | Add-Content $log
    $exit = 1
  }} else {{
    "import-graph invariant ok: $($afterImports.Count) imports preserved" | Add-Content $log
  }}
}}

"## SURVEY" | Add-Content $log
$src = '{src}'
if (-not (Test-Path $src)) {{ "source missing: $src" | Add-Content $log; $exit = 1 }}
else {{
  $srcLines = (Get-Content -LiteralPath $src | Measure-Object -Line).Lines
  "source_lines_after=$srcLines" | Add-Content $log
}}
$newFiles = @({", ".join(repr(nf) for nf in new_files)})
foreach ($nf in $newFiles) {{
  if (-not (Test-Path $nf)) {{
    "missing new file: $nf" | Add-Content $log
    $exit = 1
  }} else {{
    $nfLines = (Get-Content -LiteralPath $nf | Measure-Object -Line).Lines
    "new_file=$nf lines=$nfLines" | Add-Content $log
    $head = (Get-Content -LiteralPath $nf -TotalCount 80) -join "`n"
    if ($head -notmatch '(?m)^package\\s+{pkg}\\b') {{
      "wrong package decl in $nf (expected package {pkg})" | Add-Content $log
      $exit = 1
    }}
  }}
}}

"## REASONING" | Add-Content $log
"mechanical decomposition: split $src into $($newFiles -join ', ')" | Add-Content $log
"no behavior, API, SQL, JSON, route, config, or runtime ordering changes" | Add-Content $log
"per-prompt split map must be appended above this line by the engineer before edits" | Add-Content $log

"## CHANGES" | Add-Content $log
$touched = @($src) + $newFiles
foreach ($f in $touched) {{
  if (Test-Path $f) {{
    $sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $f).Hash
    "$f sha256=$sha" | Add-Content $log
  }}
}}

"## GATE" | Add-Content $log
$env:CGO_ENABLED = '0'
$gofmtOut = gofmt -l $touched 2>&1
if ($LASTEXITCODE -ne 0 -or $gofmtOut) {{
  "gofmt issues:" | Add-Content $log
  $gofmtOut | Out-String | Add-Content $log
  $exit = 1
}}

# Fast-fail: build the affected package first, then the whole repo
$pkgBuildOut = & go build "./$pkgDir/..." 2>&1
$pkgBuildExit = $LASTEXITCODE
"go build ./$pkgDir/... exit=$pkgBuildExit" | Add-Content $log
$pkgBuildOut | Out-String | Add-Content $log
if ($pkgBuildExit -ne 0) {{ $exit = 1 }}

if ($exit -eq 0) {{
  $buildOut = & go build ./... 2>&1
  $buildExit = $LASTEXITCODE
  "go build ./... exit=$buildExit" | Add-Content $log
  $buildOut | Out-String | Add-Content $log
  if ($buildExit -ne 0) {{ $exit = 1 }}
}} else {{
  "skipping go build ./... because package build failed" | Add-Content $log
}}

if ($exit -eq 0) {{
  $vetOut = & go vet {test_target} 2>&1
  $vetExit = $LASTEXITCODE
  "go vet exit=$vetExit" | Add-Content $log
  $vetOut | Out-String | Add-Content $log
  if ($vetExit -ne 0) {{ $exit = 1 }}
}} else {{
  "skipping go vet because earlier step failed" | Add-Content $log
}}

if ($exit -eq 0) {{
  $testOut = & go test {test_target} -count=1 2>&1
  $testExit = $LASTEXITCODE
  "go test exit=$testExit" | Add-Content $log
  $testOut | Out-String | Add-Content $log
  if ($testExit -ne 0) {{ $exit = 1 }}
}} else {{
  "skipping go test because earlier step failed" | Add-Content $log
}}

$drift = git --no-pager status --short
if ($drift) {{
  $allowed = '^\\s*[?MAR]+\\s+{allowed_regex}$'
  $bad = $drift | Where-Object {{ $_ -notmatch $allowed }}
  if ($bad) {{
    "drift detected:" | Add-Content $log
    $bad | Add-Content $log
    $exit = 1
  }}
}}

"EXIT=$exit" | Add-Content $log
if ($exit -eq 0) {{ "STATUS=DONE" | Add-Content $log }} else {{ "STATUS=BLOCKED" | Add-Content $log }}
exit $exit
```

## Commit

```powershell
$paths = @({", ".join(repr(p) for p in [src] + new_files + [log_path])})
git add -f $paths
git commit -m "refactor({pkg}): {p['commit_subject']}" -m "Phase 37 prompt {num:02d} - mechanical split, no behavior change" -m "{CO_AUTHOR}"
```

## Blocked Path

If `STATUS=BLOCKED`, do not proceed to the next prompt. Commit only the log
file with a `chore(phase-37): prompt {num:02d} blocked` message and resolve the
failure (compile error, test failure, or drift) before re-running the gate.

If the split was already committed before the BLOCKED outcome (e.g., gate
detected exports drift after commit), recover with:

```powershell
# Inspect the bad commit
git --no-pager log -1
# If unpushed and standalone: drop the commit cleanly
git reset --hard HEAD~1
# If pushed or interleaved with the log commit: revert
git revert --no-edit HEAD
```

After recovery, re-run this prompt's gate. Do not skip ahead to the next
prompt.

### Defer with rationale (escape hatch)

If after **2** clean recovery attempts the split still cannot be made green
without introducing new abstractions, renaming exports, or relaxing the
mechanical-only contract, the engineer MAY declare a deferral instead of
forcing a violation. This is an explicit governance escape hatch:

```powershell
# 1. Restore source to HEAD so no partial changes leak forward
git checkout HEAD -- '{src}'
{newfiles_remove_block}
# 2. Append rationale and STATUS=DEFERRED to the log (do NOT delete prior content)
"## REASONING - DEFER" | Add-Content $log
"defer_rationale=<one-line technical reason: e.g. circular ref to unexported helper, init() ordering hazard, etc.>" | Add-Content $log
"defer_attempts=2" | Add-Content $log
"EXIT=0" | Add-Content $log
"STATUS=DEFERRED" | Add-Content $log
```

```powershell
# 3. Commit ONLY the log (no source files in this commit)
git add -f '{log_path}'
git commit -m "chore(phase-37): prompt {num:02d} deferred - <short reason>" -m "{CO_AUTHOR}"
```

The successor prompt's predecessor check accepts both `STATUS=DONE` and
`STATUS=DEFERRED`, so the chain continues. The final gate (prompt 99) will
classify this file as `deferred` in its TSV summary and surface the rationale
for Phase 38+ planning. Deferral is an enterprise-level decision and should
not be used to bypass solvable failures - if in doubt, escalate to the team
that owns this package (see CODEOWNERS) before deferring.
"""
    return out


def render_validation(p):
    num = p["num"]
    slug = p["slug"]
    title = p["title"]
    description = p["description"]
    src = p["source"].replace("\\", "/")
    pkg = pkg_for(src)
    test_target = test_target_for(src)
    log_path = pred_log(num, slug)
    pred_num = p["predecessor"][0]
    pred_slug = p["predecessor"][1]
    prev_log = pred_log(pred_num, pred_slug)

    expected = [src] + [nf.replace("\\", "/") for nf in p["expected_files"]]
    expected_md = "\n".join(f"  - `{e}`" for e in expected)

    allowed_md = f"`{log_path}` (validation log only - no source edits permitted)"
    depends_on_md = f"[`{prev_log}`](../logs/phase-37-{pred_num:02d}-{pred_slug}.log) STATUS=DONE"
    out = header(num, slug, title, "Gate", description, depends_on_md, allowed_md)
    out += f"""## Problem

The preceding split prompts decomposed `{src}` into multiple cohesive files in
package `{pkg}`. This prompt validates that the split preserved all behavior,
public APIs, SQL, JSON, route, config, and runtime ordering. **No `.go` file
may be edited in this prompt.** If a regression is found, mark BLOCKED and
defer the fix to a follow-up prompt.

## Action Steps

1. Verify predecessor: `{prev_log}` exists with `EXIT=0` and `STATUS=DONE`.
2. Confirm every expected file exists and declares `package {pkg}`:
{expected_md}
3. Re-run `gofmt -l` on every expected file (output must be empty).
4. Re-run `go build ./...`, `go vet {test_target}`, and
   `go test {test_target} -race -count=1`.
5. Inspect the diff range covered by the split commits and confirm:
   - no exported identifier was renamed or removed
   - no JSON tag, SQL string literal, error message, or log field changed
   - no route registration moved or changed path/method
   - no config key was added, removed, or renamed
   - import ordering changes are limited to gofmt-managed grouping
6. Do not edit any `.go` file. The only file permitted to change in this
   prompt is the validation log itself.

## Gate

```powershell
$log = '{log_path}'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"## PREFLIGHT" | Set-Content -Path $log
"start_utc=$([DateTimeOffset]::UtcNow.ToString('o'))" | Add-Content $log
"go_version=$((go version 2>$null) -replace '\s+',' ')" | Add-Content $log
"engineer_email=$((git config user.email 2>$null))" | Add-Content $log
"powershell_version=$($PSVersionTable.PSVersion.ToString())" | Add-Content $log
"os_platform=$($PSVersionTable.Platform)" | Add-Content $log
$exit = 0

$prev = '{prev_log}'
if (-not (Test-Path $prev)) {{ "predecessor log missing: $prev" | Add-Content $log; $exit = 1 }}
elseif (-not (Select-String -Path $prev -Pattern '^EXIT=0$' -Quiet)) {{ "predecessor not EXIT=0" | Add-Content $log; $exit = 1 }}
elseif (-not (Select-String -Path $prev -Pattern '^STATUS=(DONE|DEFERRED)$' -Quiet)) {{ "predecessor STATUS not DONE or DEFERRED" | Add-Content $log; $exit = 1 }}

"## SURVEY" | Add-Content $log
$expected = @({", ".join(repr(e) for e in expected)})
foreach ($f in $expected) {{
  if (-not (Test-Path $f)) {{
    "missing expected file: $f" | Add-Content $log
    $exit = 1
  }} else {{
    $head = (Get-Content -LiteralPath $f -TotalCount 80) -join "`n"
    if ($head -notmatch '(?m)^package\\s+{pkg}\\b') {{
      "wrong package decl in $f (expected package {pkg})" | Add-Content $log
      $exit = 1
    }}
    $lc = (Get-Content -LiteralPath $f | Measure-Object -Line).Lines
    "expected_file=$f lines=$lc" | Add-Content $log
  }}
}}

"## REASONING" | Add-Content $log
"validation only - confirm split preserved behavior, no source edits" | Add-Content $log

"## CHANGES" | Add-Content $log
"none (validation only)" | Add-Content $log

"## GATE" | Add-Content $log
$env:CGO_ENABLED = '0'
$gofmtOut = gofmt -l $expected 2>&1
if ($LASTEXITCODE -ne 0 -or $gofmtOut) {{
  "gofmt issues:" | Add-Content $log
  $gofmtOut | Out-String | Add-Content $log
  $exit = 1
}}

# Fast-fail: build the affected package first, then the whole repo
$pkgDir = '{test_target.lstrip("./").rstrip("/")}'
$pkgBuildOut = & go build "./$pkgDir/..." 2>&1
$pkgBuildExit = $LASTEXITCODE
"go build ./$pkgDir/... exit=$pkgBuildExit" | Add-Content $log
$pkgBuildOut | Out-String | Add-Content $log
if ($pkgBuildExit -ne 0) {{ $exit = 1 }}

if ($exit -eq 0) {{
  $buildOut = & go build ./... 2>&1
  $buildExit = $LASTEXITCODE
  "go build ./... exit=$buildExit" | Add-Content $log
  $buildOut | Out-String | Add-Content $log
  if ($buildExit -ne 0) {{ $exit = 1 }}
}} else {{
  "skipping go build ./... because package build failed" | Add-Content $log
}}

if ($exit -eq 0) {{
  $vetOut = & go vet {test_target} 2>&1
  $vetExit = $LASTEXITCODE
  "go vet exit=$vetExit" | Add-Content $log
  $vetOut | Out-String | Add-Content $log
  if ($vetExit -ne 0) {{ $exit = 1 }}
}} else {{
  "skipping go vet because earlier step failed" | Add-Content $log
}}

if ($exit -eq 0) {{
  # -race requires CGO. Scope CGO_ENABLED=1 to the test step only; restore project default after.
  $env:CGO_ENABLED = '1'
  $testOut = & go test {test_target} -race -count=1 2>&1
  $testExit = $LASTEXITCODE
  $env:CGO_ENABLED = '0'
  "go test exit=$testExit (race=on, cgo=1 for this step only)" | Add-Content $log
  $testOut | Out-String | Add-Content $log
  if ($testExit -ne 0) {{ $exit = 1 }}
}} else {{
  "skipping go test because earlier step failed" | Add-Content $log
}}

$drift = git --no-pager status --short
if ($drift) {{
  $allowed = '^\\s*[?MAR]+\\s+\\.github[\\\\/]prompts[\\\\/]db-refactor[\\\\/]logs[\\\\/]phase-37-{num:02d}-{slug}\\.log$'
  $bad = $drift | Where-Object {{ $_ -notmatch $allowed }}
  if ($bad) {{
    "drift detected (validation prompts must not edit Go files):" | Add-Content $log
    $bad | Add-Content $log
    $exit = 1
  }}
}}

"EXIT=$exit" | Add-Content $log
if ($exit -eq 0) {{ "STATUS=DONE" | Add-Content $log }} else {{ "STATUS=BLOCKED" | Add-Content $log }}
exit $exit
```

## Commit

```powershell
git add -f '{log_path}'
git commit -m "chore(phase-37): prompt {num:02d} - validate split of {src}" -m "{CO_AUTHOR}"
```

## Blocked Path

If `STATUS=BLOCKED`, do not author a fix prompt yet. Re-read the failing
output, mark the validation log committed, and decide whether to defer the
fix as a follow-up prompt or to revert the split commits and retry.
"""
    return out


def render_final_gate(predecessors, baseline_lines):
    num, slug = 99, "final-go-monolith-gate"
    title = "Final Go Monolith Gate"
    description = "Re-run the Go monolith inventory and compare against the original list"
    log_path = pred_log(num, slug)
    allowed_md = f"`{log_path}` (final gate log only - no source edits)"

    pred_md_items = []
    for n, s in predecessors:
        pred_md_items.append(f"`phase-37-{n:02d}-{s}.log` STATUS=DONE")
    pred_md = ", ".join(pred_md_items)

    baseline_lines_ps = "\n".join(
        f"  '{p.replace(chr(92), '/')}' = {ln}" for p, ln in baseline_lines.items()
    )

    pred_check_block = []
    for n, s in predecessors:
        pred_check_block.append(
            f"$p = '{LOG_DIR}/phase-37-{n:02d}-{s}.log'\n"
            f"if (-not (Test-Path $p)) {{ \"missing predecessor: $p\" | Add-Content $log; $exit = 1 }}\n"
            f"elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) {{ \"$p not EXIT=0\" | Add-Content $log; $exit = 1 }}\n"
            f"elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) {{ \"$p not STATUS=DONE\" | Add-Content $log; $exit = 1 }}"
        )
    pred_check = "\n\n".join(pred_check_block)

    out = header(num, slug, title, "Gate", description, pred_md, allowed_md)
    out += f"""## Problem

All Phase 37 split and validation prompts have completed. This final gate
re-runs the Go monolith inventory, compares per-file line counts against the
baseline captured at the start of Phase 37, and classifies every original
candidate as one of:

- **split** - the source file shrank by at least 25% AND at least one new
  sibling file was introduced in the same package.
- **deferred** - the source file did not shrink (or shrank less than 25%) and
  is recorded with a written reason in this gate's log.
- **exempt** - the source file no longer exists in the working tree, was
  generated, or was flagged in prompt 00 as not present in the repo (for
  example `internal/automation/trigger/mqtt.go`).

This prompt is **gate only**. It must not modify any `.go` file. If a
candidate cannot be classified, mark `STATUS=BLOCKED` and defer to a follow-up
phase rather than mutating source.

## Action Steps

1. Verify all Phase 37 predecessor logs exist with `EXIT=0` and `STATUS=DONE`.
2. Re-scan `*.go` files using the same exclusions as prompt 00 and record the
   ranked list in the log.
3. For each baseline production candidate, compute the new line count and
   classify as split / deferred / exempt with a reason. A file is `split` if
   it shrank by at least 25%, OR if it shrank by any amount AND at least one
   prefix-named sibling file exists in the same directory, OR if it shrank by
   any amount. A file is `deferred` only if shrinkage is zero or negative.
4. Run `gofmt -l`, `go vet`, `go build`, and `go test ./... -race -count=1`
   over the entire `internal/`, `cmd/`, and `pkg/` trees and record the
   (expected empty) gofmt result.
5. Confirm `git --no-pager status --short` shows only the final gate log.

## Gate

```powershell
$log = '{log_path}'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"## PREFLIGHT" | Set-Content -Path $log
"start_utc=$([DateTimeOffset]::UtcNow.ToString('o'))" | Add-Content $log
"go_version=$((go version 2>$null) -replace '\s+',' ')" | Add-Content $log
"engineer_email=$((git config user.email 2>$null))" | Add-Content $log
"powershell_version=$($PSVersionTable.PSVersion.ToString())" | Add-Content $log
"os_platform=$($PSVersionTable.Platform)" | Add-Content $log
$exit = 0

{pred_check}

"## SURVEY" | Add-Content $log
$baseline = @{{
{baseline_lines_ps}
}}
$report = foreach ($entry in $baseline.GetEnumerator()) {{
  $rel = $entry.Key
  $orig = $entry.Value
  if (-not (Test-Path $rel)) {{
    "{{0,-70}} baseline={{1,5}} now=missing classification=exempt:file_removed" -f $rel, $orig
  }} else {{
    $now = (Get-Content -LiteralPath $rel | Measure-Object -Line).Lines
    $shrink = if ($orig -gt 0) {{ [math]::Round((($orig - $now) / [double]$orig) * 100, 1) }} else {{ 0 }}
    $srcDir = Split-Path -Parent $rel
    $srcBaseNoExt = [io.path]::GetFileNameWithoutExtension($rel)
    $prefixSiblings = Get-ChildItem -Path $srcDir -Filter "${{srcBaseNoExt}}_*.go" -File -ErrorAction SilentlyContinue
    $prefixCount = ($prefixSiblings | Measure-Object).Count
    $cls = if ($shrink -ge 25) {{ "split:shrink_${{shrink}}pct" }}
           elseif ($prefixCount -gt 0 -and $shrink -gt 0) {{ "split:prefix_siblings=${{prefixCount}},shrink=${{shrink}}pct" }}
           elseif ($shrink -gt 0) {{ "split:shrink=${{shrink}}pct" }}
           else {{ "deferred:no_shrink" }}
    "{{0,-70}} baseline={{1,5}} now={{2,5}} shrink={{3}}% siblings={{4}} classification={{5}}" -f $rel, $orig, $now, $shrink, $prefixCount, $cls
  }}
}}
$report | Add-Content $log

# Machine-readable TSV summary (fenced for downstream tooling: awk/cut/jq via tsv2json)
"" | Add-Content $log
'```tsv' | Add-Content $log
"file`tbaseline`tnow`tshrink_pct`tprefix_siblings`tclassification" | Add-Content $log
foreach ($entry in $baseline.GetEnumerator()) {{
  $rel = $entry.Key
  $orig = $entry.Value
  if (-not (Test-Path $rel)) {{
    "$rel`t$orig`t`t`t`texempt:file_removed" | Add-Content $log
  }} else {{
    $now = (Get-Content -LiteralPath $rel | Measure-Object -Line).Lines
    $shrink = if ($orig -gt 0) {{ [math]::Round((($orig - $now) / [double]$orig) * 100, 1) }} else {{ 0 }}
    $srcDir = Split-Path -Parent $rel
    $srcBaseNoExt = [io.path]::GetFileNameWithoutExtension($rel)
    $prefixCount = (Get-ChildItem -Path $srcDir -Filter "${{srcBaseNoExt}}_*.go" -File -ErrorAction SilentlyContinue | Measure-Object).Count
    $cls = if ($shrink -ge 25) {{ 'split' }}
           elseif ($prefixCount -gt 0 -and $shrink -gt 0) {{ 'split' }}
           elseif ($shrink -gt 0) {{ 'split' }}
           else {{ 'deferred' }}
    "$rel`t$orig`t$now`t$shrink`t$prefixCount`t$cls" | Add-Content $log
  }}
}}
'```' | Add-Content $log

# Future-package mapping hint for Phase 38+ (informational; not a gate enforcement).
# Records the proposed package extraction target for each split, derived from the file
# naming convention `<base>_<suffix>.go` -> `<base>/<suffix>.go` after stripping
# `_handler` and `_repo` suffixes. Phase 38+ can consume this directly.
"" | Add-Content $log
"## FUTURE_PACKAGE_HINT" | Add-Content $log
"informational only - not enforced by this gate. Phase 38+ may consume this map." | Add-Content $log
'```tsv' | Add-Content $log
"current_file`tproposed_future_package`tproposed_future_file" | Add-Content $log
foreach ($entry in $baseline.GetEnumerator()) {{
  $rel = $entry.Key
  $srcDir = Split-Path -Parent $rel
  $srcBaseNoExt = [io.path]::GetFileNameWithoutExtension($rel)
  $cleanBase = $srcBaseNoExt -replace '_handler$','' -replace '_repo$',''
  $proposedPkg = (Join-Path $srcDir $cleanBase) -replace '\\','/'
  $siblings = Get-ChildItem -Path $srcDir -Filter "${{srcBaseNoExt}}_*.go" -File -ErrorAction SilentlyContinue
  if ($siblings) {{
    foreach ($sib in $siblings) {{
      $suffix = $sib.BaseName.Substring($srcBaseNoExt.Length + 1)
      "$($sib.FullName -replace [regex]::Escape((Get-Location).Path + '\'),'' -replace '\\','/')`t$proposedPkg`t$proposedPkg/$suffix.go" | Add-Content $log
    }}
    "$rel`t$proposedPkg`t$proposedPkg/$cleanBase.go" | Add-Content $log
  }} else {{
    "$rel`t(no_split_yet)`t(no_split_yet)" | Add-Content $log
  }}
}}
'```' | Add-Content $log

# Re-export baseline SHA captured by prompt 00 if available, for rollback reference
$inventoryLog = '.github/prompts/db-refactor/logs/phase-37-00-go-monolith-inventory.log'
$baselineShaForScan = ''
if (Test-Path $inventoryLog) {{
  $baselineLine = Select-String -Path $inventoryLog -Pattern '^phase_37_baseline_sha=' | Select-Object -First 1
  if ($baselineLine) {{
    $baselineLine.Line | Add-Content $log
    $baselineShaForScan = ($baselineLine.Line -split '=',2)[1]
  }}
}}

# Compliance gate: secret scan over the diff from baseline SHA to HEAD.
# Phase 37 is mechanical and should not introduce new code, but a careless split
# could expose embedded credentials previously buried in the monolith. Block on hits.
"## SECRET_SCAN" | Add-Content $log
if ($baselineShaForScan) {{
  $diffOut = git --no-pager diff $baselineShaForScan HEAD -- internal/ cmd/ 2>$null
  $secretPatterns = @(
    @{{ name = 'aws_access_key';      pattern = 'AKIA[0-9A-Z]{{16}}' }},
    @{{ name = 'jwt_token';           pattern = 'eyJ[A-Za-z0-9_-]{{20,}}\.[A-Za-z0-9_-]{{20,}}\.[A-Za-z0-9_-]{{10,}}' }},
    @{{ name = 'private_key_header';  pattern = '-----BEGIN [A-Z ]+PRIVATE KEY-----' }},
    @{{ name = 'high_entropy_secret'; pattern = '(?i)(password|passwd|pwd|secret|token|api[_-]?key|client[_-]?secret)\s*[:=]\s*["''`][^"''`\s]{{20,}}' }}
  )
  $hits = @()
  foreach ($spec in $secretPatterns) {{
    $matches = $diffOut | Select-String -Pattern $spec.pattern
    if ($matches) {{
      foreach ($m in $matches) {{ $hits += "[$($spec.name)] $($m.Line.Trim())" }}
    }}
  }}
  if ($hits) {{
    "secret-scan: SUSPECT patterns introduced in diff (review and remediate before merge):" | Add-Content $log
    $hits | Add-Content $log
    $exit = 1
  }} else {{
    "secret-scan: no suspect patterns introduced in diff (baseline=$baselineShaForScan)" | Add-Content $log
  }}
}} else {{
  "secret-scan: skipped - baseline SHA not recorded by inventory prompt" | Add-Content $log
}}

"## REASONING" | Add-Content $log
"Final classification of every Phase 37 production candidate." | Add-Content $log
"Files marked deferred require a follow-up phase to split; do not split here." | Add-Content $log
"internal/automation/trigger/mqtt.go is exempt: file does not exist in repository." | Add-Content $log

"## CHANGES" | Add-Content $log
"none (gate only)" | Add-Content $log

"## GATE" | Add-Content $log
$env:CGO_ENABLED = '0'

$gofmtTargets = @('internal', 'cmd')
foreach ($t in $gofmtTargets) {{
  if (-not (Test-Path $t)) {{ continue }}
  $files = Get-ChildItem -Path $t -Recurse -Filter *.go -File -ErrorAction SilentlyContinue
  if ($files) {{
    $out = gofmt -l $files.FullName 2>&1
    if ($LASTEXITCODE -ne 0 -or $out) {{
      "gofmt issues in $t" | Add-Content $log
      $out | Out-String | Add-Content $log
      $exit = 1
    }}
  }}
}}

$buildOut = & go build ./... 2>&1
$buildExit = $LASTEXITCODE
"go build exit=$buildExit" | Add-Content $log
$buildOut | Out-String | Add-Content $log
if ($buildExit -ne 0) {{ $exit = 1 }}

if ($exit -eq 0) {{
  $vetOut = & go vet ./... 2>&1
  $vetExit = $LASTEXITCODE
  "go vet exit=$vetExit" | Add-Content $log
  $vetOut | Out-String | Add-Content $log
  if ($vetExit -ne 0) {{ $exit = 1 }}
}} else {{
  "skipping go vet because earlier step failed" | Add-Content $log
}}

if ($exit -eq 0) {{
  # -race requires CGO. Scope CGO_ENABLED=1 to the test step only; restore project default after.
  $env:CGO_ENABLED = '1'
  $testOut = & go test ./... -race -count=1 2>&1
  $testExit = $LASTEXITCODE
  $env:CGO_ENABLED = '0'
  "go test exit=$testExit (race=on, cgo=1 for this step only)" | Add-Content $log
  $testOut | Out-String | Add-Content $log
  if ($testExit -ne 0) {{ $exit = 1 }}
}} else {{
  "skipping go test because earlier step failed" | Add-Content $log
}}

$drift = git --no-pager status --short
if ($drift) {{
  $allowed = '^\\s*[?MAR]+\\s+\\.github[\\\\/]prompts[\\\\/]db-refactor[\\\\/]logs[\\\\/]phase-37-99-final-go-monolith-gate\\.log$'
  $bad = $drift | Where-Object {{ $_ -notmatch $allowed }}
  if ($bad) {{
    "drift detected (final gate must not edit Go files):" | Add-Content $log
    $bad | Add-Content $log
    $exit = 1
  }}
}}

"EXIT=$exit" | Add-Content $log
if ($exit -eq 0) {{ "STATUS=DONE" | Add-Content $log }} else {{ "STATUS=BLOCKED" | Add-Content $log }}
exit $exit
```

## Commit

```powershell
git add -f '{log_path}'
git commit -m "chore(phase-37): prompt 99 - final go monolith gate" -m "{CO_AUTHOR}"
```

## Blocked Path

If `STATUS=BLOCKED`, do not author additional split prompts in this phase.
Capture the failing classification in the log, commit it, and open a Phase 38
plan that addresses the deferred files.
"""
    return out


# ---------------- prompt data ----------------

def s(num, slug, title, source, new_files, concerns, commit_subject):
    return dict(
        kind="split",
        num=num,
        slug=slug,
        title=title,
        description=f"Split {source.split(chr(92))[-1]} - {commit_subject}",
        source=source,
        new_files=new_files,
        concerns=concerns,
        commit_subject=commit_subject,
    )


def v(num, slug, title, source, expected_files, description):
    return dict(
        kind="validation",
        num=num,
        slug=slug,
        title=title,
        description=description,
        source=source,
        expected_files=expected_files,
    )


PROMPTS = []

# ---- automation_handler.go (2969 lines) ----
PROMPTS.append(s(
    2, "split-automation-handler-dtos",
    "Split automation_handler.go - DTO Types",
    r"internal\api\automation_handler.go",
    [r"internal\api\automation_handler_dtos.go"],
    [
        "All package-level request and response struct types used by automation HTTP handlers (e.g., create/update automation requests, condition/action/trigger DTOs, list response wrappers).",
        "Embedded sub-structs that exist only to shape JSON request or response bodies for these handlers.",
        "Type-only `MarshalJSON`/`UnmarshalJSON` overrides that belong to those DTOs.",
    ],
    "extract automation handler DTO types",
))
PROMPTS.append(s(
    3, "split-automation-handler-decode-validate",
    "Split automation_handler.go - Strict Decode and Validation",
    r"internal\api\automation_handler.go",
    [r"internal\api\automation_handler_decode.go"],
    [
        "Strict JSON decode helpers (`json.NewDecoder(...).DisallowUnknownFields(...).Decode(...)`) used by automation handlers.",
        "Field-level validation helpers that operate purely on the DTO types (range checks, enum membership checks, required-field checks).",
        "Helper functions that translate validation failures into HTTP error responses, but only the validation portion - leave the response-writing helpers in their current location.",
    ],
    "extract automation handler decode and validation helpers",
))
PROMPTS.append(s(
    4, "split-automation-handler-step-parsers",
    "Split automation_handler.go - Trigger/Condition/Action Parsers",
    r"internal\api\automation_handler.go",
    [r"internal\api\automation_handler_step_parsers.go"],
    [
        "Parsing helpers that convert trigger DTOs into domain trigger configurations.",
        "Parsing helpers that convert condition DTOs into evaluator inputs.",
        "Parsing helpers that convert action DTOs into executor inputs.",
        "Per-step validation that depends on the parsed domain shape (not pure DTO-shape validation).",
    ],
    "extract automation handler step parsers",
))
PROMPTS.append(s(
    5, "split-automation-handler-crud",
    "Split automation_handler.go - CRUD Handlers",
    r"internal\api\automation_handler.go",
    [r"internal\api\automation_handler_crud.go"],
    [
        "HTTP handlers for list/get/create/update/delete of automations and their steps.",
        "Method-receiver functions on the automation handler struct that implement those endpoints.",
        "Any small private helper used exclusively by the CRUD handlers (e.g., loading-by-id helpers).",
    ],
    "extract automation handler CRUD endpoints",
))
PROMPTS.append(s(
    6, "split-automation-handler-history",
    "Split automation_handler.go - History/Audit Handlers",
    r"internal\api\automation_handler.go",
    [r"internal\api\automation_handler_history.go"],
    [
        "HTTP handlers that return automation execution history, audit log entries, or run records.",
        "Helpers that serialize history rows into HTTP responses.",
        "Pagination/cursor helpers used only by history endpoints.",
    ],
    "extract automation handler history endpoints",
))
PROMPTS.append(s(
    7, "split-automation-handler-test-run",
    "Split automation_handler.go - Test-Run/Conflict/Webhook Helpers",
    r"internal\api\automation_handler.go",
    [r"internal\api\automation_handler_test_run.go"],
    [
        "HTTP handlers that perform a dry-run / test-run of an automation against synthesized state.",
        "Conflict-detection helpers used to flag overlapping automations.",
        "Webhook trigger helpers that route inbound webhook calls into the automation engine.",
    ],
    "extract automation handler test-run/conflict/webhook helpers",
))
PROMPTS.append(v(
    8, "validate-automation-handler-split",
    "Validate Split of automation_handler.go",
    r"internal\api\automation_handler.go",
    [
        r"internal\api\automation_handler_dtos.go",
        r"internal\api\automation_handler_decode.go",
        r"internal\api\automation_handler_step_parsers.go",
        r"internal\api\automation_handler_crud.go",
        r"internal\api\automation_handler_history.go",
        r"internal\api\automation_handler_test_run.go",
    ],
    "Re-run gates against the six new automation_handler files and the trimmed source file",
))

# ---- telemetry_sessions.go (2317 lines) ----
PROMPTS.append(s(
    9, "split-telemetry-sessions-recovery",
    "Split telemetry_sessions.go - Recovery",
    r"internal\api\telemetry_sessions.go",
    [r"internal\api\telemetry_sessions_recovery.go"],
    [
        "Functions that recover open drive and charging sessions from the database on startup.",
        "Helpers that rebuild in-memory session state from `signal_log` and snapshot tables.",
        "Recovery-only logging and error wrapping (preserve every existing log field and message).",
    ],
    "extract telemetry sessions recovery code",
))
PROMPTS.append(s(
    10, "split-telemetry-sessions-signal-helpers",
    "Split telemetry_sessions.go - Signal Extraction Helpers",
    r"internal\api\telemetry_sessions.go",
    [r"internal\api\telemetry_sessions_signal_helpers.go"],
    [
        "Helpers that extract typed values (float, int, bool, time, geo) from the in-memory signal store keyed by signal name.",
        "Helpers that compose multi-signal lookups (e.g., charge state vs. charger power) used by both drive and charge tracking.",
        "Pure conversion helpers that operate on signal values without touching session state.",
    ],
    "extract telemetry sessions signal extraction helpers",
))
PROMPTS.append(s(
    11, "split-telemetry-sessions-drive-tracking",
    "Split telemetry_sessions.go - Drive Session Tracking",
    r"internal\api\telemetry_sessions.go",
    [r"internal\api\telemetry_sessions_drive_tracking.go"],
    [
        "Drive-session lifecycle: detect drive start, update in-progress drive, detect drive end.",
        "Drive-segment merging logic and the rules that decide when a drive should be split.",
        "Drive-only persistence helpers that write to `drives` and related tables.",
    ],
    "extract telemetry drive session tracking",
))
PROMPTS.append(s(
    12, "split-telemetry-sessions-charge-tracking",
    "Split telemetry_sessions.go - Charge Session Tracking",
    r"internal\api\telemetry_sessions.go",
    [r"internal\api\telemetry_sessions_charge_tracking.go"],
    [
        "Charge-session lifecycle: detect charge start, update in-progress charge, detect charge end.",
        "Connector/charger metadata enrichment that runs only during a charge.",
        "Charge-only persistence helpers that write to `charging_sessions` and related tables.",
    ],
    "extract telemetry charge session tracking",
))
PROMPTS.append(s(
    13, "split-telemetry-sessions-flush-backfill",
    "Split telemetry_sessions.go - Flush and Backfill",
    r"internal\api\telemetry_sessions.go",
    [r"internal\api\telemetry_sessions_flush_backfill.go"],
    [
        "Periodic flush helpers that drain pending session writes to the database.",
        "Backfill helpers that reconcile session state from `signal_log` after gaps or restarts.",
        "Idle-session expiry helpers that close stale in-memory sessions.",
    ],
    "extract telemetry sessions flush/backfill",
))
PROMPTS.append(v(
    14, "validate-telemetry-sessions-split",
    "Validate Split of telemetry_sessions.go",
    r"internal\api\telemetry_sessions.go",
    [
        r"internal\api\telemetry_sessions_recovery.go",
        r"internal\api\telemetry_sessions_signal_helpers.go",
        r"internal\api\telemetry_sessions_drive_tracking.go",
        r"internal\api\telemetry_sessions_charge_tracking.go",
        r"internal\api\telemetry_sessions_flush_backfill.go",
    ],
    "Re-run gates against the five new telemetry_sessions files and the trimmed source file",
))

# ---- telemetry_handler.go (1668 lines) ----
PROMPTS.append(s(
    15, "split-telemetry-handler-wiring",
    "Split telemetry_handler.go - Handler Wiring and Config",
    r"internal\api\telemetry_handler.go",
    [r"internal\api\telemetry_handler_wiring.go"],
    [
        "Constructor(s) that wire the telemetry handler with its dependencies (signal store, redis cache, repos, session tracker).",
        "Handler-level config struct(s) and option functions used only at construction time.",
        "Lifecycle hooks (Start/Stop/Close) that own the handler's background goroutines or channels.",
    ],
    "extract telemetry handler wiring and config",
))
PROMPTS.append(s(
    16, "split-telemetry-handler-ingest",
    "Split telemetry_handler.go - Ingest and Batch Processing",
    r"internal\api\telemetry_handler.go",
    [r"internal\api\telemetry_handler_ingest.go"],
    [
        "MQTT/HTTP ingest entrypoints that accept a batch of telemetry messages.",
        "Per-batch normalization, deduplication, and ordering helpers.",
        "Per-message handlers that route signals into the live store, the session tracker, and the durable signal_log writer.",
    ],
    "extract telemetry handler ingest and batch processing",
))
PROMPTS.append(s(
    17, "split-telemetry-handler-live-store",
    "Split telemetry_handler.go - Live Store Updates",
    r"internal\api\telemetry_handler.go",
    [r"internal\api\telemetry_handler_live_store.go"],
    [
        "Helpers that write into the in-process `signal.Store` L1 cache.",
        "Helpers that mirror current-state values into the Redis HSET L2 (`vehicle:{vehicleID}:signals`).",
        "Helpers that publish change notifications on the Redis `vehicle_signals` pub/sub channel.",
    ],
    "extract telemetry handler live store updates",
))
PROMPTS.append(s(
    18, "split-telemetry-handler-sse",
    "Split telemetry_handler.go - SSE Broadcasting",
    r"internal\api\telemetry_handler.go",
    [r"internal\api\telemetry_handler_sse.go"],
    [
        "Server-Sent Events HTTP handler(s) for live signal streaming.",
        "Per-connection fan-out, keep-alive, and cancellation logic.",
        "Filtering helpers that decide which signals a given subscriber should receive.",
    ],
    "extract telemetry handler SSE broadcasting",
))
PROMPTS.append(s(
    19, "split-telemetry-handler-capture",
    "Split telemetry_handler.go - Capture and Debug Endpoints",
    r"internal\api\telemetry_handler.go",
    [r"internal\api\telemetry_handler_capture.go"],
    [
        "Debug capture endpoints that dump recent raw telemetry batches to disk or to the response.",
        "Per-vehicle replay/diagnostic endpoints that read directly from `signal_log`.",
        "Capture-only DTOs that are not used by ingest, live store, or SSE.",
    ],
    "extract telemetry handler capture/debug endpoints",
))
PROMPTS.append(v(
    20, "validate-telemetry-handler-split",
    "Validate Split of telemetry_handler.go",
    r"internal\api\telemetry_handler.go",
    [
        r"internal\api\telemetry_handler_wiring.go",
        r"internal\api\telemetry_handler_ingest.go",
        r"internal\api\telemetry_handler_live_store.go",
        r"internal\api\telemetry_handler_sse.go",
        r"internal\api\telemetry_handler_capture.go",
    ],
    "Re-run gates against the five new telemetry_handler files and the trimmed source file",
))

# ---- tesla/client.go (950 lines) ----
PROMPTS.append(s(
    21, "split-tesla-client-auth",
    "Split tesla/client.go - Auth and Token Methods",
    r"internal\tesla\client.go",
    [r"internal\tesla\client_auth.go"],
    [
        "OAuth2 token acquisition, refresh, and revocation helpers.",
        "Token storage abstraction methods on the client (read/write through the configured token store).",
        "Auth-related HTTP request signing helpers (Authorization header injection, partner-token wrapping).",
    ],
    "extract tesla client auth/token methods",
))
PROMPTS.append(s(
    22, "split-tesla-client-vehicle-data",
    "Split tesla/client.go - Vehicle Data Methods",
    r"internal\tesla\client.go",
    [r"internal\tesla\client_vehicle_data.go"],
    [
        "Vehicle list and per-vehicle metadata fetchers.",
        "Vehicle data endpoints that return state snapshots (drive_state, charge_state, climate_state, vehicle_state, vehicle_config).",
        "Vehicle wake / wake_up helpers.",
    ],
    "extract tesla client vehicle data methods",
))
PROMPTS.append(s(
    23, "split-tesla-client-commands",
    "Split tesla/client.go - Command and Proxy Methods",
    r"internal\tesla\client.go",
    [r"internal\tesla\client_commands.go"],
    [
        "Command endpoints (door lock, climate, charging, honk, flash, navigation, sentry mode).",
        "Vehicle command proxy helpers that route through the command-proxy service when configured.",
        "Command response decoding and error mapping helpers used only by commands.",
    ],
    "extract tesla client command/proxy methods",
))
PROMPTS.append(s(
    24, "split-tesla-client-fleet-telemetry",
    "Split tesla/client.go - Fleet Telemetry Methods",
    r"internal\tesla\client.go",
    [r"internal\tesla\client_fleet_telemetry.go"],
    [
        "Fleet Telemetry config registration and inspection methods.",
        "Per-vehicle telemetry stream subscription and unsubscription helpers.",
        "Fleet-Telemetry-only DTOs and helpers used solely by these methods.",
    ],
    "extract tesla client Fleet Telemetry methods",
))
PROMPTS.append(s(
    25, "split-tesla-client-partner-devtools",
    "Split tesla/client.go - Partner and DevTools Methods",
    r"internal\tesla\client.go",
    [r"internal\tesla\client_partner_devtools.go"],
    [
        "Partner-account endpoints (register partner, list partner vehicles, partner key rotation).",
        "DevTools-only endpoints used by the internal devtools handler.",
        "Public-key publication helpers used during partner registration.",
    ],
    "extract tesla client partner/devtools methods",
))
PROMPTS.append(s(
    26, "split-tesla-client-energy-charging",
    "Split tesla/client.go - Energy and Charging Methods",
    r"internal\tesla\client.go",
    [r"internal\tesla\client_energy_charging.go"],
    [
        "Energy product list and energy-site state helpers.",
        "Charging history endpoints (`/api/1/dx/charging/history` and friends).",
        "Energy/charging-only DTOs used solely by these methods.",
    ],
    "extract tesla client energy/charging methods",
))
PROMPTS.append(v(
    27, "validate-tesla-client-split",
    "Validate Split of tesla/client.go",
    r"internal\tesla\client.go",
    [
        r"internal\tesla\client_auth.go",
        r"internal\tesla\client_vehicle_data.go",
        r"internal\tesla\client_commands.go",
        r"internal\tesla\client_fleet_telemetry.go",
        r"internal\tesla\client_partner_devtools.go",
        r"internal\tesla\client_energy_charging.go",
    ],
    "Re-run gates against the six new tesla client files and the trimmed source file",
))


# ---- single-file medium splits (28-51) ----

PROMPTS.append(s(
    28, "split-router",
    "Split router.go - Routes by Domain and Middleware",
    r"internal\api\router.go",
    [
        r"internal\api\router_routes_telemetry.go",
        r"internal\api\router_routes_admin.go",
        r"internal\api\router_middleware.go",
    ],
    [
        "Telemetry-related route registrations (vehicles, drives, charging, signals, telemetry, SSE) -> router_routes_telemetry.go.",
        "Admin/devtools/system route registrations (system status, audit, devtools, version, automation) -> router_routes_admin.go.",
        "Middleware setup (auth, rate-limit, logging, CORS, request-id) and middleware factory functions -> router_middleware.go.",
        "The exported NewRouter / SetupRoutes entrypoint must remain in router.go and call the extracted route-registration functions in the same order they appear today.",
    ],
    "split router by domain and middleware",
))
PROMPTS.append(s(
    29, "split-devtools-handler",
    "Split devtools_handler.go - DTOs / Logs / Database",
    r"internal\api\devtools_handler.go",
    [
        r"internal\api\devtools_handler_dtos.go",
        r"internal\api\devtools_handler_logs.go",
        r"internal\api\devtools_handler_database.go",
    ],
    [
        "Request and response DTO types used by devtools endpoints -> devtools_handler_dtos.go.",
        "Log inspection / api-log endpoints and their helpers -> devtools_handler_logs.go.",
        "Database inspection / migration-status / signal-log replay endpoints -> devtools_handler_database.go.",
    ],
    "split devtools handler by concern",
))
PROMPTS.append(s(
    30, "split-models",
    "Split models.go - Domain-Grouped Model Files",
    r"internal\models\models.go",
    [
        r"internal\models\vehicle.go",
        r"internal\models\drive.go",
        r"internal\models\charging.go",
        r"internal\models\telemetry.go",
    ],
    [
        "Vehicle, VehicleConfig, and related per-vehicle model types -> vehicle.go.",
        "Drive, DriveSegment, and drive-related telemetry model types -> drive.go.",
        "ChargingSession, ChargingTelemetry, and charging-related model types -> charging.go.",
        "Generic telemetry/signal model types and any model used across multiple domains -> telemetry.go.",
    ],
    "split models.go by domain",
))
PROMPTS.append(s(
    31, "split-battery-degradation-handler",
    "Split battery_degradation_handler.go - DTOs and Calculations",
    r"internal\api\battery_degradation_handler.go",
    [
        r"internal\api\battery_degradation_handler_dtos.go",
        r"internal\api\battery_degradation_handler_calculations.go",
    ],
    [
        "Request/response DTOs used by battery-degradation endpoints -> battery_degradation_handler_dtos.go.",
        "Pure calculation helpers (degradation curve fitting, projection, smoothing) used by the handlers -> battery_degradation_handler_calculations.go.",
    ],
    "split battery degradation handler",
))
PROMPTS.append(s(
    32, "split-drive-handler",
    "Split drive_handler.go - DTOs / Listing / Detail",
    r"internal\api\drive_handler.go",
    [
        r"internal\api\drive_handler_dtos.go",
        r"internal\api\drive_handler_listing.go",
        r"internal\api\drive_handler_detail.go",
    ],
    [
        "Drive request/response DTOs and pagination structs -> drive_handler_dtos.go.",
        "List/search drive endpoints and their query helpers -> drive_handler_listing.go.",
        "Drive detail endpoints (drive metadata + telemetry + segments) and their assembly helpers -> drive_handler_detail.go.",
    ],
    "split drive handler",
))
PROMPTS.append(s(
    33, "split-cmd-main",
    "Split cmd/teslasync/main.go - Setup and Lifecycle",
    r"cmd\teslasync\main.go",
    [
        r"cmd\teslasync\setup.go",
        r"cmd\teslasync\lifecycle.go",
    ],
    [
        "Dependency wiring (DB pool, Redis client, MQTT client, Tesla client, repositories, handlers) -> setup.go.",
        "Process lifecycle (signal handling, graceful shutdown, background goroutine supervision, health-check wiring) -> lifecycle.go.",
        "`func main()` must stay in main.go and orchestrate the extracted setup and lifecycle functions in the same order.",
    ],
    "split cmd/teslasync/main into setup and lifecycle",
))
PROMPTS.append(s(
    34, "split-signal-history-writer",
    "Split signal_history_writer.go - Buffer and Flush",
    r"internal\database\signal_history_writer.go",
    [
        r"internal\database\signal_history_writer_buffer.go",
        r"internal\database\signal_history_writer_flush.go",
    ],
    [
        "In-memory buffering, batching, and back-pressure helpers -> signal_history_writer_buffer.go.",
        "Database flush path: COPY/INSERT execution, retry-on-failure, backlog persistence to the `signal_log:backlog` Redis list -> signal_history_writer_flush.go.",
    ],
    "split signal history writer",
))
PROMPTS.append(s(
    35, "split-automation-step-child-repo",
    "Split automation_step_child_repo.go - Persistence and Query",
    r"internal\database\automation_step_child_repo.go",
    [
        r"internal\database\automation_step_child_repo_persistence.go",
        r"internal\database\automation_step_child_repo_query.go",
    ],
    [
        "Insert/update/delete methods for automation step children -> automation_step_child_repo_persistence.go.",
        "Read methods (list-by-parent, get-by-id, traversal helpers) -> automation_step_child_repo_query.go.",
    ],
    "split automation step child repo",
))
PROMPTS.append(s(
    36, "split-automation-engine",
    "Split automation/engine.go - Evaluation and Execution",
    r"internal\automation\engine.go",
    [
        r"internal\automation\engine_evaluation.go",
        r"internal\automation\engine_execution.go",
    ],
    [
        "Trigger matching and condition evaluation -> engine_evaluation.go.",
        "Action execution, side-effect dispatch, and per-run audit recording -> engine_execution.go.",
        "The exported `Engine` struct, its constructor, and its main `Run` entrypoint must remain in engine.go and call the extracted evaluation/execution functions.",
    ],
    "split automation engine",
))
PROMPTS.append(s(
    37, "split-worker",
    "Split worker.go - Jobs and Lifecycle",
    r"internal\worker\worker.go",
    [
        r"internal\worker\worker_jobs.go",
        r"internal\worker\worker_lifecycle.go",
    ],
    [
        "Per-job handler functions and the dispatch table that maps job kind to handler -> worker_jobs.go.",
        "Worker lifecycle: start, stop, queue polling loop, graceful drain -> worker_lifecycle.go.",
    ],
    "split worker",
))
PROMPTS.append(s(
    38, "split-range-projection-handler",
    "Split range_projection_handler.go - DTOs and Compute",
    r"internal\api\range_projection_handler.go",
    [
        r"internal\api\range_projection_handler_dtos.go",
        r"internal\api\range_projection_handler_compute.go",
    ],
    [
        "Request/response DTOs used by range-projection endpoints -> range_projection_handler_dtos.go.",
        "Pure projection/compute helpers (consumption modeling, terrain/weather adjustment, confidence interval) -> range_projection_handler_compute.go.",
    ],
    "split range projection handler",
))
PROMPTS.append(s(
    39, "split-alert-handler",
    "Split alert_handler.go - DTOs and Rules",
    r"internal\api\alert_handler.go",
    [
        r"internal\api\alert_handler_dtos.go",
        r"internal\api\alert_handler_rules.go",
    ],
    [
        "Alert request/response DTOs and list/page wrappers -> alert_handler_dtos.go.",
        "Rule CRUD and rule evaluation/test endpoints -> alert_handler_rules.go.",
    ],
    "split alert handler",
))
PROMPTS.append(s(
    40, "split-charging-optimizer-handler",
    "Split charging_optimizer_handler.go - DTOs and Compute",
    r"internal\api\charging_optimizer_handler.go",
    [
        r"internal\api\charging_optimizer_handler_dtos.go",
        r"internal\api\charging_optimizer_handler_compute.go",
    ],
    [
        "Request/response DTOs used by charging-optimizer endpoints -> charging_optimizer_handler_dtos.go.",
        "Optimization compute helpers (slot selection, off-peak window scoring, schedule generation) -> charging_optimizer_handler_compute.go.",
    ],
    "split charging optimizer handler",
))
PROMPTS.append(s(
    41, "split-fsm-handler",
    "Split fsm_handler.go - DTOs and Query",
    r"internal\api\fsm_handler.go",
    [
        r"internal\api\fsm_handler_dtos.go",
        r"internal\api\fsm_handler_query.go",
    ],
    [
        "FSM state/transition DTOs used by the handler -> fsm_handler_dtos.go.",
        "FSM query endpoints (current state, recent transitions, per-vehicle FSM history) -> fsm_handler_query.go.",
    ],
    "split fsm handler",
))
PROMPTS.append(s(
    42, "split-charge-planner-handler",
    "Split charge_planner_handler.go - DTOs and Compute",
    r"internal\api\charge_planner_handler.go",
    [
        r"internal\api\charge_planner_handler_dtos.go",
        r"internal\api\charge_planner_handler_compute.go",
    ],
    [
        "Charge-planner request/response DTOs -> charge_planner_handler_dtos.go.",
        "Plan computation (target SoC selection, departure-time backfill, multi-stop planning) -> charge_planner_handler_compute.go.",
    ],
    "split charge planner handler",
))
PROMPTS.append(s(
    43, "split-analytics-handler",
    "Split analytics_handler.go - DTOs and Queries",
    r"internal\api\analytics_handler.go",
    [
        r"internal\api\analytics_handler_dtos.go",
        r"internal\api\analytics_handler_queries.go",
    ],
    [
        "Analytics request/response DTOs (fleet, TCO, sleep, regen, degradation, speed-profile, etc.) -> analytics_handler_dtos.go.",
        "Per-endpoint query orchestration that calls into repositories and assembles the response -> analytics_handler_queries.go.",
    ],
    "split analytics handler",
))
PROMPTS.append(s(
    44, "split-signal-log-reader",
    "Split signal_log_reader.go - Query and Aggregations",
    r"internal\database\signal_log_reader.go",
    [
        r"internal\database\signal_log_reader_query.go",
        r"internal\database\signal_log_reader_aggregations.go",
    ],
    [
        "Point-in-time and range-scan query methods over `signal_log` -> signal_log_reader_query.go.",
        "Aggregation methods (continuous-aggregate views, bucketed downsampling) -> signal_log_reader_aggregations.go.",
    ],
    "split signal log reader",
))
PROMPTS.append(s(
    45, "split-trip-planner-handler",
    "Split trip_planner_handler.go - DTOs and Compute",
    r"internal\api\trip_planner_handler.go",
    [
        r"internal\api\trip_planner_handler_dtos.go",
        r"internal\api\trip_planner_handler_compute.go",
    ],
    [
        "Trip-planner request/response DTOs -> trip_planner_handler_dtos.go.",
        "Trip computation (route segmentation, charge-stop insertion, ETA recompute) -> trip_planner_handler_compute.go.",
    ],
    "split trip planner handler",
))
PROMPTS.append(s(
    46, "split-enums-parse",
    "Split enums/parse.go - Per-Domain Parser Files",
    r"internal\enums\parse.go",
    [
        r"internal\enums\parse_drive.go",
        r"internal\enums\parse_charging.go",
        r"internal\enums\parse_climate.go",
    ],
    [
        "Drive/shift/gear enum parsers -> parse_drive.go.",
        "Charging-state and connector enum parsers -> parse_charging.go.",
        "Climate, HVAC, and seat-heater enum parsers -> parse_climate.go.",
        "If a parser does not fit any of the three domains it must remain in parse.go.",
    ],
    "split enums parse by domain",
))
PROMPTS.append(s(
    47, "split-tesla-energy-history-handler",
    "Split tesla_energy_history_handler.go - DTOs and Query",
    r"internal\api\tesla_energy_history_handler.go",
    [
        r"internal\api\tesla_energy_history_handler_dtos.go",
        r"internal\api\tesla_energy_history_handler_query.go",
    ],
    [
        "Energy-history request/response DTOs -> tesla_energy_history_handler_dtos.go.",
        "Energy-history query orchestration and Tesla-API response normalization -> tesla_energy_history_handler_query.go.",
    ],
    "split tesla energy history handler",
))
PROMPTS.append(s(
    48, "split-notification-repo",
    "Split notification_repo.go - Logs and Rules",
    r"internal\database\notification_repo.go",
    [
        r"internal\database\notification_repo_logs.go",
        r"internal\database\notification_repo_rules.go",
    ],
    [
        "Notification log table CRUD and stats queries -> notification_repo_logs.go.",
        "Notification rule table CRUD and lookup helpers -> notification_repo_rules.go.",
    ],
    "split notification repo",
))
PROMPTS.append(s(
    49, "split-automation-repo",
    "Split automation_repo.go - Query and Mutation",
    r"internal\database\automation_repo.go",
    [
        r"internal\database\automation_repo_query.go",
        r"internal\database\automation_repo_mutation.go",
    ],
    [
        "Read methods (list, get-by-id, list-with-children, history queries) -> automation_repo_query.go.",
        "Write methods (insert, update, delete, soft-delete, version bump) -> automation_repo_mutation.go.",
    ],
    "split automation repo",
))
PROMPTS.append(s(
    50, "split-chatbot-handler",
    "Split chatbot_handler.go - DTOs and Chat",
    r"internal\api\chatbot_handler.go",
    [
        r"internal\api\chatbot_handler_dtos.go",
        r"internal\api\chatbot_handler_chat.go",
    ],
    [
        "Chatbot request/response DTOs and conversation models -> chatbot_handler_dtos.go.",
        "Chat endpoint(s), prompt assembly, and provider invocation -> chatbot_handler_chat.go.",
    ],
    "split chatbot handler",
))
PROMPTS.append(s(
    51, "split-metrics",
    "Split metrics.go - Telemetry and Drive/Charging Metrics",
    r"internal\metrics\metrics.go",
    [
        r"internal\metrics\metrics_telemetry.go",
        r"internal\metrics\metrics_drive_charging.go",
    ],
    [
        "Telemetry/MQTT/SSE Prometheus collectors and registration -> metrics_telemetry.go.",
        "Drive and charging session Prometheus collectors and registration -> metrics_drive_charging.go.",
        "The `Init()` / `MustRegister(...)` exported entrypoints must remain in metrics.go and call the extracted registration functions in their original order.",
    ],
    "split metrics",
))

PROMPTS.append(v(
    52, "validate-medium-splits",
    "Validate Medium Splits (Prompts 28-51)",
    "internal/api/router.go",
    [
        r"internal\api\router_routes_telemetry.go",
        r"internal\api\router_routes_admin.go",
        r"internal\api\router_middleware.go",
        r"internal\api\devtools_handler_dtos.go",
        r"internal\api\devtools_handler_logs.go",
        r"internal\api\devtools_handler_database.go",
        r"internal\models\vehicle.go",
        r"internal\models\drive.go",
        r"internal\models\charging.go",
        r"internal\models\telemetry.go",
        r"internal\api\battery_degradation_handler_dtos.go",
        r"internal\api\battery_degradation_handler_calculations.go",
        r"internal\api\drive_handler_dtos.go",
        r"internal\api\drive_handler_listing.go",
        r"internal\api\drive_handler_detail.go",
        r"cmd\teslasync\setup.go",
        r"cmd\teslasync\lifecycle.go",
        r"internal\database\signal_history_writer_buffer.go",
        r"internal\database\signal_history_writer_flush.go",
        r"internal\database\automation_step_child_repo_persistence.go",
        r"internal\database\automation_step_child_repo_query.go",
        r"internal\automation\engine_evaluation.go",
        r"internal\automation\engine_execution.go",
        r"internal\worker\worker_jobs.go",
        r"internal\worker\worker_lifecycle.go",
        r"internal\api\range_projection_handler_dtos.go",
        r"internal\api\range_projection_handler_compute.go",
        r"internal\api\alert_handler_dtos.go",
        r"internal\api\alert_handler_rules.go",
        r"internal\api\charging_optimizer_handler_dtos.go",
        r"internal\api\charging_optimizer_handler_compute.go",
        r"internal\api\fsm_handler_dtos.go",
        r"internal\api\fsm_handler_query.go",
        r"internal\api\charge_planner_handler_dtos.go",
        r"internal\api\charge_planner_handler_compute.go",
        r"internal\api\analytics_handler_dtos.go",
        r"internal\api\analytics_handler_queries.go",
        r"internal\database\signal_log_reader_query.go",
        r"internal\database\signal_log_reader_aggregations.go",
        r"internal\api\trip_planner_handler_dtos.go",
        r"internal\api\trip_planner_handler_compute.go",
        r"internal\enums\parse_drive.go",
        r"internal\enums\parse_charging.go",
        r"internal\enums\parse_climate.go",
        r"internal\api\tesla_energy_history_handler_dtos.go",
        r"internal\api\tesla_energy_history_handler_query.go",
        r"internal\database\notification_repo_logs.go",
        r"internal\database\notification_repo_rules.go",
        r"internal\database\automation_repo_query.go",
        r"internal\database\automation_repo_mutation.go",
        r"internal\api\chatbot_handler_dtos.go",
        r"internal\api\chatbot_handler_chat.go",
        r"internal\metrics\metrics_telemetry.go",
        r"internal\metrics\metrics_drive_charging.go",
    ],
    "Re-run gates against all medium-split outputs from prompts 28-51",
))


BASELINE_LINES = {
    r"internal\api\automation_handler.go": 2969,
    r"internal\api\telemetry_sessions.go": 2317,
    r"internal\api\telemetry_handler.go": 1668,
    r"internal\api\router.go": 1110,
    r"internal\api\devtools_handler.go": 1049,
    r"internal\models\models.go": 971,
    r"internal\tesla\client.go": 950,
    r"internal\api\battery_degradation_handler.go": 794,
    r"internal\api\drive_handler.go": 777,
    r"internal\automation\engine.go": 745,
    r"cmd\teslasync\main.go": 632,
    r"internal\database\signal_history_writer.go": 625,
    r"internal\database\automation_step_child_repo.go": 618,
    r"internal\worker\worker.go": 598,
    r"internal\api\range_projection_handler.go": 581,
    r"internal\api\alert_handler.go": 574,
    r"internal\api\charging_optimizer_handler.go": 559,
    r"internal\api\fsm_handler.go": 530,
    r"internal\api\charge_planner_handler.go": 529,
    r"internal\api\analytics_handler.go": 529,
    r"internal\database\signal_log_reader.go": 502,
    r"internal\api\trip_planner_handler.go": 500,
    r"internal\enums\parse.go": 478,
    r"internal\api\tesla_energy_history_handler.go": 448,
    r"internal\database\notification_repo.go": 446,
    r"internal\database\automation_repo.go": 437,
    r"internal\api\chatbot_handler.go": 433,
    r"internal\metrics\metrics.go": 428,
}


def main():
    PHASE_DIR.mkdir(parents=True, exist_ok=True)

    # Auto-derive predecessors for split/validation entries
    for i, p in enumerate(PROMPTS):
        if i == 0:
            p["predecessor"] = (1, "create-split-map-template")
        else:
            prev = PROMPTS[i - 1]
            p["predecessor"] = (prev["num"], prev["slug"])

    written = []

    inv = render_inventory()
    f0 = PHASE_DIR / "00-go-monolith-inventory.prompt.md"
    f0.write_text(inv, encoding="utf-8")
    written.append(f0)

    tpl = render_template()
    f1 = PHASE_DIR / "01-create-split-map-template.prompt.md"
    f1.write_text(tpl, encoding="utf-8")
    written.append(f1)

    for p in PROMPTS:
        if p["kind"] == "split":
            md = render_split(p)
        else:
            md = render_validation(p)
        fp = PHASE_DIR / f"{p['num']:02d}-{p['slug']}.prompt.md"
        fp.write_text(md, encoding="utf-8")
        written.append(fp)

    final_predecessors = [(p["num"], p["slug"]) for p in PROMPTS]
    fg = render_final_gate(final_predecessors, BASELINE_LINES)
    f99 = PHASE_DIR / "99-final-go-monolith-gate.prompt.md"
    f99.write_text(fg, encoding="utf-8")
    written.append(f99)

    print(f"wrote {len(written)} prompt files to {PHASE_DIR}")
    for f in written:
        print(f"  {f.name}  ({f.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
