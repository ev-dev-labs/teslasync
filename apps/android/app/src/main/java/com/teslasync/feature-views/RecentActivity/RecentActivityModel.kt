// Pure, framework-free model + projection for the `RecentActivity` feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/dashboard/components/RecentActivity.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web component is purely presentational — its parent passes `recentDrives` / `recentCharges` /
// `analytics` plus the unit props, and the component composes three panels: a unified activity feed
// (drives + charges, newest first, top eight), a battery-percent area trend over the recent drives, and a
// fleet-performance stat block (total drives / charge sessions / total cost / CO2 saved / most-efficient
// vehicle). This file owns exactly those derivations so the composable can stay declarative: the merged +
// time-sorted activity rows ([RecentActivityProjection.activityRows]), the reversed battery trend series
// ([RecentActivityProjection.batteryTrend]), the CO2 estimate ([RecentActivityProjection.co2SavedKg]), and
// the relative "x ago" timestamp classification ([RecentActivityTimeFormatting]). The two web hooks map to
// shared layers: `useTranslation` -> the i18n catalog and `useFormatting` -> the injected formatter
// lambdas ([RecentActivityFormatters]) + the currency preferences resolved from `/settings`
// ([RecentActivityDisplay]).
//
// SI on the wire, display at the boundary: drive distance is metres and charge energy is watt-hours exactly
// as the API serves them (Phase-48 SI-canonical); the only place they become miles/km or kWh is the
// injected formatter lambdas, which the composable builds from the shared `UnitFormatter`. The analytics
// `totalEnergyKwh` is already kWh on the wire (the web `total_energy_kwh`), so the CO2 estimate multiplies it
// by the same 0.42 kg/kWh factor the web uses.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/RecentActivity — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.recentactivity

import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.floor

/** Maximum number of activity rows the feed renders — the web `activityItems.slice(0, 8)`. */
internal const val ACTIVITY_FEED_LIMIT: Int = 8

/** Battery value used when a drive has no `end_soc_pct` — the web `d.end_soc_pct ?? 50`. */
internal const val BATTERY_TREND_DEFAULT_SOC: Double = 50.0

/** Kilograms of CO2 saved per kWh — the web `(total_energy_kwh ?? 0) * 0.42`. */
internal const val CO2_KG_PER_KWH: Double = 0.42

/** Sentinel printed for a missing state-of-charge — the web `?? '?'`. */
internal const val SOC_UNKNOWN: String = "?"

/** Trailing percent sign on each state-of-charge value — the web `${soc}%`. */
internal const val PERCENT_SIGN: String = "%"

/** Spaced right arrow between the start and end SoC — the web `→`. */
internal const val SOC_ARROW: String = " \u2192 "

/** Spaced middle dot separating subtitle segments — the web `·`. */
internal const val DOT_SEPARATOR: String = " \u00b7 "

/** Hours unit letter in the drive duration — the web `${h}h`. */
internal const val HOUR_UNIT: String = "h"

/** Minutes unit letter in the drive duration — the web `${m}m`. */
internal const val MINUTE_UNIT: String = "m"

/** Trailing unit on the CO2-saved stat — the web `${fmtInt(...)} kg`. */
internal const val CO2_UNIT_SUFFIX: String = " kg"

private const val SECONDS_PER_HOUR: Long = 3_600L
private const val SECONDS_PER_MINUTE: Long = 60L
private const val MILLIS_PER_MINUTE: Long = 60_000L
private const val MINUTES_PER_HOUR: Long = 60L
private const val HOURS_PER_DAY: Long = 24L
private const val DAYS_PER_WEEK: Long = 7L

private const val KEY_CURRENCY_SYMBOL: String = "currency_symbol"
private const val DEFAULT_CURRENCY: String = "$"
private const val DEFAULT_PRECISION: Int = 2
private const val DEFAULT_LOCALE_TAG: String = "en-US"

private const val VIEW_OPENED_EVENT: String = "view.opened"
private const val SURFACE_KEY: String = "surface"

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object RecentActivityRegistration {
    /** Stable surface id. */
    const val ID: String = "recent-activity"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "RecentActivity"
}

