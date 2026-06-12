// Pure, framework-free model + projection for the SummarySlide feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/analytics/components/review/SummarySlide.tsx). No Compose, no Android, no HTTP: every
// type here is exercised off-device in the :app:testReleaseUnitTest gate, keeping the composable a thin
// render layer. The annual recap arrives as raw SI JSON (`GET /analytics/year-review`), so this file owns
// the decode (web optional reads off `YearReview`) and the display-boundary distance conversion
// (Phase-48 SI-canonical rule; web `useUnits`).
//
// Distance parity note (no divergence): the web SummarySlide converts `total_distance_km * 1000` (km → m)
// through `convertDistanceFromSI`, the mathematically-correct SI bridge — so the native reproduces it
// verbatim. (This differs from the dashboard `YearReviewWidget`, which used the lossy `* KM_TO_MI`
// arithmetic; SummarySlide does not.)
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SummarySlide — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located
// supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.feature.views.summaryslide

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale

/** The brand prefix the screenshot card footer carries (web literal `TeslaSync • …`); not translated. */
private const val BRAND = "TeslaSync"

/** Bullet separator between the brand and the title in the footer (web `TeslaSync • Year in Review`). */
private const val FOOTER_SEPARATOR = " \u2022 "

/** 1 km = 1000 m — the SI bridge the distance conversion floors on (web `total_distance_km * 1000`). */
private const val METERS_PER_KM = 1000.0

/** Every headline figure renders as a whole number (web `decimals: 0` on every stat). */
private const val STAT_DECIMALS = 0

/** The five headline stats SummarySlide renders, in the web source's order. */
enum class SummarySlideStatIcon { Drives, Distance, Energy, Charges, Co2 }

/**
 * One projected, render-ready headline stat — the native analogue of a web `stats[]` entry. Carries the
 * leading [icon], the resolved [label] (an i18n string, or the raw distance-unit label for the distance
 * tile), the [rawValue] the count-up animation tweens to, the [decimals] it formats with, the already
 * grouped [formattedValue] (for the reduced-motion fallback + screen reader), and the merged
 * [contentDescription] TalkBack reads for the row.
 */
data class SummarySlideStat(
    val icon: SummarySlideStatIcon,
    val label: String,
    val rawValue: Double,
    val decimals: Int,
    val formattedValue: String,
    val contentDescription: String,
)

/**
 * The decoded `/analytics/year-review` payload — the native analogue of the fields the web component reads
 * off `YearReview` (`year`, `vehicle.display_name`, `vehicle.model`, `total_drives`, `total_distance_km`,
 * `total_energy_kwh`, `total_charge_sessions`, `co2_offset_kg`, `gas_savings`). Numerics are SI/raw on the
 * wire; distance conversion to the display unit happens in [SummarySlideProjection]. Missing/absent fields
 * collapse to zero / blank, exactly like the web optional reads.
 */
data class SummarySlideData(
    val year: Int,
    val vehicleName: String,
    val vehicleModel: String,
    val totalDrives: Double,
    val totalDistanceKm: Double,
    val totalEnergyKwh: Double,
    val totalChargeSessions: Double,
    val co2OffsetKg: Double,
    val gasSavings: Double,
)

/**
 * The user's display preference this surface needs — the native port of the web `useUnits` read from the
 * `/settings` document. SummarySlide only converts distance (every other figure is unit-agnostic), so it
 * carries the [distanceUnit] alone.
 */
data class SummarySlideDisplayPrefs(
    val distanceUnit: DistanceUnitPref,
) {
    companion object {
        /** Metric (km) default used before settings load (matches the web default). */
        val METRIC_DEFAULT = SummarySlideDisplayPrefs(DistanceUnitPref.KM)

        /** Resolves the display preference from the raw `/settings` document (web `useUnits`). */
        fun fromSettings(settings: JsonElement?): SummarySlideDisplayPrefs =
            SummarySlideDisplayPrefs(distanceUnit = UnitPreferences.fromSettings(settings).distance)
    }
}

/**
 * Localized labels the surface folds into its output — the web `t('yearReview.…')` keys SummarySlide
 * reads. The pure [SummarySlideProjection] reads these to assemble each visible string; the composable
 * builds this from `stringResource`, while tests pass a deterministic instance. [noData] is already
 * year-substituted (web `t('yearReview.noData', { year })`).
 */
data class SummarySlideStrings(
    val title: String,
    val drives: String,
    val energyKwh: String,
    val charges: String,
    val co2KgSaved: String,
    val screenshot: String,
    val noData: String,
    val noDataHint: String,
)

/**
 * The fully projected, render-ready view of the summary slide — the native analogue of everything the web
 * component computes before returning JSX. Pure data (no Compose types) so the projection is unit-tested
 * without a UI host. A `null` payload projects the friendly empty surface ([hasData] = false).
 */
data class SummarySlideDisplay(
    val hasData: Boolean,
    val year: String,
    val vehicleName: String,
    val vehicleModel: String,
    val title: String,
    val brandFooter: String,
    val stats: List<SummarySlideStat>,
    val showSavings: Boolean,
    val savingsAmountFormatted: String,
    val screenshotPrompt: String,
    val emptyMessage: String,
    val emptyHint: String,
)

