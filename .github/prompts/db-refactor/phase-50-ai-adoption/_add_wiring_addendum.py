#!/usr/bin/env python3
"""Add inline SPA-wiring contract to Phase-50 slices 0027-0064.

Idempotent: each insertion is fenced by a marker comment so reruns are
safe. Reads each prompt's feature ID and backend route from the existing
frontmatter table, then injects:

  1. A new "## SPA wiring (P11/P12 ΓÇö inline)" section after the existing
     "## Registry metadata contribution" section.
  2. A new "9. SPA wiring" task in the "## Tasks" numbered list.
  3. A new "## Verification" command bullet that greps for placeholder
     strings in the shipped component.
  4. A new "## Gate" criterion (item 7).

The agent running each slice ships the component wired from the start.
Slice 0065 (W1) still owns the methodology principle additions and the
aivet rule that backstops drift; it becomes a methodology-only slice.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

PROMPT_DIR = Path(__file__).resolve().parent

# Fence markers so reruns can detect prior insertions.
WIRING_BEGIN = "<!-- BEGIN: W1 INLINE WIRING ADDENDUM (auto-inserted) -->"
WIRING_END = "<!-- END: W1 INLINE WIRING ADDENDUM -->"
TASK_BEGIN = "<!-- BEGIN: W1 INLINE TASK -->"
TASK_END = "<!-- END: W1 INLINE TASK -->"
VERIFY_BEGIN = "<!-- BEGIN: W1 INLINE VERIFICATION -->"
VERIFY_END = "<!-- END: W1 INLINE VERIFICATION -->"
GATE_BEGIN = "<!-- BEGIN: W1 INLINE GATE -->"
GATE_END = "<!-- END: W1 INLINE GATE -->"


def extract_field(text: str, header: str) -> str | None:
    """Pull the value out of a single-row markdown table cell.

    Looks for a row of the form:  | <header> | <value> |
    Returns <value> stripped or None when not found.
    """
    pat = re.compile(rf"^\|\s*{re.escape(header)}\s*\|\s*([^\|]+?)\s*\|\s*$", re.M)
    m = pat.search(text)
    return m.group(1).strip() if m else None


def extract_feature_id(text: str) -> str | None:
    m = re.search(r"\*\*Feature ID:\*\*\s*`([a-z0-9-]+)`", text)
    return m.group(1) if m else None


def extract_offmode_test_name(text: str) -> str | None:
    """Pull the Off-mode test name from the baseline coexistence block."""
    m = re.search(r"Off-mode test:\s*([A-Za-z0-9_]+)", text)
    return m.group(1) if m else None


def build_wiring_section(feature_id: str, backend_route: str, frontend_route: str, offmode_test: str) -> str:
    """Render the SPA wiring contract section for one slice."""
    # SPA url = backend route after /api/v1
    spa_url = "/ai/..."
    m = re.search(r"POST\s+/api/v1(/ai/[^\s,]+)", backend_route)
    if m:
        spa_url = m.group(1)

    onmode_test = "Test" + "".join(
        part.capitalize() for part in feature_id.split("-")
    ) + "AIOnWiredCallsRoute"

    return f"""
{WIRING_BEGIN}
## SPA wiring (P11/P12 ΓÇö inline, do NOT defer to W1)

This slice MUST ship the SPA component **wired end-to-end** to the
backend route. The "render disabled placeholder, defer wiring to W1"
pattern is forbidden by methodology principles **P11 (Wired-or-absent)**
and **P12 (No placeholder buttons)**. Slice 0065 (W1) installs those
principles + the `aivet` enforcement rule; the **wiring itself lands
here**, in this slice's commit.

The wired component MUST:

1. Import `useAiStream` from `@/hooks/useAiStream` (already shipped).
2. Render through `AiOutputPanel` from `@/components/ai/AiOutputPanel`
   (already shipped) for **narrative** render contracts. For
   **proposal** or **suggestion** render contracts, render the typed
   draft inside the AI panel with an "Apply to form" / "Use this
   draft" action that copies the draft into the baseline form's
   state. The AI panel NEVER persists state directly; the baseline
   form's existing Save button remains the sole write path
   (ADR-015 ┬ºI3 + ┬ºI8 propose-only contract).
3. Have a primary action button whose `disabled` prop is a **computed**
   expression, e.g.
   `aiStream.state === 'streaming' || aiStream.state === 'paused-confirm' || <feature-guard>`.
   Literal `disabled` or `disabled={{true}}` is forbidden (Rule W1-A).