/**
 * The subset of a drive this surface reads — the native mirror of the web `Drive` fields the feed + trend
 * touch. [distanceM] is SI metres and [durationS] SI seconds; [startSocPct]/[endSocPct] are 0-100 battery
 * percentages (nullable, the web `?? '?'` / `?? 50` cases); [startedAtMillis] is the epoch-millisecond
 * `started_at` used to order and relative-time the row.
 */
data class RecentActivityDrive(
    val distanceM: Double,
    val durationS: Long,
    val startSocPct: Double?,
    val endSocPct: Double?,
    val startedAtMillis: Long,
)

/**
 * The subset of a charging session this surface reads — the native mirror of the web `ChargingSession`
 * fields the feed touches. [totalEnergyAddedWh] is SI watt-hours; [startSocPct]/[endSocPct] are 0-100
 * percentages; [cost] is the optional session cost (web `typeof s.cost === 'number'`); [startedAtMillis] is
 * the epoch-millisecond `started_at`.
 */
data class RecentActivityCharge(
    val totalEnergyAddedWh: Double,
    val startSocPct: Double?,
    val endSocPct: Double?,
    val cost: Double?,
    val startedAtMillis: Long,
)

/**
 * The most-efficient vehicle callout — the native mirror of the web
 * `analytics.most_efficient_vehicle` (`{ name, efficiency }`). [efficiencyWhPerKm] is the SI-canonical
 * Wh/km figure the API serves (web `efficiency`), formatted for display by the injected formatter.
 */
data class MostEfficientVehicle(
    val name: String,
    val efficiencyWhPerKm: Double,
)

/**
 * The fleet-performance figures this surface reads — the native mirror of the web `FleetAnalytics` fields
 * the stat block renders. [totalEnergyKwh] is kWh on the wire (web `total_energy_kwh`), used for the CO2
 * estimate; [mostEfficient] is absent when the backend has no winner yet (web
 * `analytics?.most_efficient_vehicle &&`).
 */
data class RecentActivityAnalytics(
    val totalDrives: Long,
    val totalChargingSessions: Long,
    val totalCost: Double,
    val totalEnergyKwh: Double,
    val mostEfficient: MostEfficientVehicle? = null,
)

/**
 * The full payload the surface renders — the native grouping of the web component's three props
 * (`recentDrives`, `recentCharges`, `analytics`) into one value the host carries through the [UiState].
 * Defaulted to empty so the loading / empty lifecycle states are expressible without a payload.
 */
data class RecentActivityData(
    val drives: List<RecentActivityDrive> = emptyList(),
    val charges: List<RecentActivityCharge> = emptyList(),
    val analytics: RecentActivityAnalytics? = null,
)

/** Whether an activity row is a drive or a charge — selects the row's glyph and design-token accent. */
enum class ActivityKind { Drive, Charge }

/**
 * One fully projected activity-feed row — the native analogue of a single web `activityItems[]` entry.
 * Pure data (no Compose types) so the projection is unit-tested without a UI host; the composable maps
 * [kind] to its glyph + accent and formats [timeMillis] to the relative "x ago" label at render time.
 */
data class ActivityRow(
    val kind: ActivityKind,
    val title: String,
    val subtitle: String,
    val timeMillis: Long,
)

/** The battery-percent area series — reversed [values] (web `.reverse()`) aligned to their [labels]. */
data class BatteryTrendSeries(
    val values: List<Double>,
    val labels: List<String>,
)

/**
 * The localized words the projection folds into the activity-row titles — the web `t('activity.drive')` /
 * `t('activity.charged')` microcopy. The composable resolves these from the i18n catalog (P1/S10); tests
 * pass deterministic instances.
 */
data class RecentActivityStrings(
    val driveWord: String,
    val chargedWord: String,
)