/** Surface registration metadata — the diagnostics slug emitted with `view.opened` (P1/S11). */
object SummarySlideRegistration {
    /** The stable surface slug (matches the prompt + web component name). */
    const val SLUG = "SummarySlide"
}

/**
 * Decodes the raw `/analytics/year-review` [json] (SI, snake_case on the wire) into a [SummarySlideData],
 * or `null` when the payload is absent. A non-object input or an empty object resolves to `null`,
 * reproducing the web `data ?` truthiness gate (a disabled query / null response renders the empty
 * surface, while any populated payload — even one with all-zero totals — renders the card). A missing
 * numeric collapses to zero and a missing string to blank, reproducing the web optional reads.
 */
fun parseSummarySlide(json: JsonElement?): SummarySlideData? {
    val obj = (json as? JsonObject)?.takeIf { it.isNotEmpty() } ?: return null
    val vehicle = obj["vehicle"] as? JsonObject
    return SummarySlideData(
        year = obj.int("year"),
        vehicleName = vehicle.string("display_name"),
        vehicleModel = vehicle.string("model"),
        totalDrives = obj.double("total_drives"),
        totalDistanceKm = obj.double("total_distance_km"),
        totalEnergyKwh = obj.double("total_energy_kwh"),
        totalChargeSessions = obj.double("total_charge_sessions"),
        co2OffsetKg = obj.double("co2_offset_kg"),
        gasSavings = obj.double("gas_savings"),
    )
}

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private fun JsonObject.int(key: String): Int = (this[key] as? JsonPrimitive)?.doubleOrNull?.toInt() ?: 0

private fun JsonObject?.string(key: String): String = (this?.get(key) as? JsonPrimitive)?.contentOrNull.orEmpty()

/**
 * Pure projection from a decoded [SummarySlideData] to the render-ready [SummarySlideDisplay] — the native
 * port of the inline derivations + JSX formatting in the web source. A `null` [data] (web slide never
 * mounted without data; here the disabled-query / offline-no-cache path) projects the friendly empty
 * surface using [fallbackYear] for the "No driving data for {year}" message.
 *
 * Distance is bridged SI km → m and converted to the user's unit via [convertDistanceFromSI] (web
 * `convertDistanceFromSI(total_distance_km * 1000, distanceUnit)`), and the distance tile's label is the
 * raw unit label (web `label: distanceUnit`). The savings amount is grouped with zero fraction digits —
 * the same half-up formatting that reproduces the web `Math.round(gas_savings)` for this non-negative
 * value — and the block only shows when savings are positive (web `gas_savings > 0`).
 */
object SummarySlideProjection {
    /** Project [data] using the user's [prefs] and the localized [strings]. */
    fun project(
        data: SummarySlideData?,
        prefs: SummarySlideDisplayPrefs,
        strings: SummarySlideStrings,
        fallbackYear: Int,
        locale: Locale = Locale.US,
    ): SummarySlideDisplay {
        val footer = "$BRAND$FOOTER_SEPARATOR${strings.title}"
        if (data == null) {
            return SummarySlideDisplay(
                hasData = false,
                year = fallbackYear.toString(),
                vehicleName = "",
                vehicleModel = "",
                title = strings.title,
                brandFooter = footer,
                stats = emptyList(),
                showSavings = false,
                savingsAmountFormatted = "",
                screenshotPrompt = strings.screenshot,
                emptyMessage = strings.noData,
                emptyHint = strings.noDataHint,
            )
        }
        val displayDistance = convertDistanceFromSI(data.totalDistanceKm * METERS_PER_KM, prefs.distanceUnit)
        return SummarySlideDisplay(
            hasData = true,
            year = data.year.toString(),
            vehicleName = data.vehicleName,
            vehicleModel = data.vehicleModel,
            title = strings.title,
            brandFooter = footer,
            stats = stats(data, displayDistance, prefs, strings, locale),
            showSavings = data.gasSavings > 0.0,
            savingsAmountFormatted = ChartFormat.number(data.gasSavings, STAT_DECIMALS, locale),
            screenshotPrompt = strings.screenshot,
            emptyMessage = strings.noData,
            emptyHint = strings.noDataHint,
        )
    }

    private fun stats(
        data: SummarySlideData,
        displayDistance: Double,
        prefs: SummarySlideDisplayPrefs,
        strings: SummarySlideStrings,
        locale: Locale,
    ): List<SummarySlideStat> =
        listOf(
            stat(SummarySlideStatIcon.Drives, strings.drives, data.totalDrives, locale),
            stat(SummarySlideStatIcon.Distance, prefs.distanceUnit.label, displayDistance, locale),
            stat(SummarySlideStatIcon.Energy, strings.energyKwh, data.totalEnergyKwh, locale),
            stat(SummarySlideStatIcon.Charges, strings.charges, data.totalChargeSessions, locale),
            stat(SummarySlideStatIcon.Co2, strings.co2KgSaved, data.co2OffsetKg, locale),
        )

    private fun stat(
        icon: SummarySlideStatIcon,
        label: String,
        value: Double,
        locale: Locale,
    ): SummarySlideStat {
        val formatted = ChartFormat.number(value, STAT_DECIMALS, locale)
        return SummarySlideStat(
            icon = icon,
            label = label,
            rawValue = value,
            decimals = STAT_DECIMALS,
            formattedValue = formatted,
            contentDescription = "$formatted $label",
        )
    }
}
