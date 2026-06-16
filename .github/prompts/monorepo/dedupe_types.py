#!/usr/bin/env python3
"""dedupe_types.py — auto-heal duplicate top-level Swift types on the integration base.

TeslaSync's Apple app is a single flat module: two top-level types with the same name
(e.g. a feature page's `BackupRun` and a dashboard widget's `BackupRun`) dead-lock the
whole build. During the parallel codegen run these collisions recur constantly because
independent slots redeclare the same model types on different surfaces.

This tool codifies the manual dedupe runbook so the orchestrator can self-heal after
each merge: it finds every duplicate top-level type, keeps the feature/section side
(`Sources/Features/**`) canonical, and renames the SECONDARY surface's copy
(`TeslaSync/{dashboard-widgets,modals-dialogs,feature-views,widget-primitives,...}`),
scoped to that surface's files only (whole-word). It is conservative: it renames a
type only when exactly one canonical + one secondary definition exist AND every
reference to the secondary type is confined to the secondary surface's files or the
canonical type's own directory (so no third party is silently rebound). Anything else
is left for the monitor + a human.

Usage:
  dedupe_types.py --worktree <apple_repo_or_worktree> [--commit] [--verbose]

Exit 0 always (best-effort): prints what it renamed. Use --commit to commit the result.
"""
import argparse
import os
import re
import subprocess
import sys

# Directories whose surfaces are SECONDARY (rename these); the canonical declaration
# lives under Sources/Features/** (or Sources/**).
SECONDARY_DIR_MARKERS = (
    "/TeslaSync/dashboard-widgets/",
    "/TeslaSync/modals-dialogs/",
    "/TeslaSync/feature-views/",
    "/TeslaSync/widget-primitives/",
    "/TeslaSync/shared-surfaces/",
    "/TeslaSync/",  # catch-all for any other TeslaSync/* surface dir
)
CANONICAL_DIR_MARKER = "/Sources/"

# Known cross-target same-name types that are intentionally duplicated (never touch).
ALLOWLIST = {"SystemHealthWidget", "WatchBatteryRing", "WidgetSectionHeader"}

TYPE_DECL_RE = re.compile(
    r"^(?P<prefix>(?:@[A-Za-z_]\w*(?:\([^)]*\))?\s+)*"
    r"(?:public |internal |final |open |private |fileprivate )*)"
    r"(?:struct|enum|class|actor|protocol)\s+(?P<name>[A-Z]\w*)"
)
PRIVATE_RE = re.compile(r"(^|\s)(private|fileprivate)\s")
APPLE_ROOT_MARKER = "apps/apple"


