// Pure, framework-free model + projections for the LifetimeStatsPage analytics surface — the native analogue of
// everything the web page derives before composing its panels (web/src/features/analytics/pages/LifetimeStatsPage.tsx).
// No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it only references the framework-free
// UiState projection, the shared-core Resource/units, and the reused AchievementData), so the composable stays a thin
// render layer and all of this is exercised off-device by the :android:testDebugUnitTest gate.
//
// The web page owns these concerns this file ports: (1) the decode of the raw `/analytics/lifetime` SI JSON envelope
// into a typed [LifetimeStats] (web optional-chaining → null-safe reads); (2) the display-boundary unit + currency
// derivation from the `/settings` document ([LifetimeStatsDisplayPrefs], web `useUnits`/`useFormatting`); and (3) the
// per-field formatting helpers the panels call (distance/speed SI→display conversion, currency, grouped numbers,
// localized dates — web `fromKm`/`fromKmh`/`fmtNumber`/`fmtInt`/`formatCurrency`/`formatDate`).
//
// SI-canonical (Phase-48 / unit-conversion.instructions): every distance/speed value is read SI off the wire and
// converted ONLY at the display boundary via the shared [convertDistanceFromSI]/[convertSpeedFromSI]; nothing is
// stored or computed in non-SI units. The lifetime feed reports distance records in SI kilometres and the speed
// record in SI km/h (per the web page's own comment + internal/api/lifetime/handler.go), so both are bridged to the
// SI base (metres / metres-per-second) before conversion — exactly as the web `fromKm`/`fromKmh` do.
//
// Empty-state divergence (Honesty Covenant #9 — documented, not silent): the web guards its data sections on the
// truthiness of the loaded payload (`stats ?`), which renders a grid of zeros for a brand-new all-zero account. The
// native surface instead routes an all-zero payload to UiPhase.Empty (via [LifetimeStats.hasData]) so each section
// shows its friendly empty-state composable — the same `hasData` gate the sibling LifetimeStatsWidget /
// AnalyticsSummaryWidget use, and what makes the four declared data states genuinely reachable. The hero + the four
// stat cards still render their (possibly zero) totals in every loaded state, exactly like the web.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling admin pages do.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.analytics.lifetimestats

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.android.featureviews.achievementbadge.AchievementData
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertSpeedFromSI
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** The default fiat symbol — the web `useFormatting` fallback when `settings.currency_symbol` is blank/absent. */
private const val DEFAULT_CURRENCY_SYMBOL = "$"

/** Default currency fraction digits (web `useFormatting` `decimal_precision ?? 2`). */
private const val DEFAULT_PRECISION = 2

/** 1 km = 1000 m — the SI bridge the distance records floor on before conversion (web `METERS_PER_KM`). */
private const val METERS_PER_KM = 1000.0

/** Seconds per hour — the SI bridge km/h → m/s floors on before the speed conversion (web `SECONDS_PER_HOUR`). */
private const val SECONDS_PER_HOUR = 3600.0

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `LifetimeStatsPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("lifetimeStats", "/lifetime-stats", …)`, so the host binds this surface to that destination (and its
 * `/lifetime-stats` deep link) without the nav module depending on it.
 */
object LifetimeStatsPageRegistration {
    /** The navigation destination id (Destinations.kt `page("lifetimeStats", "/lifetime-stats", …)`). */
    const val ROUTE_ID: String = "lifetimeStats"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/lifetime-stats"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "LifetimeStatsPage"
}

/**
 * One personal record — the native mirror of the web `LifetimeStats.{longest_drive,highest_speed,max_charge}_record`
 * shape (internal/api/lifetime/handler.go `PersonalRecord{ value, date }`). [value] is SI (km for the distance
 * records, km/h for the speed record, kWh for the charge record); [date] is a nullable ISO timestamp.
 */
data class LifetimeRecord(
    val value: Double,
    val date: String?,
)

/**
 * The decoded `/analytics/lifetime` payload — the native analogue of the web `LifetimeStats` interface every panel
 * reads. All numerics are SI/raw on the wire (km, km/h, kWh, kg, counts); display conversion happens in the
 * formatters below. Missing / JSON-null fields collapse to their zero / empty default, exactly like the web
 * optional-chaining (`data?.x ?? 0`).
 */
