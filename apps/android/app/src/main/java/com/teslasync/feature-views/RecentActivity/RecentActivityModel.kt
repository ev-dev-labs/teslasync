// Pure, framework-free model + projection for the `RecentActivity` feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/vehicles/components/RecentActivity.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web component is purely presentational — its parent passes `drives` / `sessions` and it composes two
// side-by-side `GlassPanel`s: "Recent Drives" (the first five drives) and "Recent Charges" (the first five
// charging sessions). Each row shows the distance / energy through an `AnimatedNumber`, the start timestamp
// through `<TimeStamp>`, the duration through an `InlineMetric`, and an optional `start% → end%` SoC range.
// This file owns exactly those derivations so the composable stays declarative: the per-row projections
// ([RecentActivityProjection.driveRows] / [RecentActivityProjection.chargeRows]), the `Xh Ym` duration
// labels, and the SoC-range text. The two web hooks map to shared layers: `useTranslation` -> the i18n
// catalog and `useUnits` -> the resolved [io.teslasync.android.data.UnitFormatter] preferences.
//
// SI on the wire, display at the boundary: a drive's distance is metres and a charge's energy is watt-hours
// exactly as the API serves them (Phase-48 SI-canonical). The only place they become km/mi or kWh is the
// shared `convertDistanceFromSI` / `convertEnergyFromSI` converters, applied here so the projection is the
// single, testable display boundary — the same functions the web `convertDistanceFromSI(..., unitPrefs.distance)`
// and `convertEnergyFromSI(..., 'kWh')` calls use. Charge energy is always shown in kWh, matching the web's
// literal `'kWh'` target.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/RecentActivity — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.recentactivity

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertEnergyFromSI
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.floor

/** Maximum rows each panel renders — the web `drives.slice(0, 5)` / `sessions.slice(0, 5)`. */
internal const val RECENT_ROW_LIMIT: Int = 5

/** Fraction digits on the distance / energy `AnimatedNumber` — the web `decimals={1}`. */
internal const val VALUE_DECIMALS: Int = 1

/** Trailing unit on a charge value — the web `suffix=" kWh"` (energy is always shown in kWh). */
internal const val KWH_SUFFIX: String = " kWh"

/** Trailing percent sign on each state-of-charge value — the web `${soc}%`. */
internal const val PERCENT_SIGN: String = "%"

/** Spaced right arrow between the start and end SoC — the web `→`. */
internal const val SOC_ARROW: String = " \u2192 "

/** Hours unit letter in a duration — the web `${h}h`. */
internal const val HOUR_UNIT: String = "h"

/** Minutes unit letter in a duration — the web `${m}m`. */
internal const val MINUTE_UNIT: String = "m"

private const val DISTANCE_SUFFIX_SEPARATOR: String = " "

private const val SECONDS_PER_HOUR: Long = 3_600L
private const val SECONDS_PER_MINUTE: Long = 60L
private const val MINUTES_PER_HOUR: Long = 60L

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
 * The subset of a drive this surface reads — the native mirror of the web `Drive` fields a "Recent Drives"
 * row touches. [distanceM] is SI metres; [durationS] SI seconds; [startSocPct]/[endSocPct] are 0-100 battery
 * percentages (nullable, the web `start_soc_pct != null && end_soc_pct != null` guard); [id] backs the
 * row's `to={`/drives/${id}`}` navigation; [startTsMillis] is the epoch-millisecond `start_ts`.
 */
data class RecentActivityDrive(
    val id: Long,
    val distanceM: Double,
    val durationS: Long,
    val startSocPct: Double?,
    val endSocPct: Double?,
    val startTsMillis: Long,
)

