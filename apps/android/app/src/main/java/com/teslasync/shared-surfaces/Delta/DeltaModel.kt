// Pure, framework-free model + projection + diagnostics for the Delta shared surface — the native
// analogue of web/src/components/data-display/Delta.tsx together with the hooks it binds to:
// web/src/hooks/useUnits.ts (`useUnits`), web/src/hooks/useFormatting.ts (`useFormatting`), the local
// `useUnitLabels` hook inside the source, and web/src/lib/metricSemantics.ts. No Compose, no Android
// framework, no HTTP: every declaration here is exercised off-device in the :android:testReleaseUnitTest
// gate, keeping the composable a thin render layer.
//
// What the web source actually is (and therefore the COMPLETE branch set this surface reproduces): the
// web `Delta` is a direction-aware change indicator. It takes a caller-supplied `current` / `previous`
// pair (already in the metric's display units), derives the signed change + percent, picks a unified
// arrow that encodes the sign (the value is always rendered positive — "down 5%", never "up -5%"), and
// colors it good / bad / muted by the metric's `direction`. Its three real render branches are:
//   * loading           → a skeleton chip (web `<Skeleton>`), reproduced as [DeltaProjection.Loading];
//   * missing inputs     → an em dash with no color + the `delta.noComparison` title, reproduced as
//                          [DeltaProjection.Empty] (web `current == null || previous == null`);
//   * a resolved delta   → arrow + value + optional `comparedTo` + the `delta.title` tooltip, reproduced
//                          as [DeltaProjection.Value], with the percent / absolute / both display forms
//                          and the `previous == 0` percent fallback to an em dash.
// The hooks it consumes are resolved here as a single [DeltaUnitContext]: `useUnits` → the display
// [UnitPref], `useFormatting` → the currency symbol + precision, and the component-local `useUnitLabels`
// switch → [resolveUnitLabels]. `useCompareWindow` is NOT consumed internally — the web component takes
// its `comparedTo` label as a prop (`Pass useCompareWindow(...).previousLabel`), so it stays a surface
// parameter, never an internal fetch.
//
// Why the generic data-surface states (error / stale / offline) are intentionally absent: `Delta` is a
// PURE PRESENTATIONAL projection of caller-supplied numbers — it fetches nothing, so it never errors,
// goes stale or goes offline. Modelling those would fabricate behaviour the web spec does not have
// (Honesty Covenant: no scope narrowing, no silent drift) — the same rationale the accepted
// VisuallyHidden / ChartLegend ports document. Its REAL, fully-reproduced states are the loading, empty
// and resolved branches above; the one async dependency it has — the user's unit preferences — flows in
// through the shared settings state holder ([DeltaUnitContext], bound by the source + view-model) so a
// units change re-renders every Delta without the view knowing how the preference is stored.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/Delta — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.delta

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.datadisplay.DeltaArrow
import io.teslasync.android.components.datadisplay.DeltaDisplay
import io.teslasync.android.components.datadisplay.DeltaTone
import io.teslasync.android.components.datadisplay.MetricSemantic
import io.teslasync.android.components.datadisplay.MetricUnit
import io.teslasync.android.components.datadisplay.deltaArrow
import io.teslasync.android.components.datadisplay.deltaTone
import io.teslasync.android.components.datadisplay.percentDelta
import io.teslasync.android.components.datadisplay.signedDelta
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.UnitPref
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.util.Locale
import kotlin.math.abs

/**
 * Canonical registry metadata for the Delta surface. The diagnostics [SLUG] is emitted with the one-shot
 * `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`Delta`).
 */
object DeltaRegistration {
    /** Stable surface id (also the `viewModel` key the host binds the indicator with). */
    const val ID: String = "delta"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "Delta"
}

/**
 * The rendered size of a [Delta] chip — the native tag for the web `size` prop (`'sm' | 'md'`). [Sm]
 * (web default) is the compact inline form; [Md] is the slightly larger stat-row form. The render
 * boundary maps this onto a text style + icon dimension.
 */
enum class DeltaSize {
    /** Web `size="sm"` — compact inline chip (the default). */
    Sm,

