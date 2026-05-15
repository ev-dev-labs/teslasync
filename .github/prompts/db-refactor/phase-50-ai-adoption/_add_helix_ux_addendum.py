#!/usr/bin/env python3
"""Add inline Helix UX scaffold contract (HX) to Phase-50 slices 0046-0065.

Idempotent: each insertion is fenced by a marker comment so reruns are
safe. The HX block codifies the post-rebrand UX contract every new AI
slice MUST honour:

  1. Render via the shared `AIFeatureCard` scaffold (no bespoke
     GlassPanel + Button + AiOutputPanel composition).
  2. Universal "Ask Helix" CTA painted by the card; per-feature verb
     surfaces only in `aria-label` / tooltip via the card's
     `buttonLabel` prop.
  3. Tests locating the CTA must use UNANCHORED regexes because the
     accessible name is now "Ask Helix · <buttonLabel>".
  4. `HelixMark` from `@/components/branding/HelixMark` for any
     Helix/assistant identity glyph (avatars, panel headers,
     inline author marks). Not lucide `Bot` for THESE slots — `Bot`
     remains legitimate in non-AI surfaces (e.g. "Bot Token").
  5. `AIThinkingDots` from `@/components/ai/AIThinkingIndicator`
     for any "thinking" affordance OUTSIDE the card (the card
     already renders the dots inside its action button when
     `stream.state === 'streaming'`).
  6. User-visible i18n copy says "Helix" not "AI".

Anchor strategy:
  - For slices 0046-0064 the W1 wiring addendum has already been
    auto-inserted, so HX inserts immediately after
    `<!-- END: W1 INLINE WIRING ADDENDUM -->` and before
    `## Action Steps`.
  - For slice 0065 (W1 methodology) there is no W1 fenced block, so
    HX inserts directly before the first `## Action Steps` heading.

This is parallel to `_add_wiring_addendum.py` (which seeds the W1
SPA-wiring contract) but lives in a separate fenced block so the two
contracts can be edited independently.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

PROMPT_DIR = Path(__file__).resolve().parent

HX_BEGIN = "<!-- BEGIN: HX (Helix UX) ADDENDUM (auto-inserted) -->"
HX_END = "<!-- END: HX (Helix UX) ADDENDUM -->"
HX_TASK_BEGIN = "<!-- BEGIN: HX (Helix UX) TASK -->"
HX_TASK_END = "<!-- END: HX (Helix UX) TASK -->"
HX_GATE_BEGIN = "<!-- BEGIN: HX (Helix UX) GATE -->"
HX_GATE_END = "<!-- END: HX (Helix UX) GATE -->"

W1_END_MARKER = "<!-- END: W1 INLINE WIRING ADDENDUM -->"


def extract_feature_id(text: str) -> str | None:
    m = re.search(r"\*\*Feature ID:\*\*\s*`([a-z0-9-]+)`", text)
    return m.group(1) if m else None


def build_hx_section(feature_id: str) -> str:
    """Render the Helix UX scaffold contract for one slice."""
    return f"""
{HX_BEGIN}
## Helix UX scaffolding (Phase-50/HX — inline, MANDATORY)

This slice MUST render its primary AI surface through the shared
`AIFeatureCard` scaffold (`web/src/components/ai/AIFeatureCard.tsx`),
NOT a bespoke GlassPanel + Button + AiOutputPanel composition. The
scaffold was extracted from 38 pre-existing AI feature cards
(commit `7c125573f`) to guarantee visual, accessibility, and i18n
consistency across every Helix surface.

The wired component MUST:

1. **Scaffold:** import `AIFeatureCard` from
   `@/components/ai/AIFeatureCard` and render the entire feature
   surface through it. Do NOT roll a per-feature `<GlassPanel>` +
   `<Button>` + `<AiOutputPanel>` composition. The card owns the
   header, AI badge, description, optional empty-state hint, action
   button, streaming label, and AiOutputPanel placement. If a second
   surface (e.g. a typed-proposal preview, a domain-specific results
   list) is needed, render it via the card's `children` slot — never
   wrap a second `GlassPanel` around the card.

2. **Universal CTA — visible label is painted by the card.**
   `AIFeatureCard` paints the visible button text as
   "Ask Helix" (idle) / "Helix is thinking…" (streaming) with the
   `HelixMark` brand glyph and the cyan glass treatment. The
   per-feature action verb (e.g. "Suggest triage", "Summarize logs")
   is passed to the card via the **`buttonLabel`** prop and surfaces
   ONLY in the button's `aria-label` (read as
   `"${{askHelixLabel}} · ${{buttonLabel}}"`) and `title` (hover
   tooltip). Do NOT pass `"Ask Helix"` as `buttonLabel` — the
   accessible name would lose the per-feature context and existing
   role-name assertions would break. **Pass the per-feature verb.**

