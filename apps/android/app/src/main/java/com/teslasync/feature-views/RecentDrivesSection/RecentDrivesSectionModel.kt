// Pure, framework-free model + projection for the RecentDrivesSection feature view — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/features/vehicles/components/vehicle-detail/RecentDrivesSection.tsx) plus the `durationStr` helper
// it imports from `./helpers`. No Compose, no Android framework, no HTTP: every declaration here is exercised
// off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web component is purely presentational — its parent (the vehicle-detail page) passes the resolved
// `drives: Drive[] | undefined` prop and it renders a `GlassPanel` titled with a Route icon + a "View all"
// link, then EITHER a paginated `DataTable` (Date / Distance / Duration / Battery) when there are drives OR a
// friendly `EmptyState`. It performs no fetching. This file owns the per-column `render` decisions that
// component makes: the localized full date+time (web `formatDateTime(start_ts)`), the unit-converted distance
// string (web `fmtNumber(convertDistanceFromSI(distance_m, distanceUnit))` + the unit label), the `Xh Ym` /
// `Ym` duration (web `durationStr(duration_s / 60)`), and the `start% → end%` battery range (web
// `start_soc_pct != null && end_soc_pct != null` guard, else the em-dash).
//
// SI on the wire, display at the boundary: a drive's distance is metres and its duration seconds exactly as
// the API serves them (Phase-48 SI-canonical). The only place metres become km/mi is the shared
// `convertDistanceFromSI` converter (reused via `formatDistance`), applied here so the projection is the
// single, testable display boundary — the same function the web `convertDistanceFromSI(..., unitPrefs.distance)`
// call uses. The two web hooks map to shared layers: `useTranslation` -> the i18n catalog (strings passed in
// already-localized through [RecentDrivesStrings]) and `useUnits` -> the resolved
// [io.teslasync.android.data.UnitFormatter] preferences.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/RecentDrivesSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.recentdrivessection

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.formatDistance
import java.math.RoundingMode
import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.floor

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object RecentDrivesSectionRegistration {
    /** Stable surface id. */
    const val ID: String = "recent-drives-section"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "RecentDrivesSection"
}

/** Em dash shown when a value is absent — the web Battery column `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/** Trailing percent sign on each state-of-charge value — the web `${soc}%`. */
internal const val PERCENT_SIGN: String = "%"

/** Spaced right arrow between the start and end SoC — the web `% → %`. */
internal const val SOC_ARROW: String = " \u2192 "

/** Hours unit letter in a duration — the web `${h}h`. */
internal const val HOUR_UNIT: String = "h"

/** Minutes unit letter in a duration — the web `${m}m`. */
internal const val MINUTE_UNIT: String = "m"

/**
 * The web `fmtNumber` global decimal precision default (`_globalPrecision` starts at 2). The Distance column
 * uses `fmtNumber` with no per-call override, so it formats with the user's `decimal_precision` setting and
 * falls back to 2 — NOT the shared `formatDistance` per-quantity default of 1.
 */
internal const val WEB_DEFAULT_PRECISION: Int = 2

/** Seconds in a minute / minutes in an hour — the web `duration_s / 60` then `durationStr` `/ 60`, `% 60`. */
private const val SECONDS_PER_MINUTE: Double = 60.0
private const val MINUTES_PER_HOUR: Double = 60.0

/** The web `DataTable` stable column keys (web `Column.key`); shared by the header and the cells. */
const val COL_DATE: String = "date"
const val COL_DISTANCE: String = "distance"
const val COL_DURATION: String = "duration"
const val COL_BATTERY: String = "battery"

/**
 * Client-side page size — the web `<DataTable pagination />` `PaginationConfig.defaultPageSize` default of 25
 * (the component paginates the full `drives` list in-memory, `data.slice((page-1)*size, page*size)`).
 */
const val RECENT_DRIVES_PAGE_SIZE: Int = 25

private const val DEFAULT_LOCALE_TAG: String = "en-US"