/**
 * The display-boundary formatters the projection folds into its text — the native binding of the web
 * `useFormatting`/`useUnits` hooks. [formatDistance] formats SI metres, [formatEnergy] SI watt-hours,
 * [formatCurrency] a money amount, [formatInteger] a grouped whole number (web `fmtInt`), and
 * [formatEfficiency] the most-efficient Wh/km value (web `fmtInt(toEfficiencyDisplay(x)) + unit`). Injecting
 * them keeps the projection locale/unit-deterministic under test; the composable supplies the real ones.
 */
data class RecentActivityFormatters(
    val formatDistance: (meters: Double) -> String,
    val formatEnergy: (wattHours: Double) -> String,
    val formatCurrency: (amount: Double) -> String,
    val formatInteger: (value: Double) -> String,
    val formatEfficiency: (whPerKm: Double) -> String,
)

/**
 * The fully projected, render-ready surface state — pure data so the projection is unit-tested without a UI
 * host. The composable renders [activityRows] in the feed (or the empty state when [hasActivity] is false),
 * the ([batteryValues], [batteryLabels]) area series when [hasBatteryTrend], the four stat strings, and the
 * most-efficient callout when [mostEfficientName] is non-null. [isEmpty] is the web "nothing at all yet"
 * case (no rows, no usable trend, no analytics) the host can surface as the empty phase.
 */