3. **Test regexes MUST be unanchored.** Because the accessible name
   reads `"Ask Helix · <buttonLabel>"`, anchored regexes
   (`/^Suggest$/i`) will not match. Locate the CTA via
   `getByRole('button', {{ name: /Suggest/i }})` (no `^`/`$`).
   The on-mode wiring test
   (`Test{"".join(part.capitalize() for part in feature_id.split('-'))}AIOnWiredCallsRoute`)
   added by the W1 addendum above MUST use this unanchored form.

4. **Brand glyph for assistant identity.** Use `HelixMark` from
   `@/components/branding/HelixMark` for ANY Helix/assistant identity
   slot this slice introduces (avatars, inline chat author marks,
   panel headers, status icons that represent "the AI talking").
   Do NOT use lucide `Bot`, generic sparkle icons, or feature-specific
   bespoke icons for these slots. Lucide `Bot` may still be used in
   non-AI contexts (e.g. "Bot Token" in notification provider
   settings); the rule is scoped to assistant-identity slots only.

5. **`AIThinkingDots` for streaming affordances OUTSIDE the card.**
   `AIFeatureCard` already renders `AIThinkingDots` inside its action
   button label while `stream.state === 'streaming'` (the dots are
   `aria-hidden`). If this slice surfaces a separate "thinking"
   indicator anywhere else (e.g. an inline chat row, a status pill),
   import `AIThinkingDots` from
   `@/components/ai/AIThinkingIndicator` rather than re-rolling the
   pulse animation.

6. **Helix-branded i18n copy.** Every USER-VISIBLE string this slice
   adds (empty/loading/error states, captions, hints, panel titles,
   menu labels) says "Helix" not "AI". Examples:
   `"helix.askHelix"` / `"helix.thinking"` / `"helix.usage.today"`.
   Registry `Name` / `Description` fields in
   `internal/ai/features/registry.go` are NOT user-facing in the
   same way — `CoverageOK()` only checks `Name != ""` and does not
   constrain the prose. Prefer Helix-branded copy when the registry
   entry surfaces in Settings → AI; technical / operator-only entries
   may keep accurate "AI ..." terminology.

### `AIFeatureCard` prop affordances (use them, don't sidestep them)

The scaffold supports the slice render contracts already in scope:

| Prop | When to use it |
|---|---|
| `inputSlot` | NL/prompt-input features (textarea, search box, NL-SQL editor). Pass the input via `inputSlot`; the card renders the action button beneath it (`buttonPlacement` is auto-set to `below`). |
| `children` | Typed-proposal previews, domain-specific result widgets, conflict lists — anything that renders between the action button and the AiOutputPanel. |
| `buttonPlacement='below'` | Header text too long to share a row, or feature renders extra context between header and button. |
| `emptyHint` | Per-feature "what's missing" text shown beneath the description when `canStart === false` (e.g. "Select a feedback row first."). |
| `onAction` | Override `stream.start` only when the slice needs to reset local state before firing (e.g. clear a captured conflicts list). The default is `stream.start`. |

### `canStart` MUST encode every busy/guard state

The card disables the action button when `!canStart || stream.state === 'streaming'`.
The slice's `canStart` expression MUST also be `false` while
`stream.state === 'paused-confirm'` (when the slice uses the F4
confirm-pause flow), and while any feature-specific guard is unmet
(`driveId === undefined`, no row selected, AI feature toggle off via
`useAiEnabled`). This preserves the W1 double-submit invariant ON
TOP of the scaffold — the card disables for streaming, the slice
disables for everything else.

{HX_END}
"""


def build_hx_task() -> str:
    return f"""{HX_TASK_BEGIN}
10. Helix UX scaffold: render the AI surface through `AIFeatureCard`. Pass the per-feature verb as `buttonLabel` (NOT "Ask Helix"). Use `HelixMark` for assistant-identity glyphs; use `AIThinkingDots` for any thinking affordance outside the card. User-visible i18n copy says "Helix" not "AI". Tests locating the CTA use unanchored regexes.
{HX_TASK_END}"""


def build_hx_gate() -> str:
    return f"""{HX_GATE_BEGIN}