    /** Web `size="md"` — the larger stat-row form. */
    Md,
}

/** The em dash shown for a missing comparison or an undefined percent (web `'—'`). */
const val EM_DASH: String = "\u2014"

/** Settings key carrying the user's currency glyph (web `settings.currency_symbol`). */
private const val CURRENCY_SYMBOL_KEY: String = "currency_symbol"

/** Fallback currency glyph when settings carry none (web `: '$'`). */
private const val DEFAULT_CURRENCY_SYMBOL: String = "$"

/** Default absolute / title precision when neither the caller nor settings specify one (web `?? 2`). */
private const val DEFAULT_PRECISION: Int = 2

/** Percent precision when the caller specifies none (web `precision ?? 1`). */
private const val PERCENT_PRECISION: Int = 1

/** Energy suffix for the kWh metric unit (web `'kWh'`). */
private const val ENERGY_KWH: String = "kWh"

/** Energy suffix for the watt-hour metric unit (web `'Wh'`). */
private const val ENERGY_WH: String = "Wh"

/** Efficiency suffix in miles mode (web `'Wh/mi'`). */
private const val EFFICIENCY_MI: String = "Wh/mi"

/** Efficiency suffix in kilometre mode (web `'Wh/km'`). */
private const val EFFICIENCY_KM: String = "Wh/km"

/** Duration-hours suffix (web `'h'`). */
private const val HOURS_SUFFIX: String = "h"

/** Duration-minutes suffix (web `'min'`). */
private const val MINUTES_SUFFIX: String = "min"

/** Percent suffix (web `'%'`). */
private const val PERCENT_SUFFIX: String = "%"

/**
 * The resolved display-unit context a [Delta] renders against — the native consolidation of the web
 * `useUnits().unitPrefs` and `useFormatting().currencySymbol`, both derived from the shared settings
 * document. The source maps the live settings into this so a units change re-renders every Delta without
 * the view knowing how the preference is stored.
 *
 * @property prefs the user's display [UnitPref] (distance / speed / temperature / pressure + locale +
 *   precision), the web `unitPrefs`.
 * @property currencySymbol the user's currency glyph for the currency metric prefix (web
 *   `useFormatting().currencySymbol`), `$` when unset.
 */
data class DeltaUnitContext(
    val prefs: UnitPref,
    val currencySymbol: String,
) {
    /** The user's default decimal precision (web `useFormatting` user precision); `null` ⇒ use the default. */
    val precision: Int? get() = prefs.precision

    companion object {
        /** The metric-default context for previews / cold start before settings load (web defaults). */
        val DEFAULT: DeltaUnitContext = fromSettings(null)

        /**
         * Builds a [DeltaUnitContext] from the raw `/settings` document — the native mirror of the web
         * `useUnits` + `useFormatting` derivation. Delegates unit-pref resolution to the shared
         * [UnitPreferences] (the single SI ⇒ display boundary) and extracts the currency glyph here.
         */
        fun fromSettings(settings: JsonElement?): DeltaUnitContext =
            DeltaUnitContext(
                prefs = UnitPreferences.fromSettings(settings),
                currencySymbol = parseCurrencySymbol(settings),
            )

        private fun parseCurrencySymbol(settings: JsonElement?): String {
            val raw = ((settings as? JsonObject)?.get(CURRENCY_SYMBOL_KEY) as? JsonPrimitive)?.contentOrNull
            return if (raw != null && raw.isNotBlank()) raw else DEFAULT_CURRENCY_SYMBOL
        }
    }
}

/**
 * The prefix / suffix a value is wrapped with — the native analogue of the web `useUnitLabels` result.
 * [prefix] is shown before the number (e.g. a currency glyph); [suffix] after it with a leading space
 * (e.g. `kWh`), except `%` which hugs the number.
 */
data class DeltaUnitLabels(
    val prefix: String,
    val suffix: String,
)

