// Pure, framework-free model + indicator taxonomy + projection for the Checkbox shared surface — the native
// analogue of every decision the web component makes (web/src/components/ui/Checkbox.tsx) before it paints its
// box. No Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces): an accessible
// checkbox primitive. A visually-hidden native `<input type="checkbox">` carries the keyboard / screen-reader /
// form semantics; a styled indicator follows the design tokens and shows one of three things:
//   • `indeterminate` true            → a Minus glyph in the accent-tinted box (web `peer-indeterminate`), the
//                                        "mixed" state a "select all" header uses regardless of `checked`;
//   • else `checked` true             → a Check glyph in the accent-tinted box (web `peer-checked`);
//   • else                            → an empty, neutral box (web base `text-transparent`).
// The box scales with the `size` prop (sm / md / lg), an optional `label` sits to its right, a `disabled` flag
// dims the whole control, and `onChange` reports the toggled boolean. There is also the React uncontrolled
// `defaultChecked` path (an input with no `checked` prop). Every one of those is reproduced by the composable
// in Checkbox.kt over this model.
//
// The web source has NO `useTranslation` and NO `t()` call — the `label` is a caller-supplied `ReactNode` and
// the accessible name comes from that label or a spread `aria-label`, never a literal owned by the component.
// So this surface adds NO i18n keys and NO English literal (honesty covenant: no silent drift); the
// checked / unchecked / mixed state announcement is supplied — already localized — by the platform's
// `Role.Checkbox` + `ToggleableState` semantics, not by a hand-rolled string. There is likewise NO data hook,
// NO fetch, and NO data port to bind (no P1/S8 Source/ViewModel): the web component fetches nothing, so
// modelling an async dependency would invent one the spec does not have. The presentational precedents are the
// sibling SectionErrorBoundary / VehicleMultiSelect-style surfaces (composable + model).
//
// Why the generic data-surface states (loading / empty / error / stale / offline) are intentionally absent:
// this surface fetches nothing — it renders one boolean tri-state control and only ever shows one of three
// boxes (empty / checked / mixed), optionally dimmed when disabled and optionally read-only when no change
// handler is supplied. There is no query to be loading, to be empty, to go stale, or to be offline, so
// inventing those states would be dishonest. The owning screen that DOES fetch renders its own data surface
// (with those states) and drops this checkbox into it. The surface's REAL, fully-reproduced states are
// therefore the three indicator branches below (× enabled/disabled × labelled/unlabelled × sm/md/lg), each
// reduced here in [indicatorFor] and asserted off-device, doubling as the per-state snapshot.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/Checkbox — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling SectionErrorBoundary / VehicleMultiSelect surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.checkbox

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no checked value and no
 * label — only this constant identifier — so a diagnostics line can never leak what the user is selecting.
 */
const val CHECKBOX_SLUG: String = "Checkbox"

/**
 * Canonical registry metadata for the Checkbox surface. The diagnostics [SLUG] is emitted with the one-shot
 * `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`Checkbox`).
 */
object CheckboxRegistration {
    /** Stable surface id (kebab-case), also the test tag the composable stamps on its row. */
    const val ID: String = "checkbox"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = CHECKBOX_SLUG
}

/**
 * Visual size of the box — the native mirror of the web `size` prop (`sm` / `md` / `lg`), which scales both the
 * box and its glyph. Defaults to [Md] in the composable, matching the web default. Pure (no Compose) so the
 * dp/icon mapping in Checkbox.kt stays a thin, testable lookup over these three cases.
 */
enum class CheckboxSize {
    Sm,
    Md,
    Lg,
}

/**
 * What the box paints — the native mirror of the web indicator's three visual outcomes. The web shows a Minus
 * when `indeterminate`, a Check when `checked`, and an empty (transparent-glyph) box otherwise; the accent
 * border/fill is applied by BOTH `peer-checked` and `peer-indeterminate`, i.e. whenever the box is [isActive].
 */
enum class CheckboxIndicator {
    /** Neither checked nor indeterminate — a neutral, empty box (web base `text-transparent`). */
    Empty,

    /** Checked and not indeterminate — the accent box with a Check glyph (web `peer-checked`). */
    Checked,

    /** Indeterminate (mixed) — the accent box with a Minus glyph (web `peer-indeterminate`). */
    Mixed,
}

/**
 * Whether the box wears the accent border + fill (web `peer-checked` / `peer-indeterminate`). Only the empty
 * box stays neutral; both the checked and the mixed box are active, mirroring the two web peer variants that
 * share the same accent treatment.
 */
val CheckboxIndicator.isActive: Boolean
    get() = this != CheckboxIndicator.Empty

/**
 * Reduce the two web inputs (`checked`, `indeterminate`) into the single box the indicator paints — pure (no
 * Compose), so every branch is exhaustively covered and unit-tested off-device, doubling as the per-state
 * snapshot. Precedence matches the web component exactly: `indeterminate` wins (the box shows Minus even when
 * also `checked`, mirroring `indeterminate ? <Minus/> : <Check/>`); otherwise `checked` shows the Check;
 * otherwise the empty box.
 */
fun indicatorFor(
    checked: Boolean,
    indeterminate: Boolean,
): CheckboxIndicator =
    when {
        indeterminate -> CheckboxIndicator.Mixed
        checked -> CheckboxIndicator.Checked
        else -> CheckboxIndicator.Empty
    }

/**
 * The PII-safe diagnostics this surface emits (P1/S11). The one `view.opened` event carries only the constant
 * surface [SLUG] — never the checked value, the label, or any user data — so a diagnostics line can never leak
 * what is being selected. Kept free of Compose so it is unit-tested with a recording [Logger].
 */
object CheckboxDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = CHECKBOX_SLUG

    /** The one-shot event emitted once when the surface opens. */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** The structured-field key carrying the surface slug on every diagnostic. */
    const val FIELD_SURFACE: String = "surface"

    /**
     * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [SLUG]. Call from the
     * composable's first-composition effect.
     */
    fun recordViewOpened(logger: Logger) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SLUG))
    }
}
