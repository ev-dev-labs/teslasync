// Pure, framework-free model + projection + diagnostics for the WidgetBigNumber widget primitive — the native
// analogue of every decision the web source makes (web/src/features/dashboard/widgets/shared/WidgetBigNumber.tsx)
// before Compose paints anything. No Compose, no Android framework, no HTTP: every declaration here is exercised
// off-device in the :android:testReleaseUnitTest gate, so the composable stays a thin render layer over these
// pure functions (the accepted sibling-surface contract — AnimatedNumber / StaggerContainer models).
//
// What the web source IS (and therefore the complete behaviour this primitive reproduces): a purely presentational
// "big number" building block shared by many dashboard widgets. It takes a nullable numeric `value` plus optional
// `unit`, `label`, `subtitle`, a `{ text, variant }` `badge`, a caller `valueColor`, a `nullDisplay` fallback, and
// an `animated` flag. It renders, centered: the value (count-up `AnimatedNumber` when `animated`, otherwise a
// static `tabular-nums` span, otherwise the muted `nullDisplay` when `value === null`) beside the optional unit;
// then the optional uppercase label, the optional subtitle, and the optional `Badge`. It fetches nothing and has
// no text of its own — every visible string is handed in by the caller — so it is anonymous and carries NO i18n
// keys (none is extracted, none is invented; honesty covenant: no silent drift).
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this primitive
// performs no query and owns no async cache-then-network feed — it is handed a finished, nullable number. Modelling
// those states would fabricate an async dependency the web spec does not have (honesty covenant: no scope
// narrowing, no skip-and-assume). The primitive's REAL, fully-reproduced states are the value branches the web
// source plays and which [WidgetBigNumberModel.project] reduces here: a present value (formatted, animated or
// static) with any combination of unit / label / subtitle / badge, and the absent value (the web `value === null`
// branch) rendered as the muted `nullDisplay`. Each branch is asserted off-device, doubling as the per-state
// snapshot; the owning widget that DOES fetch wraps this primitive inside its own loading / error / stale / offline
// shell (e.g. the RangeBarWidget `WidgetShell`).
//
// Number formatting is composed from the shared [ChartFormat] (the same locale-grouping formatter the
// data-display `AnimatedNumber` atom uses) so the primitive, the charts, and the tables can never drift on how a
// number reads. A null or non-finite value resolves to the caller `nullDisplay`, giving the primitive a robust
// null-safety story end to end.
//
// `InvalidPackageDeclaration` is suppressed because this primitive's mandated directory
// (com/teslasync/widget-primitives/WidgetBigNumber — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling widget / shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgetbignumber

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/**
 * Canonical registry metadata for the WidgetBigNumber primitive. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`WidgetBigNumber`).
 */
object WidgetBigNumberRegistration {
    /** Stable primitive id (also the key a host would bind the primitive with). */
    const val ID: String = "widget-big-number"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11, prompt-mandated). */
    const val SLUG: String = "WidgetBigNumber"
}

/**
 * The web-default knobs, kept as named constants so the composable and the unit gate agree on one source of
 * truth — no loose numerals drift between the render layer and its tests.
 */
object WidgetBigNumberDefaults {
    /** The fallback shown when there is no value — web `nullDisplay = '—'` (U+2014 em dash). */
    const val NULL_DISPLAY: String = "\u2014"

    /** Fraction digits used when formatting the value — web `AnimatedNumber` default `decimals = 0`. */
    const val DECIMALS: Int = 0

    /**
     * Count-up length in milliseconds for the animated value. Intentionally the web `AnimatedNumber` default
     * `duration = 1` second (not the 400 ms `MotionDurations.slow` token), so the count-up cadence matches the
     * web building block this primitive composes (parity).
     */
    const val ANIMATION_MS: Int = 1_000
}

/**
 * Semantic badge intent — the native mirror of the web `badge.variant` union
 * (`'success' | 'warning' | 'error' | 'neutral'`). Kept framework-free so the value branches are unit-tested
 * off-device; the composable maps each case onto the shared `Badge` atom's `BadgeVariant` (the web
 * `badgeVariantMap`, where `error → danger`).
 */
enum class WidgetBigNumberBadgeVariant { Success, Warning, Error, Neutral }

/**
 * The optional status chip the web renders below the value — the native analogue of the web
 * `badge?: { text; variant }` prop. [text] is the caller's chip copy (carried verbatim, never invented here);
 * [variant] selects the semantic color.
 */
data class WidgetBigNumberBadge(
    val text: String,
    val variant: WidgetBigNumberBadgeVariant = WidgetBigNumberBadgeVariant.Neutral,
)

/**
 * The presentational inputs — the native analogue of the web `WidgetBigNumber` content props. Grouped into one
 * spec so the pure [WidgetBigNumberModel.project] stays under the parameter budget and the composable has a
 * single value to remember. `valueColor` and `animated` are render-layer concerns (color + animation cadence),
 * so they live on the composable, not in this pure projection.
 *
 * @param value the number to display, or `null` for the empty branch (web `value: number | null`).
 * @param unit the optional unit rendered beside the value (web `unit`).
 * @param label the optional uppercase caption rendered below the value (web `label`).
 * @param subtitle the optional secondary line below the label (web `subtitle`).
 * @param badge the optional status chip below everything (web `badge`).
 */