/**
 * Resolves the prefix / suffix for a metric [unit] against the live [context] — the faithful port of the
 * web `useUnitLabels` switch. Distance / speed / temperature / pressure read the user's preferred unit
 * label (web `unitPrefs.*`); currency reads the user's glyph; efficiency flips Wh/mi ↔ Wh/km with the
 * distance preference; the rest are fixed.
 */
fun resolveUnitLabels(
    unit: MetricUnit,
    context: DeltaUnitContext,
): DeltaUnitLabels =
    when (unit) {
        MetricUnit.Currency -> DeltaUnitLabels(prefix = context.currencySymbol, suffix = "")
        MetricUnit.Percent -> DeltaUnitLabels(prefix = "", suffix = PERCENT_SUFFIX)
        MetricUnit.Distance -> DeltaUnitLabels(prefix = "", suffix = context.prefs.distance.label)
        MetricUnit.Energy -> DeltaUnitLabels(prefix = "", suffix = ENERGY_KWH)
        MetricUnit.EnergyWh -> DeltaUnitLabels(prefix = "", suffix = ENERGY_WH)
        MetricUnit.Efficiency -> DeltaUnitLabels(prefix = "", suffix = efficiencyLabel(context.prefs))
        MetricUnit.Hours -> DeltaUnitLabels(prefix = "", suffix = HOURS_SUFFIX)
        MetricUnit.Minutes -> DeltaUnitLabels(prefix = "", suffix = MINUTES_SUFFIX)
        MetricUnit.Speed -> DeltaUnitLabels(prefix = "", suffix = context.prefs.speed.label)
        MetricUnit.Temperature -> DeltaUnitLabels(prefix = "", suffix = context.prefs.temperature.label)
        MetricUnit.Pressure -> DeltaUnitLabels(prefix = "", suffix = context.prefs.pressure.label)
        MetricUnit.Count -> DeltaUnitLabels(prefix = "", suffix = "")
    }

/** The efficiency suffix for the distance preference — Wh/mi in miles mode, else Wh/km (web parity). */
private fun efficiencyLabel(prefs: UnitPref): String = if (prefs.distance == DistanceUnitPref.MI) EFFICIENCY_MI else EFFICIENCY_KM

/**
 * Formats a positive [absValue] with the resolved unit [labels] — the native mirror of the web
 * `formatAbsolute`: prefix + suffix join with a space, a lone prefix hugs the number, `%` hugs the
 * number, a lone suffix joins with a space, and a bare number otherwise.
 */
fun formatAbsolute(
    absValue: Double,
    labels: DeltaUnitLabels,
    decimals: Int,
    locale: Locale,
): String {
    val num = ChartFormat.number(absValue, decimals, locale)
    return when {
        labels.prefix.isNotEmpty() && labels.suffix.isNotEmpty() -> "${labels.prefix}$num ${labels.suffix}"
        labels.prefix.isNotEmpty() -> "${labels.prefix}$num"
        labels.suffix == PERCENT_SUFFIX -> "$num$PERCENT_SUFFIX"
        labels.suffix.isNotEmpty() -> "$num ${labels.suffix}"
        else -> num
    }
}