/**
 * The subset of a charging session this surface reads — the native mirror of the web `ChargingSession`
 * fields a "Recent Charges" row touches. [totalEnergyAddedWh] is SI watt-hours; [durationMin] is the web
 * `duration_min` minutes; [startSocPct]/[endSocPct] are 0-100 percentages (the web shows the range when
 * `end_soc_pct != null`); [id] backs the `to={`/charging/${id}`}` navigation; [startTsMillis] is the
 * epoch-millisecond `start_ts`.
 */
data class RecentActivityCharge(
    val id: Long,
    val totalEnergyAddedWh: Double,
    val durationMin: Long,
    val startSocPct: Double?,
    val endSocPct: Double?,
    val startTsMillis: Long,
)

/**
 * The full payload the surface renders — the native grouping of the web component's two props (`drives`,
 * `sessions`) into one value the host carries through the [io.teslasync.android.data.UiState]. Defaulted to
 * empty so the loading / empty lifecycle states are expressible without a payload.
 */
data class RecentActivityData(
    val drives: List<RecentActivityDrive> = emptyList(),
    val sessions: List<RecentActivityCharge> = emptyList(),
)

/**
 * One fully projected "Recent Drives" row — pure data (no Compose types) so the projection is unit-tested
 * without a UI host. [distanceValue] is the SI metres already converted to the user's display unit (the web
 * `convertDistanceFromSI(distance_m ?? 0, unitPrefs.distance)`) and [distanceSuffix] the matching ` km`/` mi`
 * the `AnimatedNumber` appends; [durationLabel] is the `Xh Ym` string; [socRange] is the `start% → end%`
 * text or `null` when either endpoint is absent; [startTsMillis] feeds the timestamp formatter at render.
 */
data class DriveRow(
    val id: Long,
    val distanceValue: Double,
    val distanceSuffix: String,
    val durationLabel: String,
    val socRange: String?,
    val startTsMillis: Long,
)

/**
 * One fully projected "Recent Charges" row — pure data so the projection is unit-tested without a UI host.
 * [energyValue] is the SI watt-hours converted to kWh (the web `convertEnergyFromSI(total_energy_added_wh,
 * 'kWh')`) and [energySuffix] the literal ` kWh`; [durationLabel] is the `Xh Ym` string; [socRange] is the
 * `start% → end%` text or `null` when the end SoC is absent; [startTsMillis] feeds the timestamp formatter.
 */
data class ChargeRow(
    val id: Long,
    val energyValue: Double,
    val energySuffix: String,
    val durationLabel: String,
    val socRange: String?,
    val startTsMillis: Long,
)