data class WidgetBigNumberSpec(
    val value: Double?,
    val unit: String? = null,
    val label: String? = null,
    val subtitle: String? = null,
    val badge: WidgetBigNumberBadge? = null,
)

/**
 * The render-ready projection of a [WidgetBigNumberSpec] — the pure data the composable paints. Every optional
 * field is normalized (blank strings collapse to `null` so a stray empty prop never reserves layout), the value
 * is pre-formatted, the label is pre-uppercased for display, and a single coherent [accessibilityLabel] is
 * composed so the primitive reads as one unit to TalkBack instead of four disconnected fragments.
 */
data class WidgetBigNumberContent(
    /** The value formatted with locale grouping, or the `nullDisplay` fallback when [isNullValue]. */
    val displayText: String,
    /** True when there is no finite value to show — the web `value === null` (muted `nullDisplay`) branch. */
    val isNullValue: Boolean,
    /** The unit beside the value, or `null` when the caller passed none / blank (web `unit && …`). */
    val unit: String?,
    /** The label uppercased for display (web `uppercase` class), or `null` when none / blank. */
    val labelDisplay: String?,
    /** The secondary line, or `null` when none / blank (web `subtitle && …`). */
    val subtitle: String?,
    /** The status chip, or `null` when none (web `badge && …`). */
    val badge: WidgetBigNumberBadge?,
    /** One coherent content description for the whole primitive, read once by TalkBack. */
    val accessibilityLabel: String,
)

/**
 * The pure projection the composable renders — a 1:1 port of the rendering decisions the web `WidgetBigNumber`
 * makes. Stateless and side-effect-free so it is fully covered by the off-device unit gate; the composable only
 * drives the count-up animation clock and applies color / typography.
 */
object WidgetBigNumberModel {
    /**
     * Reduce a [spec] to its render-ready [WidgetBigNumberContent].
     *
     * The value is formatted with [ChartFormat.number] ([decimals] fraction digits, [locale] grouping); a `null`
     * or non-finite value instead yields [nullDisplay], so the primitive never renders `NaN` and always has a
     * meaningful empty branch. Blank optional strings are normalized to `null`. The accessibility label is
     * composed in the web DOM reading order (value + unit, then label, subtitle, badge), using the label's
     * original case so a screen reader does not spell out an uppercased word.
     *
     * @param spec the presentational inputs (the web content props).
     * @param nullDisplay the fallback shown for the empty branch (web `nullDisplay`).
     * @param decimals fraction digits for the value (web `AnimatedNumber` `decimals`).
     * @param locale the formatting locale; defaults to the app/device locale, like the shared formatters.
     */
    fun project(
        spec: WidgetBigNumberSpec,
        nullDisplay: String = WidgetBigNumberDefaults.NULL_DISPLAY,
        decimals: Int = WidgetBigNumberDefaults.DECIMALS,
        locale: Locale = Locale.getDefault(),
    ): WidgetBigNumberContent {
        val value = spec.value
        val hasValue = value != null && value.isFinite()
        val displayText = if (hasValue) ChartFormat.number(value, decimals, locale) else nullDisplay

        val unit = spec.unit?.trim()?.takeIf { it.isNotEmpty() }
        val label = spec.label?.trim()?.takeIf { it.isNotEmpty() }
        val subtitle = spec.subtitle?.trim()?.takeIf { it.isNotEmpty() }
        val badge = spec.badge?.takeIf { it.text.isNotBlank() }

        return WidgetBigNumberContent(
            displayText = displayText,
            isNullValue = !hasValue,
            unit = unit,
            labelDisplay = label?.uppercase(locale),
            subtitle = subtitle,
            badge = badge,
            accessibilityLabel = accessibilityLabel(displayText, unit, label, subtitle, badge),
        )
    }

    /**
     * Compose the single TalkBack description from the non-blank fragments, in the web DOM reading order:
     * `{value}{ unit}`, then the original-case label, the subtitle, and the badge text, joined by `, `.
     */
    private fun accessibilityLabel(
        displayText: String,
        unit: String?,
        label: String?,
        subtitle: String?,
        badge: WidgetBigNumberBadge?,
    ): String {
        val valueWithUnit = if (unit != null) "$displayText $unit" else displayText
        return listOfNotNull(valueWithUnit, label, subtitle, badge?.text)
            .filter { it.isNotBlank() }
            .joinToString(separator = ", ")
    }
}

/**
 * PII-safe diagnostics for the primitive (P1/S11). Emits only the stable, dot-namespaced `view.opened` event
 * tagged with the surface [WidgetBigNumberRegistration.SLUG] — never the rendered number, unit, label, subtitle,
 * or badge — so a diagnostics line can never leak the value the primitive displays. Kept free of Compose so it is
 * unit-tested with a recording [Logger]; the composable calls it once per open.
 */
object WidgetBigNumberDiagnostics {
    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the one PII-safe `view.opened` diagnostic. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to WidgetBigNumberRegistration.SLUG))
    }
}