data class LifetimeStats(
    val totalDrives: Double,
    val totalDistanceKm: Double,
    val totalDrivingHours: Double,
    val totalEnergyKwh: Double,
    val totalChargeSessions: Double,
    val totalChargingCost: Double,
    val gasEquivalentCost: Double,
    val totalSavings: Double,
    val co2OffsetKg: Double,
    val treesEquivalent: Double,
    val earthCircumferences: Double,
    val moonTrips: Double,
    val daysOnRoad: Double,
    val homesEquivalentDays: Double,
    val ownershipDays: Double,
    val firstDriveDate: String?,
    val mostActiveDayOfWeek: String,
    val mostActiveHour: Int?,
    val avgEfficiencyWhKm: Double,
    val longestDriveRecord: LifetimeRecord,
    val highestSpeedRecord: LifetimeRecord,
    val maxChargeRecord: LifetimeRecord,
    val achievements: List<AchievementData>,
) {
    /**
     * Whether any meaningful lifetime total has accrued. A brand-new account with no drives, distance, energy or
     * ownership days routes to the friendly empty surface (web `noData`) rather than a grid of zeros — mirroring the
     * sibling LifetimeStatsWidget / AnalyticsSummaryWidget `hasData` gate.
     */
    val hasData: Boolean
        get() = totalDrives > 0.0 || totalDistanceKm > 0.0 || totalEnergyKwh > 0.0 || ownershipDays > 0.0

    /** Count of unlocked achievements (web `achievements.filter(a => a.unlocked).length`). */
    val unlockedCount: Int get() = achievements.count { it.unlocked }

    companion object {
        /** The all-zero snapshot, surfaced for a null / non-object payload. */
        val EMPTY: LifetimeStats =
            LifetimeStats(
                totalDrives = 0.0,
                totalDistanceKm = 0.0,
                totalDrivingHours = 0.0,
                totalEnergyKwh = 0.0,
                totalChargeSessions = 0.0,
                totalChargingCost = 0.0,
                gasEquivalentCost = 0.0,
                totalSavings = 0.0,
                co2OffsetKg = 0.0,
                treesEquivalent = 0.0,
                earthCircumferences = 0.0,
                moonTrips = 0.0,
                daysOnRoad = 0.0,
                homesEquivalentDays = 0.0,
                ownershipDays = 0.0,
                firstDriveDate = null,
                mostActiveDayOfWeek = "",
                mostActiveHour = null,
                avgEfficiencyWhKm = 0.0,
                longestDriveRecord = LifetimeRecord(0.0, null),
                highestSpeedRecord = LifetimeRecord(0.0, null),
                maxChargeRecord = LifetimeRecord(0.0, null),
                achievements = emptyList(),
            )
    }
}

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` + `useFormatting` reads
 * from the `/settings` document: the [distanceUnit] + [speedUnit] (distance/speed figures), the [currencySymbol]
 * (blank → "$"), the currency [precision] (web `decimal_precision`, floored & non-negative, else 2), and the
 * [locale] used for grouped-number + date formatting (web global locale, `settings.locale || 'en-US'`).
 */
data class LifetimeStatsDisplayPrefs(
    val distanceUnit: DistanceUnitPref,
    val speedUnit: SpeedUnitPref,
    val currencySymbol: String,
    val precision: Int,
    val locale: Locale,
) {
    /** SI km → the user's display distance (web `fromKm`: `convertDistanceFromSI(km * 1000, unit)`). */
    fun fromKm(km: Double): Double = convertDistanceFromSI(km * METERS_PER_KM, distanceUnit)

    /** SI km/h → the user's display speed (web `fromKmh`: `convertSpeedFromSI(kmh * 1000 / 3600, unit)`). */
    fun fromKmh(kmh: Double): Double = convertSpeedFromSI(kmh * METERS_PER_KM / SECONDS_PER_HOUR, speedUnit)

    /** The distance unit's display label (e.g. "km" / "mi"). */
    val distanceLabel: String get() = distanceUnit.label

    /** The speed unit's display label (e.g. "km/h" / "mph"). */
    val speedLabel: String get() = speedUnit.label

    /** Grouped number in the user's locale (web `fmtNumber(value, decimals)`). */
    fun number(
        value: Double,
        decimals: Int,
    ): String = ChartFormat.number(value, decimals, locale)

    /** Grouped integer in the user's locale (web `fmtInt(value)`). */
    fun integer(value: Double): String = ChartFormat.number(value, 0, locale)

    /**
     * Currency as the web `formatCurrency` renders it — the user's [currencySymbol] (blank → "$") followed by a
     * [decimals]-digit grouped number in the user's locale. Defaults to the configured [precision] (web prop default).
     */
    fun currency(
        amount: Double,
        decimals: Int = precision,
    ): String = currencySymbol.ifBlank { DEFAULT_CURRENCY_SYMBOL } + number(amount, decimals.coerceAtLeast(0))

    /**
     * A localized medium-style date for [raw] (web `useDateFormat().formatDate`), or `null` when [raw] is null /
     * blank / unparseable so the panel omits the date line (web `date && …`). Accepts an ISO date or date-time.
     */
    fun formatDate(raw: String?): String? {
        if (raw.isNullOrBlank()) return null
        val parsed =
            runCatching { OffsetDateTime.parse(raw).toLocalDate() }
                .recoverCatching { LocalDate.parse(raw) }
                .recoverCatching { LocalDate.parse(raw.take(DATE_PREFIX_LENGTH)) }
                .getOrNull() ?: return raw
        return parsed.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale))
    }

    companion object {
        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"
        private const val DATE_PREFIX_LENGTH = 10

        /** Metric + `$` + 2dp + en-US defaults used before settings load (matches the web defaults). */
        val DEFAULT: LifetimeStatsDisplayPrefs =
            LifetimeStatsDisplayPrefs(
                distanceUnit = DistanceUnitPref.KM,
                speedUnit = SpeedUnitPref.KMH,
                currencySymbol = DEFAULT_CURRENCY_SYMBOL,
                precision = DEFAULT_PRECISION,
                locale = Locale.US,
            )

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`/`useFormatting`). */
        fun fromSettings(settings: JsonElement?): LifetimeStatsDisplayPrefs {
            val unit = UnitPreferences.fromSettings(settings)
            val rawSymbol = (settings as? JsonObject)?.string(KEY_CURRENCY_SYMBOL)?.trim()
            return LifetimeStatsDisplayPrefs(
                distanceUnit = unit.distance,
                speedUnit = unit.speed,
                currencySymbol = if (!rawSymbol.isNullOrEmpty()) rawSymbol else DEFAULT_CURRENCY_SYMBOL,
                precision = unit.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION,
                locale = unit.locale?.takeIf { it.isNotBlank() }?.let(Locale::forLanguageTag) ?: Locale.US,
            )
        }
    }
}