/**
 * The pure projection the composable renders — the native mirror of the derivations the web component runs
 * before returning JSX. Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object RecentActivityProjection {
    /**
     * The first [limit] drives projected into render-ready rows — the web `drives.slice(0, 5).map(...)`. The
     * distance is converted from SI metres to [distanceUnit] (the web `unitPrefs.distance`) so the row's
     * `AnimatedNumber` count-up and unit suffix match the web; the duration becomes `Xh Ym`; the SoC range is
     * present only when both endpoints are (the web `start_soc_pct != null && end_soc_pct != null`).
     */
    fun driveRows(
        drives: List<RecentActivityDrive>,
        distanceUnit: DistanceUnitPref,
        limit: Int = RECENT_ROW_LIMIT,
    ): List<DriveRow> =
        drives.take(limit).map { drive ->
            DriveRow(
                id = drive.id,
                distanceValue = convertDistanceFromSI(drive.distanceM, distanceUnit),
                distanceSuffix = DISTANCE_SUFFIX_SEPARATOR + distanceUnit.label,
                durationLabel = durationFromSeconds(drive.durationS),
                socRange = socRange(drive.startSocPct, drive.endSocPct),
                startTsMillis = drive.startTsMillis,
            )
        }

    /**
     * The first [limit] charging sessions projected into render-ready rows — the web
     * `sessions.slice(0, 5).map(...)`. The energy is converted from SI watt-hours to kWh (the web's literal
     * `'kWh'` target, independent of the distance preference); the duration becomes `Xh Ym` from the web
     * `duration_min`; the SoC range is present only when the end SoC is (the web `end_soc_pct != null`).
     */
    fun chargeRows(
        sessions: List<RecentActivityCharge>,
        limit: Int = RECENT_ROW_LIMIT,
    ): List<ChargeRow> =
        sessions.take(limit).map { charge ->
            ChargeRow(
                id = charge.id,
                energyValue = convertEnergyFromSI(charge.totalEnergyAddedWh, EnergyUnitPref.KWH),
                energySuffix = KWH_SUFFIX,
                durationLabel = durationFromMinutes(charge.durationMin),
                socRange = socRange(charge.startSocPct, charge.endSocPct),
                startTsMillis = charge.startTsMillis,
            )
        }

    /** A drive's `Xh Ym` duration from SI [seconds] — the web `${floor(s/3600)}h ${fmtInt(floor((s%3600)/60))}m`. */
    fun durationFromSeconds(seconds: Long): String {
        val total = seconds.coerceAtLeast(0)
        val hours = total / SECONDS_PER_HOUR
        val minutes = (total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE
        return "$hours$HOUR_UNIT $minutes$MINUTE_UNIT"
    }

    /** A charge's `Xh Ym` duration from [minutes] — the web `${floor(min/60)}h ${fmtInt(min%60)}m`. */
    fun durationFromMinutes(minutes: Long): String {
        val total = minutes.coerceAtLeast(0)
        val hours = total / MINUTES_PER_HOUR
        val mins = total % MINUTES_PER_HOUR
        return "$hours$HOUR_UNIT $mins$MINUTE_UNIT"
    }

    /**
     * A `start% → end%` SoC range, or `null` when either endpoint is absent. Both web rows only render the
     * range when their endpoints are non-null (drives require both; a charge's start is type-guaranteed, so
     * its `end_soc_pct != null` guard is equivalent), so a single both-present check reproduces both.
     */
    fun socRange(
        start: Double?,
        end: Double?,
    ): String? {
        if (start == null || end == null) return null
        return socText(start) + PERCENT_SIGN + SOC_ARROW + socText(end) + PERCENT_SIGN
    }

    /** A single SoC value: whole numbers print without a fraction, else the raw value (web `${soc}`). */
    private fun socText(pct: Double): String = if (pct.isFinite() && pct == floor(pct)) pct.toLong().toString() else pct.toString()
}

/**
 * Render-only timestamp formatting — the native counterpart of the web `<TimeStamp value={start_ts} />`
 * body. Mirrors the sibling feature views (e.g. ChargingSessionCard): a localized "medium date, short time"
 * in the caller's [ZoneId]. Pure (java.time only) so it is unit-tested deterministically.
 */
object RecentActivityTimeFormatting {
    /** Formats [epochMillis] as a localized medium date + short time in [zone] for [locale]. */
    fun formatTimestamp(
        epochMillis: Long,
        zone: ZoneId,
        locale: Locale,
    ): String =
        DateTimeFormatter
            .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withLocale(locale)
            .withZone(zone)
            .format(Instant.ofEpochMilli(epochMillis))
}

/** Resolves a BCP-47 [tag] (the user's `useUnits` locale) to a [Locale], falling back to en-US when blank. */
fun resolveRecentActivityLocale(tag: String?): Locale = Locale.forLanguageTag(tag?.takeIf { it.isNotBlank() } ?: DEFAULT_LOCALE_TAG)

/** Whether the resolved payload has nothing to show in either panel — the web "both lists empty" case. */
fun isEmptyPayload(data: RecentActivityData): Boolean = data.drives.isEmpty() && data.sessions.isEmpty()

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [RecentActivityRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it
 * from its first-composition effect.
 */
fun recordRecentActivityOpened(logger: Logger) {
    logger.info(VIEW_OPENED_EVENT, mapOf(SURFACE_KEY to RecentActivityRegistration.SLUG))
}