private const val VIEW_OPENED_EVENT: String = "view.opened"
private const val SURFACE_KEY: String = "surface"

/**
 * The subset of a web `Drive` this surface reads — SI on the wire, converted at the display boundary.
 *
 * @property id backs the row key (web `keyExtractor={(d) => d.id}`).
 * @property startTs the drive start as an ISO-8601 UTC string (web `drive.start_ts`); the Date column.
 * @property distanceM the trip distance in SI metres (web `drive.distance_m`).
 * @property durationS the trip duration in SI seconds (web `drive.duration_s`).
 * @property startSocPct the 0-100 start battery percentage (web `drive.start_soc_pct`); nullable for the guard.
 * @property endSocPct the 0-100 end battery percentage (web `drive.end_soc_pct`); `null` ⇒ the em-dash row.
 */
data class RecentDrive(
    val id: Long,
    val startTs: String,
    val distanceM: Double,
    val durationS: Double,
    val startSocPct: Double?,
    val endSocPct: Double?,
)

/**
 * The user's display preferences this surface needs — the native mirror of the web `useUnits` distance unit
 * plus the `fmtNumber` global locale + precision. Built from the resolved [UnitPref] (the shared
 * `UnitFormatter` preferences) so the projection is locale/precision-deterministic and unit-tested.
 *
 * @property prefs the resolved unit preferences (carries the distance unit + locale used by [formatDistance]).
 * @property locale the resolved [Locale] the duration's residual-minute grouping uses (web `fmtInt`).
 * @property precision the Distance column fraction digits — the user's `decimal_precision` else
 *   [WEB_DEFAULT_PRECISION] (the web `fmtNumber` `_globalPrecision`).
 */
data class RecentDrivesDisplayPrefs(
    val prefs: UnitPref,
    val locale: Locale,
    val precision: Int,
) {
    companion object {
        /**
         * Derives the display prefs from the resolved [UnitPref]. The locale is the pref's BCP-47 tag (en-US
         * when blank) and the precision is the pref's `decimal_precision` else [WEB_DEFAULT_PRECISION],
         * reproducing the web `fmtNumber` `_globalPrecision` default of 2.
         */
        fun from(prefs: UnitPref): RecentDrivesDisplayPrefs =
            RecentDrivesDisplayPrefs(
                prefs = prefs,
                locale = resolveLocale(prefs.locale),
                precision = prefs.precision?.takeIf { it >= 0 } ?: WEB_DEFAULT_PRECISION,
            )
    }
}

/**
 * The already-localized strings the surface renders — the web `t(...)` calls the JSX resolves inline. The
 * composable builds this from `stringResource`; tests pass a deterministic instance. The column labels are
 * reused both as the [DataTable] headers and (with the cell values) as the per-row a11y announcement.
 */
data class RecentDrivesStrings(
    val title: String,
    val viewAll: String,
    val date: String,
    val distance: String,
    val duration: String,
    val battery: String,
    val empty: String,
)

/**
 * One fully projected, render-ready table row — the native analogue of a single web `data[]` entry after the
 * column `render` callbacks run. Pure data (no Compose types) so the projection is unit-tested without a UI
 * host. [announce] is the merged TalkBack summary the composable attaches to the row (label/value pairs).
 */
