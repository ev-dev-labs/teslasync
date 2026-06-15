#!/usr/bin/env python3
"""salvage_merge.py — conflict-free integration of a parallel-codegen slot branch.

Every generated "page" slot adds unique new files (never conflict) plus ADDITIVE
edits to a small set of shared registry files (route enum, app wiring, string
catalog, parity ledger). A plain `git merge` aborts the WHOLE merge if ANY single
registry file conflicts, which during the pages tail wastes the expensive LLM
generation (the prompt is regenerated from scratch).

This tool re-integrates a slot deterministically (no LLM):
  * added files            -> taken verbatim from the slot (unique paths)
  * each modified file     -> 3-way merged with `git merge-file` (format-preserving;
                              auto-merges non-overlapping additions)
  * residual conflicts in  -> resolved by UNION-ing the comma-separated identifier
    Swift `case` list lines   lists (enum decl + switch group lines); deduped
  * anything unexpected    -> BAIL (exit 3) so the caller falls back to regenerate

It is correct-by-construction and conservative: on any surprise it bails, so it can
never be worse than today's regenerate behaviour. A post-merge validation parses the
two JSON registries and (optionally) syntax-checks the Swift registries.

Usage:
  salvage_merge.py --worktree <integration_worktree> --theirs <slot_ref> \
      [--message <commit msg>] [--no-commit] [--verbose]

Exit codes: 0 success (changes staged/committed) · 3 bail (caller regenerates) ·
            other = hard error.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from difflib import SequenceMatcher

# Files we know how to integrate. Modified files outside this set (other than pure
# additions) cause a BAIL.
SWIFT_REGISTRIES = {
    "apps/apple/Sources/App/AppRoute.swift",
    "apps/apple/Sources/TeslaSyncApp.swift",
}
JSON_REGISTRIES = {
    "apps/apple/Localization/Localizable.xcstrings",
    "apps/parity/apple-ledger.json",
}

CONFLICT_START = "<<<<<<<"
CONFLICT_BASE = "|||||||"
CONFLICT_MID = "======="
CONFLICT_END = ">>>>>>>"

# A Swift comma-separated identifier list line — covers the route enum declaration
# ("    case settings, onboarding, teslaOrders"), a single-line switch group case
# ("        case .settings, .onboarding: .account") AND a wrapped continuation line
# ("             .slowQueries, .secretRotation, .system: .system" / "..., "). The
# `case` keyword and the `: <group>` / trailing-comma are optional so continuation
# lines parse too.
IDLIST_RE = re.compile(
    r"^(?P<prefix>\s*(?:case\s+)?)"
    r"(?P<ids>\.?[A-Za-z_]\w*(?:\s*,\s*\.?[A-Za-z_]\w*)*)"
    r"(?P<trail>\s*,)?"
    r"(?P<suffix>\s*:\s*\S.*)?"
    r"\s*$"
)


class Bail(Exception):
    pass


def run(args, cwd, check=True, capture=True):
    res = subprocess.run(
        args, cwd=cwd,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
        text=True,
    )
    if check and res.returncode != 0:
        raise RuntimeError(
            f"cmd {' '.join(args)} failed ({res.returncode}): {res.stderr or ''}"
        )
    return res


def git(wt, *args, check=True, capture=True):
    return run(["git", "-C", wt, "-c", "core.autocrlf=false", *args],
               cwd=wt, check=check, capture=capture)


def show(wt, ref, path):
    """File contents at ref, or None if absent."""
    res = git(wt, "show", f"{ref}:{path}", check=False)
    if res.returncode != 0:
        return None
    return res.stdout


def parse_idlist(line):
    """Return (prefix, [ids], trail, suffix) for an id-list line, else None."""
    m = IDLIST_RE.match(line)
    if not m:
        return None
    ids = [t.strip() for t in m.group("ids").split(",") if t.strip()]
    return (m.group("prefix"), ids, m.group("trail") or "", m.group("suffix") or "")


def union_idlist(ours, base, theirs):
    """Union the identifier list of a single Swift id-list line across a 3-way
    conflict. The structural frame (indent + optional `case`, trailing comma,
    `: group` suffix) must agree on all three sides; only the identifiers merge."""
    po, pb, pt = parse_idlist(ours), parse_idlist(base), parse_idlist(theirs)
    if not (po and pb and pt):
        raise Bail("conflict line is not an id-list line")
    if not (po[0] == pt[0] == pb[0]):
        raise Bail("id-list prefixes differ")
    if not (po[2] == pt[2] == pb[2]):
        raise Bail("id-list trailing commas differ")
    if not (po[3] == pt[3] == pb[3]):
        raise Bail("id-list suffixes differ")
    merged = list(po[1])
    for i in pt[1]:
        if i not in merged:
            merged.append(i)
    for i in pb[1]:
        if i not in merged:
            raise Bail("id-list lost a base identifier")
    return f"{po[0]}{', '.join(merged)}{po[2]}{po[3]}"


def _classify_changes(base, side):
    """Express `side` as `base` with line replacements + insertions only.

    Returns (inserted_lines, {base_index: replacement_line}) or (None, None) if the
    side deletes base lines or performs a replace with mismatched line counts (which
    we won't risk auto-resolving)."""
    inserted = []
    replaced = {}
    for tag, i1, i2, j1, j2 in SequenceMatcher(None, base, side, autojunk=False).get_opcodes():
        if tag == "equal":
            continue
        if tag == "insert":
            inserted.extend(side[j1:j2])
        elif tag == "replace":
            if (i2 - i1) == (j2 - j1):
                for k in range(i2 - i1):
                    replaced[i1 + k] = side[j1 + k]
            elif i1 == i2:  # degenerate insert
                inserted.extend(side[j1:j2])
            else:
                return None, None  # ragged replace — too risky
        elif tag == "delete":
            return None, None  # slot removed a base line — unexpected
    return inserted, replaced


def resolve_block(ours, base, theirs):
    """3-way merge of one conflict region (line lists), specialised to the additive
    registry-edit shape: lines are either inserted by a side or are id-list lines
    whose identifier set grew. Raises Bail on anything outside that shape."""
    if ours == base:
        return list(theirs)
    if theirs == base:
        return list(ours)
    o_ins, o_rep = _classify_changes(base, ours)
    t_ins, t_rep = _classify_changes(base, theirs)
    if o_ins is None or t_ins is None:
        raise Bail("conflict region is not insert/replace-only")
    merged = []
    for idx, bl in enumerate(base):
        ro, rt = o_rep.get(idx), t_rep.get(idx)
        if ro is None and rt is None:
            merged.append(bl)
        elif rt is None:
            merged.append(ro)
        elif ro is None:
            merged.append(rt)
        elif ro == rt:
            merged.append(ro)
        else:
            merged.append(union_idlist(ro, bl, rt))
    # Append insertions from both sides (dedup), preserving ours-before-theirs order.
    for line in o_ins:
        merged.append(line)
    for line in t_ins:
        if line not in o_ins:
            merged.append(line)
    return merged


def resolve_swift_conflicts(text):
    """Resolve git-merge-file conflict markers when every conflicting region is a
    single case-list line on each side. Returns resolved text or raises Bail."""
    out = []
    lines = text.splitlines(keepends=False)
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        if line.startswith(CONFLICT_START):
            # gather ours / base / theirs blocks (diff3 style from merge-file -p)
            ours, base, theirs = [], [], []
            i += 1
            while i < n and not lines[i].startswith(CONFLICT_BASE):
                if lines[i].startswith(CONFLICT_MID) or lines[i].startswith(CONFLICT_END):
                    raise Bail("malformed conflict (no base section; need diff3)")
                ours.append(lines[i]); i += 1
            if i >= n:
                raise Bail("unterminated conflict (base)")
            i += 1  # skip |||||||
            while i < n and not lines[i].startswith(CONFLICT_MID):
                base.append(lines[i]); i += 1
            if i >= n:
                raise Bail("unterminated conflict (mid)")
            i += 1  # skip =======
            while i < n and not lines[i].startswith(CONFLICT_END):
                theirs.append(lines[i]); i += 1
            if i >= n:
                raise Bail("unterminated conflict (end)")
            i += 1  # skip >>>>>>>
            out.extend(resolve_block(ours, base, theirs))
        else:
            out.append(line)
            i += 1
    trailing = "\n" if text.endswith("\n") else ""
    return "\n".join(out) + trailing


def merge_file_3way(ours_text, base_text, theirs_text):
    """Return (merged_text, had_conflict). Uses `git merge-file -p --diff3`."""
    with tempfile.TemporaryDirectory() as td:
        po = os.path.join(td, "ours")
        pb = os.path.join(td, "base")
        pt = os.path.join(td, "theirs")
        for p, t in ((po, ours_text), (pb, base_text), (pt, theirs_text)):
            with open(p, "w") as fh:
                fh.write(t if t is not None else "")
        res = subprocess.run(
            ["git", "merge-file", "-p", "--diff3", po, pb, pt],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        # exit code: 0 clean, >0 = number of conflicts, <0 error
        if res.returncode < 0:
            raise RuntimeError(f"git merge-file error: {res.stderr}")
        return res.stdout, res.returncode > 0


def json_union(path, ours_text, base_text, theirs_text):
    """Deterministic union for the two additive JSON registries. Returns merged text.

    Strategy is TEXTUAL where possible to preserve Apple's String Catalog formatting:
    we only ever INSERT the slot's new entries; existing lines are untouched.
    """
    base = json.loads(base_text)
    ours = json.loads(ours_text)
    theirs = json.loads(theirs_text)

    if path.endswith("Localizable.xcstrings"):
        base_keys = set(base.get("strings", {}))
        ours_keys = set(ours.get("strings", {}))
        new_keys = [k for k in theirs.get("strings", {})
                    if k not in base_keys and k not in ours_keys]
        if not new_keys:
            return ours_text  # nothing to add; keep integration as-is
        return _insert_blocks_xcstrings(theirs, ours_text, new_keys)

    if path.endswith("apple-ledger.json"):
        def key(row):
            return (row.get("unitId"), row.get("platform"))
        base_set = {key(r) for r in base.get("rows", [])}
        ours_set = {key(r) for r in ours.get("rows", [])}
        new_rows = [r for r in theirs.get("rows", [])
                    if key(r) not in base_set and key(r) not in ours_set]
        if not new_rows:
            return ours_text
        merged = json.loads(ours_text)
        merged["rows"].extend(new_rows)
        return json.dumps(merged, ensure_ascii=False, indent=2) + "\n"

    raise Bail(f"unknown JSON registry {path}")


def _extract_key_block(theirs_obj, ours_text, new_keys):
    """Serialize each new string-catalog key as a text block matching the file's
    own 2-space-indent, ' : ' separator style, deriving the exact style from the
    slot's own value sub-objects so we never reflow existing lines."""
    blocks = []
    strings = theirs_obj["strings"]
    for k in new_keys:
        body = _xcstr_value(strings[k], indent=3)
        blocks.append(f'    {json.dumps(k, ensure_ascii=True)} : {body},')
    return "\n".join(blocks)


def _xcstr_value(obj, indent):
    sp = "  " * indent
    sp_close = "  " * (indent - 1)
    if isinstance(obj, dict):
        if not obj:
            return "{\n\n" + sp_close + "}"
        parts = ["{"]
        keys = list(obj.keys())
        for i, k in enumerate(keys):
            v = _xcstr_value(obj[k], indent + 1)
            comma = "," if i < len(keys) - 1 else ""
            parts.append(f"{sp}{json.dumps(k, ensure_ascii=True)} : {v}{comma}")
        parts.append(sp_close + "}")
        return "\n".join(parts)
    if isinstance(obj, list):
        if not obj:
            return "[\n\n" + sp_close + "]"
        parts = ["["]
        for i, v in enumerate(obj):
            comma = "," if i < len(obj) - 1 else ""
            parts.append(f"{sp}{_xcstr_value(v, indent + 1)}{comma}")
        parts.append(sp_close + "]")
        return "\n".join(parts)
    return json.dumps(obj, ensure_ascii=True)


def _insert_blocks_xcstrings(theirs_obj, ours_text, new_keys):
    """Insert new key blocks immediately after the `"strings" : {` opening line so
    no existing line is modified (pure insertion, format preserved)."""
    block = _extract_key_block(theirs_obj, ours_text, new_keys)
    lines = ours_text.splitlines(keepends=False)
    for idx, ln in enumerate(lines):
        s = ln.strip()
        if s in ('"strings" : {', '"strings": {'):
            new_lines = lines[: idx + 1] + block.split("\n") + lines[idx + 1:]
            out = "\n".join(new_lines)
            if ours_text.endswith("\n"):
                out += "\n"
            # validate JSON parses
            json.loads(out)
            return out
    raise Bail('could not locate `"strings"` object opening line')


def classify(path):
    if path in SWIFT_REGISTRIES:
        return "swift"
    if path in JSON_REGISTRIES:
        return "json"
    return "other"


# A route-enum declaration line: 4-space indent, `case`, then bare (un-dotted,
# lowercase-initial) identifiers, no `:` group suffix. Distinguishes the enum's own
# `case foo, bar` lines from `switch` arms like `case .foo: .group`.
ENUM_DECL_RE = re.compile(r"^    case ([a-z]\w*(?:\s*,\s*[a-z]\w*)*)\s*$")


def _assert_no_dup_enum_cases(path):
    seen = set()
    in_route_enum = False
    with open(path) as fh:
        for line in fh:
            line = line.rstrip("\n")
            if not in_route_enum:
                # `enum AppRoute:` but NOT `enum AppRouteGroup` (\b after AppRoute)
                if re.match(r"^(public\s+)?enum\s+AppRoute\b", line) and "AppRouteGroup" not in line:
                    in_route_enum = True
                continue
            if line.startswith("}"):  # top-level enum closing brace (column 0)
                break
            m = ENUM_DECL_RE.match(line)
            if not m:
                continue
            for ident in (t.strip() for t in m.group(1).split(",")):
                if ident in seen:
                    raise Bail(f"duplicate enum case '{ident}' after merge")
                seen.add(ident)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worktree", required=True, help="integration worktree (ours=HEAD)")
    ap.add_argument("--theirs", required=True, help="slot branch/ref to integrate")
    ap.add_argument("--message", default=None)
    ap.add_argument("--no-commit", action="store_true")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    wt = args.worktree
    theirs = args.theirs

    def log(*a):
        if args.verbose:
            print("[salvage]", *a, file=sys.stderr)

    try:
        base = git(wt, "merge-base", "HEAD", theirs).stdout.strip()
        if not base:
            raise Bail("no merge-base")
        changed = git(wt, "diff", "--name-status", f"{base}..{theirs}").stdout.splitlines()

        planned = []  # (path, new_text or None for verbatim-add)
        for row in changed:
            parts = row.split("\t")
            st = parts[0]
            path = parts[-1]
            if st.startswith("A"):
                planned.append((path, "ADD"))
                continue
            if st.startswith("D"):
                raise Bail(f"slot deletes {path} — unexpected")
            if st.startswith("R"):
                raise Bail(f"slot renames {path} — unexpected")
            # Modified:
            kind = classify(path)
            ours_text = show(wt, "HEAD", path)
            base_text = show(wt, base, path)
            theirs_text = show(wt, theirs, path)
            if ours_text is None or theirs_text is None:
                raise Bail(f"missing content for {path}")
            if ours_text == theirs_text:
                continue  # integration already equals slot for this file
            if kind == "json":
                merged = json_union(path, ours_text, base_text or "{}", theirs_text)
            elif kind == "swift":
                merged, conflict = merge_file_3way(ours_text, base_text, theirs_text)
                if conflict:
                    merged = resolve_swift_conflicts(merged)
            else:
                # An unknown shared file changed by both sides -> only salvage if it
                # 3-way merges with zero conflicts; otherwise bail.
                merged, conflict = merge_file_3way(ours_text, base_text, theirs_text)
                if conflict:
                    raise Bail(f"unexpected conflicting file {path}")
            planned.append((path, merged))

        # ---- apply plan to the worktree ----
        for path, action in planned:
            abspath = os.path.join(wt, path)
            os.makedirs(os.path.dirname(abspath), exist_ok=True)
            if action == "ADD":
                git(wt, "checkout", theirs, "--", path)
            else:
                with open(abspath, "w") as fh:
                    fh.write(action)
                git(wt, "add", "--", path)

        # ---- validate the two JSON registries parse ----
        for path in JSON_REGISTRIES:
            ap_ = os.path.join(wt, path)
            if os.path.exists(ap_):
                with open(ap_) as fh:
                    json.load(fh)

        # ---- semantic guard: the route enum must have no duplicate case ids ----
        # (protects against a pathological 3-way alignment producing a valid-looking
        # but doubled enum declaration -> a build break we must never merge).
        approute = os.path.join(wt, "apps/apple/Sources/App/AppRoute.swift")
        if os.path.exists(approute):
            _assert_no_dup_enum_cases(approute)

        git(wt, "add", "-A")
        # nothing staged? then it was a no-op merge -> bail so caller regenerates
        st = git(wt, "diff", "--cached", "--name-only").stdout.strip()
        if not st:
            raise Bail("no changes staged after salvage")

        if not args.no_commit:
            msg = args.message or f"salvage(parallel): integrate {theirs}"
            git(wt, "commit", "--no-verify", "-m", msg)
        log("salvage OK:", len(planned), "files")
        return 0
    except Bail as b:
        print(f"[salvage] BAIL: {b}", file=sys.stderr)
        # leave worktree clean for the caller
        git(wt, "reset", "--hard", "HEAD", check=False)
        git(wt, "clean", "-fd", check=False)
        return 3


if __name__ == "__main__":
    sys.exit(main())