4. Call `useAiStream({{ url, body, onEvent }})` unconditionally at the
   top of the component (Hooks rules ΓÇö no early returns above the hook
   call). For this slice the registered backend endpoint is
   **`{backend_route}`**, so the SPA `url` is **`{spa_url}`**
   (the backend path after stripping the `/api/v1` prefix).
5. Handle each `AiStreamEvent` variant per render contract:
   - `delta` ΓåÆ append `ev.text` to the displayed output (narrative)
     or accumulate (proposal/suggestion).
   - `tool_call` ΓåÆ surface the F4 `<ConfirmDialog>` when applicable.
   - `tool_result` ΓåÆ parse the typed payload, render inside the AI
     panel (proposal/suggestion only).
   - `confirm_request` ΓåÆ open the confirm dialog and POST
     `/api/v1/ai/_internal/continue` with `{{continuation_id}}` on
     confirm.
   - `done` ΓåÆ mark stream complete; refetch list queries if needed.
   - `error` ΓåÆ surface `ev.message`, `ev.banner_level`,
     `ev.retry_after_s` via the existing `ai.errors.<bannerLevel>`
     i18n key. On `banner_level === 'baseline'`, fall back to the
     baseline rendering at the same surface and tag the output as
     baseline-sourced.
6. On unmount, on `useAiEnabled('{feature_id}')` flip to `false`, on
   route/session change, AND on user-initiated cancel: call
   `aiStream.cancel()` and reset all local stream state in a
   dedicated `useEffect` with explicit deps. Do not coalesce these
   effects.
7. Double-submit guard: while `aiStream.state` is `streaming` or
   `paused-confirm`, the primary action handler is a no-op.
8. **No** "future slice", "coming soon", "wiring lands", or "would
   call POST" comments or placeholder strings in the shipped file.
   `aivet` Rule W1-A (added by slice 0065) backstops this; the
   final gate fails if any are present.

### User-prefs / units (cross-cutting, no per-slice work required)

User display preferences (Miles/Fahrenheit/PSI/Rated/decimal precision/
locale/currency) flow into every `/api/v1/ai/*` request automatically:

- `userPrefsMiddleware` (in `internal/api/ai_routes.go`) reads the
  user's Application settings once per request and seeds a
  `dispatch.UserPrefs` value into the request context.
- The dispatcher appends a second system message instructing the
  model to narrate in the user's display units, with explicit
  SI ΓåÆ display conversion formulas.

This slice MUST NOT duplicate that plumbing in its strategy or
handler. If this slice adds a new tool that surfaces a Celsius
value (or any other SI-canonical value where a display-unit
conversion is non-trivial), it MUST also emit the pre-computed
display-unit field alongside ΓÇö see `cToFPtr` in
`internal/ai/tools/drive_coaching.go` for the temperature
precedent (`outside_temp_avg_c` + `outside_temp_avg_f` emitted
together). Tools must NOT rely on the LLM to do arithmetic on
negative or fractional values.

### New on-mode wiring test (required)

