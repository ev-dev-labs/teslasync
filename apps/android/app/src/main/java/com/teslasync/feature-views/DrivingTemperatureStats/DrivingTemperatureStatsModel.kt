// Pure, framework-free model + projection for the DrivingTemperatureStats feature view — the native
// analogue of everything the web component derives before returning JSX
// (web/src/features/analytics/components/analytics/DrivingTemperatureStats.tsx). No Compose, no Android,
// no HTTP: every declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping
// the composable a thin render layer.
//
// DrivingTemperatureStats is a presentational surface — the web component takes its analytics `data` as a
// prop from the Driving analytics tab (web `DrivingTab`, which owns the `useFleetAnalytics` query), so this
// surface binds no data fetch. Its two bound data sources are `useTranslation` (the i18n catalog, P1/S10)
// and `useUnits` (the temperature display preference, P1/S8). The cache-then-network lifecycle states
// (error / stale / offline) live on that owning page, not here — exactly as the web source delegates them
// to its parent. The two branches the web source itself defines are the complete state set this surface
// renders: the resolved six-card temperature grid (shown when an inside or outside reading exists, with a
// per-field "0.0" rather than a blank when a single value is absent — the web `safe()` coercion), and the
// friendly empty state ("No temperature stats") when neither reading is present. A skeleton loading branch
// is offered behind an opt-in `loading` flag the owning page threads while its query is first in flight —
// the same convention the sibling presentational surfaces use — defaulting to the web's no-loading contract.
//
// Per card the web renders `fmtNumber(convertTempFromSI(safe(field), tempUnit), 1)` for the value and the
// unit symbol (`°C` / `°F`) as the subtitle. This module reproduces that exactly: `safe()` coerces a
// null/non-finite reading to 0, the shared `convertTempFromSI` performs the SI-Celsius -> display conversion
// (the backend serves SI; conversion is display-only, ADR/Phase-48), and `formatOneDecimal` mirrors
// `Number.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })` with the
// ECMAScript `halfExpand` rounding the web `fmtNumber` applies.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/DrivingTemperatureStats — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located
// supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.drivingtemperaturestats

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.convertTempFromSI
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale

/** The em-dash sentinel rendered for a wholly-absent inside/outside reading (web `data ? … : '—'`). */
internal const val EM_DASH: String = "\u2014"

/** Web `fmtNumber(value, 1)` — temperature stats render with exactly one fractional digit. */
private const val TEMP_FRACTION_DIGITS: Int = 1

/**
 * One temperature reading's min / average / max in SI degrees Celsius — the native shape of the web
 * `data.drive_analytics.temperature.inside` (and `.outside`) object. Each field is nullable because the
 * backend may omit a statistic; the projection coerces a missing field to 0 via the web `safe()` analogue,
 * so a present reading never renders a blank cell.
 *
 * @property min the minimum recorded temperature in °C, or `null` when absent.
 * @property avg the average temperature in °C, or `null` when absent.
 * @property max the maximum recorded temperature in °C, or `null` when absent.
 */
data class TempRange(
    val min: Double?,
    val avg: Double?,
    val max: Double?,
)

/**
 * The inside + outside temperature readings this surface renders — the native slice of the web
 * `FleetAnalytics.drive_analytics.temperature` the owning Driving tab threads in. Either side may be `null`
 * (web `data?.drive_analytics?.temperature?.inside` is `undefined`), which drives the empty state.
 *
 * @property inside the cabin temperature reading, or `null` when unavailable.
 * @property outside the ambient temperature reading, or `null` when unavailable.
 */
data class DrivingTemperature(
    val inside: TempRange?,
    val outside: TempRange?,
)

/**
 * The localized labels this surface resolves once (P1/S10) and hands to the renderer. Keeping the strings
 * injectable lets the stateless content composable be exercised in a UI test without a resources host and
 * keeps the projection free of any English literal.
 *
 * @property title the panel heading (`analytics.driving.tempStats`, "Temperature Stats").
 * @property insideMin the cabin minimum card label (`analytics.driving.insideMin`).
 * @property insideAvg the cabin average card label (`analytics.driving.insideAvg`).
 * @property insideMax the cabin maximum card label (`analytics.driving.insideMax`).
 * @property outsideMin the ambient minimum card label (`analytics.driving.outsideMin`).
 * @property outsideAvg the ambient average card label (`analytics.driving.outsideAvg`).
 * @property outsideMax the ambient maximum card label (`analytics.driving.outsideMax`).
 * @property noData the empty-state message (`analytics.driving.noTempStats`, "No temperature stats").
 * @property loadingLabel the TalkBack announcement for the skeleton grid (`a11y.loading`, "Loading").
 */