data class RecentDriveRow(
    val id: Long,
    val dateText: String,
    val distanceText: String,
    val durationText: String,
    val batteryText: String,
    val announce: String,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's per-column `render`
 * callbacks (date, unit-converted distance, `Xh Ym` duration, `start% → end%` battery). Stateless and
 * side-effect-free so it is fully covered by the off-device unit gate.
 */
object RecentDrivesProjection {
    /**
     * Projects each [drive] into a render-ready [RecentDriveRow]. [formatDate] formats `start_ts` (injected so
     * this function stays locale/zone-deterministic for tests; the composable supplies the platform formatter),
     * [prefs] drives the distance conversion + precision, and [strings] supplies the a11y labels.
     */
    fun rows(
        drives: List<RecentDrive>,
        prefs: RecentDrivesDisplayPrefs,
        strings: RecentDrivesStrings,
        formatDate: (startTs: String) -> String,
    ): List<RecentDriveRow> =
        drives.map { drive ->
            val dateText = formatDate(drive.startTs)
            val distanceText = distanceText(drive.distanceM, prefs)
            val durationText = durationStr(drive.durationS / SECONDS_PER_MINUTE, prefs.locale)
            val batteryText = batteryText(drive.startSocPct, drive.endSocPct)
            RecentDriveRow(
                id = drive.id,
                dateText = dateText,
                distanceText = distanceText,
                durationText = durationText,
                batteryText = batteryText,
                announce =
                    rowAnnouncement(
                        strings = strings,
                        dateText = dateText,
                        distanceText = distanceText,
                        durationText = durationText,
                        batteryText = batteryText,
                    ),
            )
        }

    /**
     * The Distance cell — the web `${fmtNumber(convertDistanceFromSI(distance_m ?? 0, distanceUnit))}
     * ${distanceUnit}`. Reuses the golden-tested shared [formatDistance] (which is exactly
     * `fmtNumber(convertDistanceFromSI(value), digits) + " " + unit.label`) with the resolved
     * [RecentDrivesDisplayPrefs.precision]; a non-finite metre value coerces to 0 (the web `?? 0` / `safeNumber`).
     */
    fun distanceText(
        meters: Double,
        prefs: RecentDrivesDisplayPrefs,
    ): String {
        val safeMeters = if (meters.isFinite()) meters else 0.0
        return formatDistance(safeMeters, prefs.prefs, prefs.precision)
    }

    /**
     * The Duration cell — a verbatim port of the web `durationStr(minutes)` helper: `h = floor(minutes / 60)`,
     * `m = fmtInt(minutes % 60)` (the residual minutes rounded half-away-from-zero with grouping), rendered
     * `${h}h ${m}m` when there is at least an hour, else `${m}m`. The composable passes `duration_s / 60` for
     * [minutes], matching the web `durationStr((duration_s ?? 0) / 60)` call.
     */
    fun durationStr(
        minutes: Double,
        locale: Locale,
    ): String {
        val safeMinutes = if (minutes.isFinite()) minutes else 0.0
        val hours = floor(safeMinutes / MINUTES_PER_HOUR).toLong()
        val residual = fmtInt(safeMinutes % MINUTES_PER_HOUR, locale)
        return if (hours > 0) "$hours$HOUR_UNIT $residual$MINUTE_UNIT" else "$residual$MINUTE_UNIT"
    }

    /**
     * The Battery cell — the web `start_soc_pct != null && end_soc_pct != null ? `${start}% → ${end}%` : '—'`.
     * Each value renders as the raw number (JS `${soc}`: an integral percent prints without a decimal point).
     */
    fun batteryText(
        startSocPct: Double?,
        endSocPct: Double?,
    ): String {
        if (startSocPct == null || endSocPct == null) return EM_DASH
        return socText(startSocPct) + PERCENT_SIGN + SOC_ARROW + socText(endSocPct) + PERCENT_SIGN
    }

    /** A single SoC value: a whole number prints without a fraction, else the raw value (web `${soc}`). */
    private fun socText(pct: Double): String = if (pct.isFinite() && pct == floor(pct)) pct.toLong().toString() else pct.toString()

    /**
     * The merged per-row TalkBack summary — comma-joined `label, value` pairs over the four columns, so a
     * single focus on the row announces the whole drive (the web table reads each cell; native merges them).
     */
    fun rowAnnouncement(
        strings: RecentDrivesStrings,
        dateText: String,
        distanceText: String,
        durationText: String,
        batteryText: String,
    ): String =
        listOf(
            "${strings.date}, $dateText",
            "${strings.distance}, $distanceText",
            "${strings.duration}, $durationText",
            "${strings.battery}, $batteryText",
        ).joinToString(separator = ", ")

    /**
     * Web `fmtInt(value)` parity: `value.toLocaleString(locale, { minimum/maximumFractionDigits: 0 })` —
     * grouping-aware integer formatting with ECMAScript `halfExpand` rounding ([RoundingMode.HALF_UP]). A
     * non-finite value coerces to 0 (the web `safeNumber`).
     */
    private fun fmtInt(
        value: Double,
        locale: Locale,
    ): String {
        val format = NumberFormat.getNumberInstance(locale)
        format.maximumFractionDigits = 0
        format.minimumFractionDigits = 0
        format.roundingMode = RoundingMode.HALF_UP
        return format.format(if (value.isFinite()) value else 0.0)
    }
}

/**
 * Render-only timestamp formatting — the native counterpart of the web `formatDateTime(start_ts)` Date cell:
 * a localized "medium date, short time" (web `{ year, month: 'short', day, hour, minute }`) in the caller's
 * [ZoneId]. Pure (java.time only) so it is unit-tested deterministically; a blank or unparseable input yields
 * [EM_DASH], matching the web invalid-date guard (`isNaN(d.getTime())` → `'—'`).
 */
object RecentDrivesTimeFormatting {
    fun format(
        startTs: String,
        zone: ZoneId,
        locale: Locale,
    ): String {
        val instant = parseInstant(startTs) ?: return EM_DASH
        return DateTimeFormatter
            .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withLocale(locale)
            .withZone(zone)
            .format(instant)
    }
}

// Tolerant decode chain: an RFC-3339 instant ("…Z"), then an offset date-time, then a zoneless local
// date-time treated as UTC. The first that parses wins; none parsing yields null (→ the em-dash guard).
private val INSTANT_PARSERS: List<(String) -> Instant?> =
    listOf(
        { raw -> tryParseInstant { Instant.parse(raw) } },
        { raw -> tryParseInstant { OffsetDateTime.parse(raw).toInstant() } },
        { raw -> tryParseInstant { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC) } },
    )