Add `{onmode_test}` (or the feature-specific variant implied by this
slice's existing test naming) proving:

- With `ai_mode='local'` and the `{feature_id}` toggle on, invoking
  the primary action enqueues **exactly one** POST against the
  registered backend route `{backend_route}` and consumes the SSE
  stream (use the existing mock-provider harness from F6).
- The first `delta` event's text is rendered inside the AI panel
  via the `data-testid="ai-feature-{feature_id}-root"` marker.
- A second click while `aiStream.state === 'streaming'` is a no-op
  (double-submit guard).
- For proposal / suggestion render contracts: clicking "Apply to
  form" copies the typed draft into the baseline form's state, AND
  clicking the baseline Save button is what triggers the typed
  write handler (spy on the baseline mutation hook, not the AI
  stream).
- The existing off-mode test `{offmode_test}` continues to pass
  unchanged ΓÇö wiring MUST NOT regress the off-mode absence
  invariant.

{WIRING_END}
"""


def build_task_addendum() -> str:
    return f"""{TASK_BEGIN}
9. SPA wiring: ship the AI component wired end-to-end to the backend route via `useAiStream`. No placeholder strings, no literal-disabled buttons. Add the on-mode wiring test alongside the existing off-mode test.
{TASK_END}"""


def build_verify_addendum() -> str:
    return f"""
{VERIFY_BEGIN}
~~~powershell
# W1 inline self-check: this slice's shipped AI component MUST NOT
# carry any placeholder/deferral strings. Pre-W1 components may still
# show non-zero counts, but this slice's component MUST be 0.
Select-String -Path 'web/src/components/ai/AI*.tsx' -Pattern 'future slice|coming soon|wiring lands|would call POST' | Measure-Object | Select-Object -ExpandProperty Count
# Expected: 0 across this slice's allowed files. After slice 0065 lands, the project-wide count MUST stay at 0 forever.
~~~
{VERIFY_END}
"""


def build_gate_addendum() -> str:
    return f"""{GATE_BEGIN}
7. The slice's SPA component imports `useAiStream`, references the registered backend endpoint, has zero placeholder strings, and the on-mode wiring test passes.
{GATE_END}"""


def insert_after(text: str, anchor_pat: str, payload: str) -> str:
    """Insert `payload` right after the line matching `anchor_pat`.

    `anchor_pat` is the start-of-line literal heading (e.g.
    "## Registry metadata contribution"). The payload is inserted with a
    blank line separator on each side so the surrounding markdown
    formatting stays intact.
    """
    pat = re.compile(rf"(^{re.escape(anchor_pat)}.*?$)(.*?)(?=^## )", re.S | re.M)
    m = pat.search(text)
    if not m:
        raise RuntimeError(f"anchor not found: {anchor_pat!r}")
    head_block = m.group(1) + m.group(2)
    # Append payload at end of that section, just before next ## heading.
    return text.replace(head_block, head_block.rstrip() + "\n\n" + payload.strip() + "\n\n", 1)


def insert_task(text: str, payload: str) -> str:
    """Insert task addendum at end of the '## Tasks' numbered list."""
    pat = re.compile(r"(^## Tasks\s*\n)(.*?)(?=^## )", re.S | re.M)
    m = pat.search(text)
    if not m:
        raise RuntimeError("Tasks section not found")
    head = m.group(1)
    body = m.group(2).rstrip()
    new_body = body + "\n" + payload + "\n\n"
    return text.replace(m.group(0), head + new_body, 1)


def insert_verify(text: str, payload: str) -> str:
    """Insert verify addendum at end of the '## Verification' section."""
    pat = re.compile(r"(^## Verification\s*\n)(.*?)(?=^## )", re.S | re.M)
    m = pat.search(text)
    if not m:
        raise RuntimeError("Verification section not found")
    head = m.group(1)
    body = m.group(2).rstrip()
    new_body = body + "\n\n" + payload.strip() + "\n\n"
    return text.replace(m.group(0), head + new_body, 1)


def insert_gate(text: str, payload: str) -> str:
    """Insert gate criterion at end of the numbered list under '## Gate'."""
    pat = re.compile(
        r"(^## Gate\s*\n.*?The slice is DONE only if:\s*\n)(.*?)(?=\n\nAny failure means)",
        re.S | re.M,
    )
    m = pat.search(text)
    if not m:
        raise RuntimeError("Gate criteria block not found")
    head = m.group(1)
    body = m.group(2).rstrip()
    new_body = body + "\n" + payload + "\n"
    return text.replace(m.group(0), head + new_body, 1)


def already_inserted(text: str) -> bool:
    return WIRING_BEGIN in text


def process_one(path: Path) -> str:
    text = path.read_text(encoding="utf-8")

    if already_inserted(text):
        return "skip (already addended)"

    feature_id = extract_feature_id(text)
    if not feature_id:
        return "ERROR: no feature ID"

    backend_route = extract_field(text, "Backend routes")
    if not backend_route:
        return "ERROR: no backend route"

    frontend_route = extract_field(text, "Frontend routes") or "(none)"
    offmode_test = extract_offmode_test_name(text) or f"Test{feature_id.title().replace('-', '')}AIOffBaseline"

    section = build_wiring_section(feature_id, backend_route, frontend_route, offmode_test)
    task = build_task_addendum()
    verify = build_verify_addendum()
    gate = build_gate_addendum()

    text = insert_after(text, "## Registry metadata contribution", section)
    text = insert_task(text, task)
    text = insert_verify(text, verify)
    text = insert_gate(text, gate)

    path.write_text(text, encoding="utf-8", newline="\n")
    return f"updated (feature={feature_id}, route={backend_route})"


def main() -> int:
    targets = sorted(PROMPT_DIR.glob("*.prompt.md"))
    # Slices 0027-0064 inclusive.
    targets = [p for p in targets if re.match(r"^00(2[7-9]|[3-5]\d|6[0-4])-", p.name)]
    if not targets:
        print("no targets found", file=sys.stderr)
        return 1

    print(f"processing {len(targets)} prompt files (0027-0064)\n")
    failures = 0
    for p in targets:
        try:
            result = process_one(p)
            print(f"  {p.name:60s} {result}")
        except Exception as e:  # pragma: no cover
            print(f"  {p.name:60s} ERROR: {e}")
            failures += 1
    print(f"\ndone. failures={failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
