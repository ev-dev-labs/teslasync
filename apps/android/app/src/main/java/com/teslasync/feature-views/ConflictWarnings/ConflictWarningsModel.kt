// Pure, framework-free model + projection for the ConflictWarnings feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/automations/pages/ConflictWarnings.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// ConflictWarnings is a purely presentational surface — the web component takes its `conflicts` array as a
// prop from the automation builder that owns the TanStack query, so this surface binds NO data hook of its
// own (its only `t()` call is the "Potential Conflict" banner title). As in the sibling AchievementBadge /
// StatusHeader / HighlightCard ports, the cache-then-network lifecycle (loading / error / stale / offline)
// lives on the owning builder page, not here; modelling those states would invent behaviour the spec does
// not have (drift). The branches the web source actually defines — the empty guard
// (`conflicts.length === 0` -> render nothing) and, per row, the warning-vs-info severity that selects the
// banner tone + leading glyph — are the complete state set this surface renders, and each is projected here.
//
// [AutomationConflict] mirrors the web `AutomationConflict` interface 1:1 (snake_case `automation_id` /
// `automation_name` via @SerialName, every field defaulted) so the projection runs straight off the cached
// API JSON, ignoring unknown columns.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ConflictWarnings — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling AchievementBadge / StatusHeader surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.conflictwarnings

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * One automation conflict — the native mirror of the web `AutomationConflict` interface
 * (web/src/api/types.ts). `automation_id` / `automation_name` keep their snake_case wire names via
 * @SerialName and every field defaults so a partial or still-loading payload decodes without error (the
 * conflicts array may carry extra columns; a decoder must ignore unknown keys).
 *
 * @property automationId the conflicting automation's id (web `automation_id`); used only to build the
 *   stable per-row key, never displayed.
 * @property automationName the conflicting automation's display name (web `automation_name`), already
 *   localized/data-sourced; rendered inside the banner body.
 * @property reason the human-readable conflict explanation (web `reason`); rendered after the name.
 * @property severity the raw severity key (web `severity`, `'warning' | 'info'`); classified by
 *   [ConflictSeverity.from] into the banner tone.
 */
@Serializable
data class AutomationConflict(
    @SerialName("automation_id") val automationId: Long = 0,
    @SerialName("automation_name") val automationName: String = "",
    val reason: String = "",
    val severity: String = "",
)

/**
 * The semantic severity of a conflict — the vendor-neutral classification of the raw web severity key. The
 * render layer maps this to a feedback `Tone` (and thence a status token + leading glyph) so the model stays
 * free of Compose/Android types. Mirrors the web `c.severity === 'warning' ? 'warning' : 'info'` branch.
 */
enum class ConflictSeverity {
    Warning,
    Info,
    ;

    companion object {
        private const val WARNING_KEY = "warning"

        /**
         * Classifies a raw severity key exactly like the web strict-equality check
         * (`c.severity === 'warning' ? 'warning' : 'info'`): only the exact lowercase `"warning"` is a
         * [Warning]; everything else — `"info"` and any unexpected value — folds to [Info].
         */
        fun from(raw: String): ConflictSeverity = if (raw == WARNING_KEY) Warning else Info
    }
}

/**
 * A fully projected, render-ready conflict row — the native analogue of the inputs the web component feeds
 * one `<AlertBanner>`. Pure data (no Compose types): the composable resolves [severity] to a `Tone` + glyph
 * and renders [message] under the shared (localized) banner title.
 *
 * @property key the stable per-row identity (web `key={`${automation_id}-${i}`}`); used for Compose list
 *   identity, never displayed.
 * @property message the banner body, web template literal `"${automation_name}": ${reason}` — literal
 *   double-quotes around the name, a colon, a space, then the reason.
 * @property severity the classified severity driving the banner tone + leading glyph.
 */
data class ConflictWarningRow(
    val key: String,
    val message: String,
    val severity: ConflictSeverity,
)

/**
 * The fully projected inputs the composable renders — the native analogue of what the web component derives
 * from its `conflicts` prop. [rows] preserves the received order (the web `.map` order), and [isHidden]
 * drives the empty branch: when `true` the surface renders nothing, exactly as the web
 * `if (conflicts.length === 0) return null`.
 */
data class ConflictWarningsDisplay(
    val rows: List<ConflictWarningRow>,
    val isHidden: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's per-row derivations
 * (the `key`, the `"${name}": ${reason}` body, and the severity -> variant branch) plus the empty guard.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object ConflictWarningsProjection {
    /**
     * Projects [conflicts] into render-ready [ConflictWarningRow]s, preserving the received order. Each row
     * carries its stable key (web `${automation_id}-${index}`), its banner body, and its [ConflictSeverity];
     * [ConflictWarningsDisplay.isHidden] is `true` when the list is empty (web `conflicts.length === 0`).
     */
    fun project(conflicts: List<AutomationConflict>): ConflictWarningsDisplay {
        val rows =
            conflicts.mapIndexed { index, conflict ->
                ConflictWarningRow(
                    key = "${conflict.automationId}-$index",
                    message = formatMessage(conflict.automationName, conflict.reason),
                    severity = ConflictSeverity.from(conflict.severity),
                )
            }
        return ConflictWarningsDisplay(rows = rows, isHidden = conflicts.isEmpty())
    }

    /**
     * Builds the banner body exactly as the web template literal `"${c.automation_name}": ${c.reason}`:
     * literal double-quotes around the [automationName], a colon, a single space, then the [reason]. The
     * frame is punctuation only (the name + reason are data-sourced values), so no catalog key is involved —
     * matching the web source, which interpolates the two values into the same fixed punctuation frame.
     */
    fun formatMessage(
        automationName: String,
        reason: String,
    ): String = "\"$automationName\": $reason"
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never an
 * automation name or conflict reason — so a diagnostics line can never leak which automations a user has
 * configured.
 */
object ConflictWarningsDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "ConflictWarnings"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