data class RecentActivityProjectionResult(
    val activityRows: List<ActivityRow>,
    val hasActivity: Boolean,
    val batteryValues: List<Double>,
    val batteryLabels: List<String>,
    val hasBatteryTrend: Boolean,
    val totalDrivesText: String,
    val totalChargesText: String,
    val totalCostText: String,
    val co2SavedText: String,
    val mostEfficientName: String?,
    val mostEfficientEfficiencyText: String?,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the derivations the web component runs
 * before returning JSX. Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object RecentActivityProjection {
    /**
     * Merges [drives] + [charges] into one feed, newest first, capped at [limit] — the web
     * `activityItems` build (`forEach` push of each kind, `sort((a, b) => b.time - a.time)`, `slice(0, 8)`).
     * Each row's title/subtitle reproduce the matching web template via the injected [formatters] +
     * [strings]; the sort is stable so equal timestamps keep drives-before-charges insertion order.
     */
    fun activityRows(
        drives: List<RecentActivityDrive>,
        charges: List<RecentActivityCharge>,
        formatters: RecentActivityFormatters,
        strings: RecentActivityStrings,
        limit: Int = ACTIVITY_FEED_LIMIT,
    ): List<ActivityRow> {
        val rows = ArrayList<ActivityRow>(drives.size + charges.size)
        drives.forEach { drive ->
            rows +=
                ActivityRow(
                    kind = ActivityKind.Drive,
                    title = formatters.formatDistance(drive.distanceM) + " " + strings.driveWord,
                    subtitle = driveSubtitle(drive),
                    timeMillis = drive.startedAtMillis,
                )
        }
        charges.forEach { charge ->
            rows +=
                ActivityRow(
                    kind = ActivityKind.Charge,
                    title = formatters.formatEnergy(charge.totalEnergyAddedWh) + " " + strings.chargedWord,
                    subtitle = chargeSubtitle(charge, formatters.formatCurrency),
                    timeMillis = charge.startedAtMillis,
                )
        }
        return rows
            .sortedByDescending { it.timeMillis }
            .take(limit)
    }

    /**
     * The reversed battery-percent series over [drives] — the web
     * `recentDrives.map((d, i) => ({ i, v: d.end_soc_pct ?? 50 })).reverse()`. Each value defaults to
     * [BATTERY_TREND_DEFAULT_SOC] when the drive has no end SoC, and the labels are the original indices
     * reversed alongside the values so the chart's x-axis and the line stay aligned.
     */
    fun batteryTrend(drives: List<RecentActivityDrive>): BatteryTrendSeries {
        val values = drives.map { it.endSocPct ?: BATTERY_TREND_DEFAULT_SOC }.reversed()
        val labels = drives.indices.map(Int::toString).reversed()
        return BatteryTrendSeries(values = values, labels = labels)
    }

    /** The CO2-saved estimate in kilograms — the web `(total_energy_kwh ?? 0) * 0.42`. */
    fun co2SavedKg(totalEnergyKwh: Double): Double = totalEnergyKwh * CO2_KG_PER_KWH

    /**
     * Projects [data] into the render-ready [RecentActivityProjectionResult]: merges the feed, builds the
     * reversed trend, formats the four stat strings (counts verbatim like the web `${... ?? 0}`, cost via
     * the currency formatter, CO2 via the integer formatter + " kg"), and resolves the most-efficient
     * callout. A `null`/empty payload projects as [RecentActivityProjectionResult.isEmpty].
     */
    fun project(
        data: RecentActivityData?,
        formatters: RecentActivityFormatters,
        strings: RecentActivityStrings,
        limit: Int = ACTIVITY_FEED_LIMIT,
    ): RecentActivityProjectionResult {
        val drives = data?.drives.orEmpty()
        val charges = data?.charges.orEmpty()
        val analytics = data?.analytics
        val rows = activityRows(drives, charges, formatters, strings, limit)
        val trend = batteryTrend(drives)
        val co2 = co2SavedKg(analytics?.totalEnergyKwh ?: 0.0)
        val mostEfficient = analytics?.mostEfficient
        return RecentActivityProjectionResult(
            activityRows = rows,
            hasActivity = rows.isNotEmpty(),
            batteryValues = trend.values,
            batteryLabels = trend.labels,
            hasBatteryTrend = trend.values.size > 1,
            totalDrivesText = (analytics?.totalDrives ?: 0L).toString(),
            totalChargesText = (analytics?.totalChargingSessions ?: 0L).toString(),
            totalCostText = formatters.formatCurrency(analytics?.totalCost ?: 0.0),
            co2SavedText = formatters.formatInteger(co2) + CO2_UNIT_SUFFIX,
            mostEfficientName = mostEfficient?.name,
            mostEfficientEfficiencyText = mostEfficient?.let { formatters.formatEfficiency(it.efficiencyWhPerKm) },
            isEmpty = rows.isEmpty() && trend.values.size <= 1 && analytics == null,
        )
    }

    /** The drive subtitle — web `${h}h ${m}m · ${start}% → ${end}%`. */
    private fun driveSubtitle(drive: RecentActivityDrive): String {
        val seconds = drive.durationS.coerceAtLeast(0)
        val hours = seconds / SECONDS_PER_HOUR
        val minutes = (seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE
        val duration = "$hours$HOUR_UNIT $minutes$MINUTE_UNIT"
        return duration + DOT_SEPARATOR + socRange(drive.startSocPct, drive.endSocPct)
    }

    /** The charge subtitle — web `${start}% → ${end}%${cost ? ` · ${formatCurrency(cost, 2)}` : ''}`. */
    private fun chargeSubtitle(
        charge: RecentActivityCharge,
        formatCurrency: (Double) -> String,
    ): String {
        val range = socRange(charge.startSocPct, charge.endSocPct)
        val cost = charge.cost ?: return range
        return range + DOT_SEPARATOR + formatCurrency(cost)
    }

    /** A `start% → end%` range with the web `?? '?'` sentinel for a missing value. */
    private fun socRange(
        start: Double?,
        end: Double?,
    ): String = socText(start) + PERCENT_SIGN + SOC_ARROW + socText(end) + PERCENT_SIGN

    /** A single state-of-charge value: whole numbers print without a fraction, else the raw value (web `${soc}`). */
    private fun socText(pct: Double?): String =
        when {
            pct == null -> SOC_UNKNOWN
            pct.isFinite() && pct == floor(pct) -> pct.toLong().toString()
            else -> pct.toString()
        }
}

/** A relative timestamp bucket — the native classification of the web `formatTimeAgo` branches. */
sealed interface RelativeActivityTime {
    /** Less than a minute ago — web `'Just now'`. */
    data object JustNow : RelativeActivityTime

    /** [value] whole minutes ago — web `${mins}m ago`. */
    data class MinutesAgo(
        val value: Int,
    ) : RelativeActivityTime

    /** [value] whole hours ago — web `${hrs}h ago`. */
    data class HoursAgo(
        val value: Int,
    ) : RelativeActivityTime

    /** [value] whole days ago (under a week) — web `${days}d ago`. */
    data class DaysAgo(
        val value: Int,
    ) : RelativeActivityTime

    /** A week or more ago — web falls back to the absolute short date (`formatDateShort`). */
    data class On(
        val epochMillis: Long,
    ) : RelativeActivityTime
}

/**
 * Tolerant relative-time helper — the native analogue of the web `formatTimeAgo`. [relative] is pure (no
 * clock, no locale) so it is unit-tested deterministically; [formatAbsolute] formats the week-or-older
 * fallback as a localized medium date (the native `formatDateShort`). The composable renders the under-a-week
 * buckets through the shared `freshness.*` i18n strings so the labels carry no English literal.
 */
object RecentActivityTimeFormatting {
    /**
     * Buckets the gap between [eventMillis] and [nowMillis] exactly as the web `formatTimeAgo`: under a
     * minute is [RelativeActivityTime.JustNow], under an hour is whole minutes, under a day is whole hours,
     * under a week is whole days, and a week or more falls back to the absolute date. A future timestamp
     * (negative gap) is treated as just now, matching the web `Math.floor(diff / 60000) < 1` guard.
     */
    fun relative(
        eventMillis: Long,
        nowMillis: Long,
    ): RelativeActivityTime {
        val diffMillis = nowMillis - eventMillis
        val minutes = diffMillis / MILLIS_PER_MINUTE
        val hours = minutes / MINUTES_PER_HOUR
        val days = hours / HOURS_PER_DAY
        return when {
            diffMillis < MILLIS_PER_MINUTE -> RelativeActivityTime.JustNow
            minutes < MINUTES_PER_HOUR -> RelativeActivityTime.MinutesAgo(minutes.toInt())
            hours < HOURS_PER_DAY -> RelativeActivityTime.HoursAgo(hours.toInt())
            days < DAYS_PER_WEEK -> RelativeActivityTime.DaysAgo(days.toInt())
            else -> RelativeActivityTime.On(eventMillis)
        }
    }

    /** Formats [epochMillis] as a localized medium date in [zone] — the native `formatDateShort`. */
    fun formatAbsolute(
        epochMillis: Long,
        zone: ZoneId,
        locale: Locale,
    ): String =
        DateTimeFormatter
            .ofLocalizedDate(FormatStyle.MEDIUM)
            .withLocale(locale)
            .withZone(zone)
            .format(Instant.ofEpochMilli(epochMillis))
}

/**
 * The currency + precision + locale this surface formats money with — the native binding of the web
 * `useFormatting`/`useSettings` currency derivation. Resolved from one `/settings` document at the Compose
 * boundary; the "$", 2-dp, en-US defaults apply before settings load (the web cold-start defaults).
 */
data class RecentActivityDisplay(
    val currencySymbol: String,
    val precision: Int,
    val locale: Locale,
) {
    companion object {
        /** The defaults applied before settings load. */
        val DEFAULT: RecentActivityDisplay = from(null)

        /** Resolves the currency symbol + precision + locale from one `/settings` document. */
        fun from(settings: JsonElement?): RecentActivityDisplay {
            val unitPref = UnitPreferences.fromSettings(settings)
            val obj = settings as? JsonObject
            val rawSymbol = (obj?.get(KEY_CURRENCY_SYMBOL) as? JsonPrimitive)?.contentOrNull
            return RecentActivityDisplay(
                currencySymbol = if (!rawSymbol.isNullOrBlank()) rawSymbol else DEFAULT_CURRENCY,
                precision = unitPref.precision ?: DEFAULT_PRECISION,
                locale = Locale.forLanguageTag(unitPref.locale?.takeIf { it.isNotBlank() } ?: DEFAULT_LOCALE_TAG),
            )
        }
    }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [RecentActivityRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it
 * from its first-composition effect.
 */
fun recordRecentActivityOpened(logger: Logger) {
    logger.info(VIEW_OPENED_EVENT, mapOf(SURFACE_KEY to RecentActivityRegistration.SLUG))
}