private fun parseInstant(raw: String): Instant? = if (raw.isBlank()) null else INSTANT_PARSERS.firstNotNullOfOrNull { it(raw) }

private fun tryParseInstant(block: () -> Instant): Instant? =
    try {
        block()
    } catch (_: DateTimeParseException) {
        null
    }

/** Resolves a BCP-47 [tag] (the user's `useUnits` locale) to a [Locale], falling back to en-US when blank. */
fun resolveLocale(tag: String?): Locale = Locale.forLanguageTag(tag?.takeIf { it.isNotBlank() } ?: DEFAULT_LOCALE_TAG)

/**
 * Projects the web-parity `drives` prop onto a lifecycle [UiState] — the native equivalent of the web
 * `drives && drives.length > 0 ? <DataTable/> : <EmptyState/>` ternary, extended with the host's loading
 * phase: [loading] → [UiPhase.Loading]; a `null`/empty list → [UiPhase.Empty] (the web EmptyState branch);
 * otherwise [UiPhase.Content]. There is no fetch behind this overload, so it never carries an error/stale flag.
 */
fun projectUiState(
    drives: List<RecentDrive>?,
    loading: Boolean,
): UiState<List<RecentDrive>> {
    val resolved = drives.orEmpty()
    val phase =
        when {
            loading -> UiPhase.Loading
            resolved.isEmpty() -> UiPhase.Empty
            else -> UiPhase.Content
        }
    return UiState(phase = phase, data = resolved)
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [RecentDrivesSectionRegistration.SLUG]
 * (P1/S11). Carries only the slug — never a distance, duration, or SoC figure — so a diagnostics line can
 * never leak the drive history. Kept free of Compose so it is unit-tested with a recording [Logger]; the
 * composable calls it from its first-composition effect.
 */
fun recordRecentDrivesSectionOpened(logger: Logger) {
    logger.info(VIEW_OPENED_EVENT, mapOf(SURFACE_KEY to RecentDrivesSectionRegistration.SLUG))
}