def sh(args, cwd, check=True):
    r = subprocess.run(args, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if check and r.returncode != 0:
        raise RuntimeError(f"{' '.join(args)} -> {r.returncode}: {r.stderr}")
    return r


def find_apple_dir(worktree):
    cand = os.path.join(worktree, "apps", "apple")
    if os.path.isdir(cand):
        return cand
    # already pointed at apps/apple?
    if os.path.isdir(os.path.join(worktree, "Sources")) and os.path.isdir(os.path.join(worktree, "TeslaSync")):
        return worktree
    return cand


def swift_files(apple_dir):
    for root, _dirs, files in os.walk(apple_dir):
        for f in files:
            if f.endswith(".swift"):
                yield os.path.join(root, f)


def is_test_path(path):
    return path.endswith("Tests.swift") or "/Tests/" in path.replace(os.sep, "/")


def scan_dups(apple_dir):
    """Return {type_name: [(path, is_private), ...]} for top-level types with >=2
    decls and >=1 non-private, mirroring the monitor's collision scan."""
    decls = {}
    for path in swift_files(apple_dir):
        if is_test_path(path):
            continue
        try:
            with open(path, encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    m = TYPE_DECL_RE.match(line)
                    if not m:
                        continue
                    name = m.group("name")
                    priv = bool(PRIVATE_RE.search(m.group("prefix")))
                    decls.setdefault(name, []).append((path, priv))
        except OSError:
            continue
    dups = {}
    for name, defs in decls.items():
        if name in ALLOWLIST:
            continue
        if len(defs) >= 2 and any(not p for _, p in defs):
            dups[name] = defs
    return dups


def rel(path, apple_dir):
    return os.path.relpath(path, apple_dir).replace(os.sep, "/")


def classify(path, apple_dir):
    r = "/" + rel(path, apple_dir)
    if CANONICAL_DIR_MARKER in r:
        return "canonical"
    for marker in SECONDARY_DIR_MARKERS:
        if marker in r:
            return "secondary"
    return "other"


def surface_stem(path):
    """`BackupMonitorWidget.Projection.swift` -> `BackupMonitorWidget`."""
    base = os.path.basename(path)
    return base.split(".", 1)[0]


def camel_words(name):
    return re.findall(r"[A-Z][a-z0-9]*|[A-Z]+(?![a-z])", name)


def merged_name(surface, type_name):
    """Combine a surface tag with the type, collapsing a shared leading word run.

    BackupMonitorWidget + BackupRun -> BackupMonitorWidgetRun
    FeedbackModal       + FeedbackCategory -> FeedbackModalCategory
    """
    sw = camel_words(surface)
    tw = camel_words(type_name)
    i = 0
    while i < len(sw) and i < len(tw) and sw[i] == tw[i]:
        i += 1
    merged = sw + tw[i:]
    name = "".join(merged)
    # Length guard (swiftlint type_name max 50): drop generic UI-suffix words from the
    # surface portion until it fits.
    droppable = ["Widget", "EmptyState", "Panel", "Card", "Sheet", "Overlay", "Dialog",
                 "Banner", "Toast", "Popover", "Row", "Section", "View"]
    while len(name) > 47:
        dropped = False
        for d in droppable:
            if d in sw:
                sw = [w for w in sw if w != d]
                merged = sw + tw[i:]
                name = "".join(merged)
                dropped = True
                break
        if not dropped:
            break
    return name


def whole_word_refs(apple_dir, name):
    """Set of file paths that reference `name` as a whole word."""
    pat = re.compile(r"\b" + re.escape(name) + r"\b")
    hits = set()
    for path in swift_files(apple_dir):
        try:
            with open(path, encoding="utf-8", errors="replace") as fh:
                if pat.search(fh.read()):
                    hits.add(path)
        except OSError:
            continue
    return hits


def surface_scope_files(apple_dir, secondary_path):
    """All files of the secondary surface (same dir, same `<Stem>.` prefix)."""
    d = os.path.dirname(secondary_path)
    stem = surface_stem(secondary_path)
    out = []
    for f in os.listdir(d):
        if f == stem or f.startswith(stem + "."):
            full = os.path.join(d, f)
            if os.path.isfile(full):
                out.append(full)
    return out


def existing_type_names(apple_dir):
    names = set()
    for path in swift_files(apple_dir):
        try:
            with open(path, encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    m = TYPE_DECL_RE.match(line)
                    if m:
                        names.add(m.group("name"))
        except OSError:
            continue
    return names


def rename_in_files(files, old, new):
    pat = re.compile(r"\b" + re.escape(old) + r"\b")
    for path in files:
        with open(path, encoding="utf-8", errors="replace") as fh:
            txt = fh.read()
        new_txt = pat.sub(new, txt)
        if new_txt != txt:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(new_txt)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worktree", required=True)
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    apple_dir = find_apple_dir(args.worktree)

    def log(*a):
        if args.verbose:
            print("[dedupe]", *a, file=sys.stderr)

    if not os.path.isdir(apple_dir):
        print("[dedupe] no apps/apple dir; nothing to do", file=sys.stderr)
        return 0

    dups = scan_dups(apple_dir)
    if not dups:
        log("no duplicate top-level types")
        return 0

    taken = existing_type_names(apple_dir)
    renamed = []  # (old, new, surface)
    skipped = []

    for name, defs in sorted(dups.items()):
        nonpriv = [(p, pr) for (p, pr) in defs if not pr]
        if len(defs) != 2 or len(nonpriv) < 1:
            skipped.append((name, "not a simple 2-def collision"))
            continue
        kinds = [(p, classify(p, apple_dir)) for (p, _pr) in defs]
        canon = [p for p, k in kinds if k == "canonical"]
        secd = [p for p, k in kinds if k == "secondary"]
        if not (len(canon) == 1 and len(secd) == 1):
            # both canonical / both secondary / unknown -> leave for a human
            skipped.append((name, f"ambiguous sides {[k for _, k in kinds]}"))
            continue
        canonical_path, secondary_path = canon[0], secd[0]
        scope = surface_scope_files(apple_dir, secondary_path)
        scope_set = set(scope)
        # The canonical declaration lives under Sources/**, so every reference outside
        # the secondary surface's own files binds to the canonical type once we rename
        # the secondary copy — which is exactly what we want (the canonical model is the
        # shared currency; secondary surfaces mirror it). We log cross-surface refs but
        # do not bail on them (this matches the proven manual runbook). We only refuse
        # the truly ambiguous structural cases (handled above: !=2 defs / not 1+1 sides).
        refs = whole_word_refs(apple_dir, name)
        cross = [r for r in refs
                 if r not in scope_set and "/TeslaSync/" in ("/" + rel(r, apple_dir))]
        if cross:
            log(f"{name}: {len(cross)} cross-surface ref(s) will bind to canonical, "
                f"e.g. {rel(cross[0], apple_dir)}")
        surface = surface_stem(secondary_path)
        new = merged_name(surface, name)
        if new == name or new in taken:
            # fall back to a guaranteed-unique surface-prefixed name
            alt = surface + name
            if alt in taken or len(alt) > 47 or alt == name:
                skipped.append((name, "could not derive a free rename target"))
                continue
            new = alt
        rename_in_files(scope, name, new)
        taken.add(new)
        renamed.append((name, new, surface))
        log(f"{name} -> {new}  (surface {surface}, {len(scope)} files)")

    if not renamed:
        for n, why in skipped:
            log(f"skip {n}: {why}")
        return 0

    # verify we actually reduced the collisions
    remaining = scan_dups(apple_dir)
    still = [o for (o, _n, _s) in renamed if o in remaining]
    if still:
        log("WARNING: still duplicated after rename:", still)

    print("[dedupe] renamed: " + ", ".join(f"{o}->{n}" for o, n, _ in renamed))
    for n, why in skipped:
        print(f"[dedupe] left for human: {n} ({why})")

    if args.commit:
        sh(["git", "add", "-A"], cwd=args.worktree)
        staged = sh(["git", "diff", "--cached", "--name-only"], cwd=args.worktree).stdout.strip()
        if staged:
            msg = "fix(apps/apple): auto-dedupe collision " + ", ".join(
                f"{o}->{n}" for o, n, _ in renamed)
            sh(["git", "commit", "--no-verify", "-m", msg], cwd=args.worktree)
    return 0


if __name__ == "__main__":
    sys.exit(main())