data class DrivingTemperatureStatsStrings(
    val title: String,
    val insideMin: String,
    val insideAvg: String,
    val insideMax: String,
    val outsideMin: String,
    val outsideAvg: String,
    val outsideMax: String,
    val noData: String,
    val loadingLabel: String,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property loading whether the owning query is still in flight; the grid renders skeleton chrome while true.
 * @property hasData whether an inside or outside reading exists (web `insideTemp || outsideTemp`); when false
 *   the surface renders the empty state instead of the card grid.
 * @property unitLabel the temperature unit symbol shown as each card's subtitle (web `tempUnit`: `°C` / `°F`).
 * @property insideMin the formatted cabin minimum, or [EM_DASH] when the cabin reading is wholly absent.
 * @property insideAvg the formatted cabin average, or [EM_DASH] when the cabin reading is wholly absent.
 * @property insideMax the formatted cabin maximum, or [EM_DASH] when the cabin reading is wholly absent.
 * @property outsideMin the formatted ambient minimum, or [EM_DASH] when the ambient reading is wholly absent.
 * @property outsideAvg the formatted ambient average, or [EM_DASH] when the ambient reading is wholly absent.
 * @property outsideMax the formatted ambient maximum, or [EM_DASH] when the ambient reading is wholly absent.
 */
data class DrivingTemperatureStatsDisplay(
    val loading: Boolean,
    val hasData: Boolean,
    val unitLabel: String,
    val insideMin: String,
    val insideAvg: String,
    val insideMax: String,
    val outsideMin: String,
    val outsideAvg: String,
    val outsideMax: String,
)

/**
 * Pure projection from the surface's props to its render-ready [DrivingTemperatureStatsDisplay] — a 1:1 port
 * of the derivations the web component performs: the `insideTemp || outsideTemp` presence test, the
 * per-field `fmtNumber(convertTempFromSI(safe(field), tempUnit), 1)` formatting, and the `tempUnit` subtitle.
 */
object DrivingTemperatureStatsProjection {
    /**
     * Select the render-ready view for the given [temperature] reading and [loading] flag. [tempUnit] is the
     * user's display preference (web `useUnits().unitPrefs.temperature`) and [locale] the grouping/separator
     * locale (web `fmtNumber`'s active locale, derived from the same settings document).
     */
    fun project(
        temperature: DrivingTemperature?,
        loading: Boolean,
        tempUnit: TemperatureUnitPref,
        locale: Locale,
    ): DrivingTemperatureStatsDisplay {
        val inside = temperature?.inside
        val outside = temperature?.outside
        return DrivingTemperatureStatsDisplay(
            loading = loading,
            hasData = inside != null || outside != null,
            unitLabel = tempUnit.label,
            insideMin = cell(inside, tempUnit, locale) { it.min },
            insideAvg = cell(inside, tempUnit, locale) { it.avg },
            insideMax = cell(inside, tempUnit, locale) { it.max },
            outsideMin = cell(outside, tempUnit, locale) { it.min },
            outsideAvg = cell(outside, tempUnit, locale) { it.avg },
            outsideMax = cell(outside, tempUnit, locale) { it.max },
        )
    }

    /**
     * One card's value: the em-dash when the whole [range] is absent (web `data ? … : '—'`), else the
     * selected field run through `safe()` -> `convertTempFromSI` -> [formatOneDecimal], mirroring the web
     * `fmtNumber(convertTempFromSI(safe(field), tempUnit), 1)` pipeline.
     */
    private fun cell(
        range: TempRange?,
        tempUnit: TemperatureUnitPref,
        locale: Locale,
        selector: (TempRange) -> Double?,
    ): String =
        if (range == null) {
            EM_DASH
        } else {
            formatOneDecimal(convertTempFromSI(safe(selector(range)), tempUnit), locale)
        }

    /**
     * Coerce a reading to a finite number, returning 0 for a null / NaN / infinite input — a verbatim port
     * of the web `safe(v) = (typeof v === 'number' && isFinite(v) ? v : 0)` chart helper.
     */
    fun safe(value: Double?): Double = if (value != null && value.isFinite()) value else 0.0

    /**
     * Format a converted temperature the way the web `fmtNumber(value, 1)` does:
     * `Number.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })` with grouping
     * separators and ECMAScript `halfExpand` rounding (round half away from zero, so 18.25 -> "18.3"). A
     * signed zero is normalized to positive zero so a converted `-0.0` renders "0.0", matching `Intl`.
     */
    fun formatOneDecimal(
        value: Double,
        locale: Locale,
    ): String {
        val normalized = if (value == 0.0) 0.0 else value
        val formatter =
            NumberFormat.getNumberInstance(locale).apply {
                minimumFractionDigits = TEMP_FRACTION_DIGITS
                maximumFractionDigits = TEMP_FRACTION_DIGITS
                roundingMode = RoundingMode.HALF_UP
                isGroupingUsed = true
            }
        return formatter.format(normalized)
    }
}

/**
 * Resolve the BCP-47 [tag] from the user's settings (web `useUnits` locale) to a [Locale], falling back to
 * en-US for a blank/absent tag — the same default the web `fmtNumber` applies when no locale is configured.
 */
internal fun resolveDisplayLocale(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(tag)

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a
 * temperature value or the unit preference — so a diagnostics line can never leak fleet telemetry.
 */
object DrivingTemperatureStatsDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "DrivingTemperatureStats"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
