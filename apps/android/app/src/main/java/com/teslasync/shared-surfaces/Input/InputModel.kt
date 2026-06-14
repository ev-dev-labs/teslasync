// Pure, framework-free model + projection + diagnostics for the Input shared surface — the native analogue of
// every decision the web component makes (web/src/components/ui/Input.tsx) before it paints its field. No
// Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable in Input.kt a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces): a labelled
// single-line text field. Above the box it draws an optional `<Label>` (with a tinted required `*` and a
// screen-reader-only "required" word folded into the control's accessible name) followed by an optional
// field-level `<HelpIcon>`. The box itself wears an optional leading icon, an optional trailing suffix, a
// ghost prompt when empty, four sizes (sm / md / lg / auto), and a disabled dim. Below the box it shows, in
// strict precedence, either a red validation message (the `error` prop) OR a muted helper line (the `hint`
// prop) — never both, mirroring `{error && …}{hint && !error && …}`. The control derives its DOM id the same
// way the web does (`id || label.toLowerCase().replace(/\s+/g,'-')`) so the help affordance and the message
// can be wired to it. Every one of those branches is reproduced by the composable over this model.
//
// The web source itself has NO `useTranslation` and NO `t()` call — `label`, `error`, `hint`, and the ghost
// prompt are all caller-supplied, never literals the component owns. The only localized strings it pulls in
// are the ones its composed `<Label>` and `<HelpIcon>` resolve: `form.required` (the a11y required word),
// `a11y.helpFor` (the help trigger's "Help for {field}" name) and its `help.tooltip.iconLabel` fallback. So
// this surface adds NO new i18n key and NO English literal (honesty covenant: no silent drift) — it reuses
// exactly those three existing P1/S10 catalog keys at the render boundary in Input.kt.
//
// Why the generic data-surface states (loading / empty / error / stale / offline) are intentionally absent:
// this surface fetches nothing — it binds NO data hook and performs NO HTTP (the web component has no hook
// at all). There is no query to be loading, to go stale, or to be offline, so inventing those states would
// be dishonest. The surface's REAL, fully-reproduced states are the presentational branches the web source
// draws: labelled / unlabelled, required / optional, with / without the help affordance, with / without the
// leading icon and trailing suffix, the ghost-prompt empty box, the disabled dim, and the three-way message
// slot below the field (error / hint / none) reduced here in [resolveSupporting]. The `error` prop is the
// field's own validation message, NOT a fetch failure — it is reproduced verbatim, not mapped to a retry
// surface. The owning screen that DOES fetch renders its own data surface and drops this field into it.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/Input — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling UnitInput / TagInput surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.input

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no typed value and no
 * label — only this constant identifier — so a diagnostics line can never leak what the user is entering.
 */
const val INPUT_SLUG: String = "Input"

/**
 * Canonical registry metadata for the Input surface. The diagnostics [SLUG] is emitted with the one-shot
 * `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`Input`); [ID] is the kebab-case
 * id the composable stamps on its field as a test tag.
 */
object InputRegistration {
    /** Stable surface id (kebab-case), also the test tag the composable stamps on its field. */
    const val ID: String = "input"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = INPUT_SLUG
}

/**
 * Visual size of the field — the native mirror of the web `size` prop (`sm` / `md` / `lg` / `auto`), which
 * scales the text inside the box. Defaults to [Md] in the composable, matching the web default. [Auto] is the
 * web density-aware scale (`ui_density`); with no density binding on this presentational surface it follows
 * the medium baseline, documented at its use site. Pure (no Compose) so the text-style mapping in Input.kt
 * stays a thin, testable lookup over these four cases.
 */
enum class InputSize {
    Sm,
    Md,
    Lg,
    Auto,
}

/**
 * Which message the slot below the field paints — the native mirror of the web source's two mutually
 * exclusive lines: a red validation [Error] (web `{error && …}`) or a muted [Hint] (web `{hint && !error && …}`),
 * or [None] when neither applies.
 */