/**
 * Decodes the raw `/analytics/lifetime` [json] (SI, snake_case on the wire) into a [LifetimeStats]. A non-object
 * input, a missing field, or a JSON-null field all collapse to zero / empty — reproducing the web optional-chaining
 * (`data?.x ?? 0`). The personal-record sub-objects and the achievements array are decoded null-safely too.
 */
fun parseLifetimeStats(json: JsonElement?): LifetimeStats {
    val obj = json as? JsonObject ?: return LifetimeStats.EMPTY
    return LifetimeStats(
        totalDrives = obj.double("total_drives"),
        totalDistanceKm = obj.double("total_distance_km"),
        totalDrivingHours = obj.double("total_driving_hours"),
        totalEnergyKwh = obj.double("total_energy_kwh"),
        totalChargeSessions = obj.double("total_charge_sessions"),
        totalChargingCost = obj.double("total_charging_cost"),
        gasEquivalentCost = obj.double("gas_equivalent_cost"),
        totalSavings = obj.double("total_savings"),
        co2OffsetKg = obj.double("co2_offset_kg"),
        treesEquivalent = obj.double("trees_equivalent"),
        earthCircumferences = obj.double("earth_circumferences"),
        moonTrips = obj.double("moon_trips"),
        daysOnRoad = obj.double("days_on_road"),
        homesEquivalentDays = obj.double("homes_equivalent_days"),
        ownershipDays = obj.double("ownership_days"),
        firstDriveDate = obj.string("first_drive_date"),
        mostActiveDayOfWeek = obj.string("most_active_day_of_week") ?: "",
        mostActiveHour = obj.intField("most_active_hour"),
        avgEfficiencyWhKm = obj.double("avg_efficiency_wh_km"),
        longestDriveRecord = obj.record("longest_drive_record"),
        highestSpeedRecord = obj.record("highest_speed_record"),
        maxChargeRecord = obj.record("max_charge_record"),
        achievements = obj.achievements(),
    )
}

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

private fun JsonObject.intField(key: String): Int? = (this[key] as? JsonPrimitive)?.intOrNull

private fun JsonObject.record(key: String): LifetimeRecord {
    val obj = this[key] as? JsonObject ?: return LifetimeRecord(0.0, null)
    return LifetimeRecord(value = obj.double("value"), date = obj.string("date"))
}

private fun JsonObject.achievements(): List<AchievementData> =
    (this["achievements"] as? JsonArray)
        ?.mapNotNull { (it as? JsonObject)?.toAchievement() }
        ?: emptyList()

/** Decodes one achievement object into the reused [AchievementData] (web `AchievementData`), null-safe per field. */
private fun JsonObject.toAchievement(): AchievementData =
    AchievementData(
        id = string("id") ?: "",
        name = string("name") ?: "",
        description = string("description") ?: "",
        icon = string("icon") ?: "",
        unlocked = (this["unlocked"] as? JsonPrimitive)?.booleanOrNull ?: false,
        unlockedAt = string("unlocked_at"),
        progress = double("progress"),
        target = double("target"),
        current = double("current"),
    )

/**
 * Maps the value inside a cache-then-network [Resource], preserving its lifecycle case + freshness flags. The cached
 * value (present on `Loading`/`Error` for an instant cold start) and the fresh `Success` value are both transformed;
 * the `Throwable` and the `fetchedAt`/`stale` stamps pass through untouched. Pure, so the view-model's
 * `JsonElement → LifetimeStats` projection stays unit-testable off-device.
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [LifetimeStatsPageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first
 * composition. Carries no vehicle id, distance, cost or achievement payload.
 */
fun recordLifetimeStatsOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to LifetimeStatsPageRegistration.SLUG))
}