8. The slice's SPA component imports `AIFeatureCard` from `@/components/ai/AIFeatureCard` and renders its primary AI surface through it; the per-feature verb is passed via `buttonLabel`; assistant-identity glyphs use `HelixMark` (not lucide `Bot`); on-mode wiring tests use unanchored role-name regexes; user-visible i18n copy added by this slice contains no `"AI "` prefix in a Helix-narrative position.
{HX_GATE_END}"""


def already_inserted(text: str) -> bool:
    return HX_BEGIN in text


def insert_hx_section(text: str, payload: str) -> str:
    """Insert HX section after W1 end-marker, or before first `## Action Steps`."""
    if W1_END_MARKER in text:
        return text.replace(
            W1_END_MARKER,
            W1_END_MARKER + "\n" + payload.strip() + "\n",
            1,
        )
    pat = re.compile(r"^## Action Steps\s*$", re.M)
    m = pat.search(text)
    if not m:
        raise RuntimeError("no W1 end-marker AND no `## Action Steps` heading found")
    return text[: m.start()] + payload.strip() + "\n\n" + text[m.start() :]


def insert_hx_task(text: str, payload: str) -> str:
    """Append HX task at end of `## Tasks` numbered list (after W1 task block when present)."""
    pat = re.compile(r"(^## Tasks\s*\n)(.*?)(?=^## )", re.S | re.M)
    m = pat.search(text)
    if not m:
        # 0065 might have a different shape — fall back to no-op if Tasks
        # section is missing. The HX section itself still seeds the contract.
        return text
    head = m.group(1)
    body = m.group(2).rstrip()
    new_body = body + "\n" + payload + "\n\n"
    return text.replace(m.group(0), head + new_body, 1)


def insert_hx_gate(text: str, payload: str) -> str:
    """Append HX gate criterion to the `## Gate` numbered list."""
    pat = re.compile(
        r"(^## Gate\s*\n.*?(?:The slice is DONE only if:|The prompt is DONE only if every required.*?\.)\s*\n)(.*?)(?=\n\nAny failure means|\n\nUse a conventional commit|\Z)",
        re.S | re.M,
    )
    m = pat.search(text)
    if not m:
        # Permissive fallback: just append before the next `##` heading
        # under `## Gate`. If neither anchor exists this is a no-op (the
        # HX section above still seeds the contract).
        pat2 = re.compile(r"(^## Gate\s*\n)(.*?)(?=^## )", re.S | re.M)
        m2 = pat2.search(text)
        if not m2:
            return text
        head = m2.group(1)
        body = m2.group(2).rstrip()
        new_body = body + "\n\n" + payload + "\n\n"
        return text.replace(m2.group(0), head + new_body, 1)
    head = m.group(1)
    body = m.group(2).rstrip()
    new_body = body + "\n" + payload + "\n"
    return text.replace(m.group(0), head + new_body, 1)


def process_one(path: Path) -> str:
    text = path.read_text(encoding="utf-8")

    if already_inserted(text):
        return "skip (already addended)"

    feature_id = extract_feature_id(text)
    if not feature_id:
        # 0065 is methodology-wide and may not declare a single Feature ID;
        # use the slice slug from the filename as a stand-in for the test
        # name interpolation.
        feature_id = path.stem.replace(".prompt", "")

    section = build_hx_section(feature_id)
    task = build_hx_task()
    gate = build_hx_gate()

    text = insert_hx_section(text, section)
    text = insert_hx_task(text, task)
    text = insert_hx_gate(text, gate)

    path.write_text(text, encoding="utf-8", newline="\n")
    return f"updated (feature={feature_id})"


def main() -> int:
    targets = sorted(PROMPT_DIR.glob("*.prompt.md"))
    # Slices 0046-0065 inclusive. The agent is starting from 0046 (47/67);
    # earlier slices already shipped with the legacy per-feature scaffold
    # and have been migrated in code via commit 7c125573f.
    targets = [p for p in targets if re.match(r"^00(4[6-9]|5\d|6[0-5])-", p.name)]
    if not targets:
        print("no targets found", file=sys.stderr)
        return 1

    print(f"processing {len(targets)} prompt files (0046-0065)\n")
    failures = 0
    for p in targets:
        try:
            result = process_one(p)
            print(f"  {p.name:65s} {result}")
        except Exception as e:  # pragma: no cover
            print(f"  {p.name:65s} ERROR: {e}")
            failures += 1
    print(f"\ndone. failures={failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