enum class InputSupportingKind {
    /** No message below the field. */
    None,

    /** The muted helper line (web `hint`), shown only when there is no error. */
    Hint,

    /** The red validation message (web `error`), which takes precedence over any hint. */
    Error,
}

/**
 * The reduced message-slot decision: the [text] to show below the field (or null for [InputSupportingKind.None])
 * and its [kind]. [isError] drives both the field's invalid styling (web red border) and the red message tint.
 */
data class InputSupporting(
    val text: String?,
    val kind: InputSupportingKind,
) {
    /** Whether the field is in its invalid state (web `aria-invalid` / red border). */
    val isError: Boolean
        get() = kind == InputSupportingKind.Error
}

private val WHITESPACE_RUN = Regex("\\s+")

/**
 * Reduce the two web message props (`error`, `hint`) into the single line the slot paints — pure (no Compose),
 * so every branch is exhaustively unit-tested off-device, doubling as the per-state snapshot. Precedence
 * matches the web source exactly: a non-blank `error` wins and renders red (`{error && …}`); otherwise a
 * non-blank `hint` renders muted (`{hint && !error && …}`); otherwise nothing. A blank string is treated as
 * absent, mirroring JavaScript truthiness (`"" && …` is falsy), so an empty `error` lets the `hint` show.
 */
fun resolveSupporting(
    error: String?,
    hint: String?,
): InputSupporting =
    when {
        !error.isNullOrBlank() -> InputSupporting(error, InputSupportingKind.Error)
        !hint.isNullOrBlank() -> InputSupporting(hint, InputSupportingKind.Hint)
        else -> InputSupporting(null, InputSupportingKind.None)
    }

/**
 * Whether the field is invalid — the native mirror of the web `aria-invalid={error ? 'true' : undefined}` and
 * the red border. A blank error string is treated as absent (JavaScript truthiness), so it does NOT mark the
 * field invalid.
 */
fun isInvalid(error: String?): Boolean = !error.isNullOrBlank()

/**
 * Derive the control's id exactly as the web does: `id || label?.toLowerCase().replace(/\s+/g, '-')`. A
 * non-blank explicit [id] wins; otherwise the [label] is lower-cased with whitespace runs collapsed to single
 * hyphens; otherwise null. Used to name the help affordance ("Help for {id}") so the native and web a11y
 * wiring stay in lockstep.
 */
fun resolveInputId(
    id: String?,
    label: String?,
): String? =
    when {
        !id.isNullOrBlank() -> id
        label != null -> label.lowercase().replace(WHITESPACE_RUN, "-")
        else -> null
    }

/**
 * The field-name the help trigger announces ("Help for {field}"), or null when there is none (the web
 * `HelpIcon` then falls back to its generic `help.tooltip.iconLabel`). Mirrors the web default of
 * `help.for ?? inputId`: a blank derived id yields null so the generic label is used.
 */
fun helpFieldName(
    id: String?,
    label: String?,
): String? = resolveInputId(id, label)?.takeIf(String::isNotBlank)

/**
 * Build the field's accessible name from its visible [label] and [required] flag — the native mirror of how
 * the web `<label for>` association names the input, with the visually-hidden [requiredWord] (`form.required`)
 * appended when required so a screen reader announces e.g. "Email, required" (WCAG 3.3.2). Returns null when
 * there is no [label] (the field then relies on its ghost prompt for context, as the web unlabelled input does).
 */
fun fieldAccessibleName(
    label: String?,
    required: Boolean,
    requiredWord: String,
): String? =
    when {
        label == null -> null
        required -> "$label, $requiredWord"
        else -> label
    }

/**
 * The PII-safe diagnostics this surface emits (P1/S11). The one `view.opened` event carries only the constant
 * surface [SLUG] — never the typed value, the label, the error, or any user data — so a diagnostics line can
 * never leak what is being entered. Kept free of Compose so it is unit-tested with a recording [Logger].
 */
object InputDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = INPUT_SLUG

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