/** Resolves a BCP-47 [tag] to a JVM [Locale] for grouping / separators; en-US when blank (web default). */
fun resolveLocale(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(tag)

/**
 * The caller-supplied inputs a [Delta] renders — the native analogue of the web `DeltaProps` value
 * fields. [current] / [previous] are already in the metric's display units (the caller converts);
 * [metric] carries the good-direction + unit hint; [display] selects percent / absolute / both;
 * [comparedTo] is the trailing label (web `useCompareWindow(...).previousLabel`); [loading] forces the
 * skeleton; [precision] overrides the default decimal precision.
 */
data class DeltaInput(
    val current: Double?,
    val previous: Double?,
    val metric: MetricSemantic,
    val display: DeltaDisplay = DeltaDisplay.Percent,
    val comparedTo: String? = null,
    val loading: Boolean = false,
    val precision: Int? = null,
)

/**
 * The projected render state a [Delta] paints — the native analogue of the web component's three render
 * branches. Framework-free so the whole contract is covered by the JVM unit gate without a Compose host.
 */
sealed interface DeltaProjection {
    /** Web `loading` → a skeleton chip. */
    data object Loading : DeltaProjection

    /**
     * Web missing-inputs branch (`current`/`previous` null or non-finite) → an em dash with no color and
     * the `delta.noComparison` accessible title. [comparedTo] is still rendered when present.
     */
    data class Empty(
        val comparedTo: String?,
    ) : DeltaProjection

    /**
     * Web resolved-delta branch → an [arrow] encoding the sign, a [tone] coloring good / bad / muted, the
     * formatted [valueText] (always a positive magnitude), the optional [comparedTo] label, and the
     * [currentText] / [previousText] that fill the `delta.title` accessible tooltip.
     */
    data class Value(
        val arrow: DeltaArrow,
        val tone: DeltaTone,
        val valueText: String,
        val comparedTo: String?,
        val currentText: String,
        val previousText: String,
    ) : DeltaProjection

    companion object {
        /**
         * Projects [input] against the live unit [context] into the branch the composable paints — the
         * native mirror of everything the web `Delta` decides between its hooks and its returned JSX.
         * Loading wins first (web early `if (loading)`); then missing / non-finite inputs render the empty
         * branch (web `current == null || previous == null`); otherwise the resolved delta is computed
         * with the shared sign / percent / tone / arrow math and the unit-aware value text.
         */
        fun project(
            input: DeltaInput,
            context: DeltaUnitContext,
        ): DeltaProjection = if (input.loading) Loading else projectResolved(input, context)

        private fun projectResolved(
            input: DeltaInput,
            context: DeltaUnitContext,
        ): DeltaProjection {
            val current = input.current
            val previous = input.previous
            // The branches narrow both to non-null, finite Double (web `current == null || !isFinite`).
            return when {
                current == null || previous == null -> Empty(input.comparedTo)
                !current.isFinite() || !previous.isFinite() -> Empty(input.comparedTo)
                else -> resolvedValue(input, context, current, previous)
            }
        }

        private fun resolvedValue(
            input: DeltaInput,
            context: DeltaUnitContext,
            current: Double,
            previous: Double,
        ): Value {
            val signed = signedDelta(current, previous)
            val pct = percentDelta(current, previous)
            val labels = resolveUnitLabels(input.metric.unit, context)
            val locale = resolveLocale(context.prefs.locale)
            val absDecimals = input.precision ?: context.precision ?: DEFAULT_PRECISION
            val pctDecimals = input.precision ?: PERCENT_PRECISION
            val titleDecimals = input.precision ?: DEFAULT_PRECISION
            val absText = formatAbsolute(abs(signed), labels, absDecimals, locale)
            val pctText = pct?.let { "${ChartFormat.number(abs(it), pctDecimals, locale)}$PERCENT_SUFFIX" }
            return Value(
                arrow = deltaArrow(signed),
                tone = deltaTone(input.metric.direction, signed),
                valueText = valueTextFor(input.display, absText, pctText),
                comparedTo = input.comparedTo,
                currentText = ChartFormat.number(current, titleDecimals, locale),
                previousText = ChartFormat.number(previous, titleDecimals, locale),
            )
        }

        /**
         * The value text for the chosen [display] — the native mirror of the web `valueNode` switch:
         * absolute shows the magnitude; both appends `(pct)` when a percent exists; percent shows the
         * percent or falls back to an em dash when `previous == 0` made it undefined.
         */
        private fun valueTextFor(
            display: DeltaDisplay,
            absText: String,
            pctText: String?,
        ): String =
            when (display) {
                DeltaDisplay.Absolute -> absText
                DeltaDisplay.Both -> if (pctText != null) "$absText ($pctText)" else absText
                DeltaDisplay.Percent -> pctText ?: EM_DASH
            }
    }
}

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [DeltaRegistration.SLUG]
 * (P1/S11) — never a metric value nor a comparison, so a diagnostics line can never leak what a user was
 * comparing. Kept free of Compose so it is unit-tested with a recording [Logger]; the ViewModel calls it
 * once per surface open.
 */
fun recordDeltaOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to DeltaRegistration.SLUG))
}
