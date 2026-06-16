// Pure, framework-free model + projections for the VampireDrainPage battery surface — the native analogue of everything
// the web page derives before composing its panels (web/src/features/battery/pages/VampireDrainPage.tsx, the
// phantom-energy-loss dashboard). No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it only
// references the framework-free UiState projection + shared-core Resource), so the composable stays a thin render layer
// and all of this is exercised off-device by the :android:testDebugUnitTest gate.
//
// The web page owns these concerns this file ports: (1) the decode of the single raw `/vampire-drain/stats` envelope the
// page reads (the four summary scalars + the `entries[]` session array + the `daily[]` parked-drain array) into typed,
// null-safe models (web optional-chaining → null-safe reads); (2) the display-formatting the web does inline via
// `fmtNumber` (drain rate at 2 dp, phantom-loss kWh at 1 dp, worst-session % at 1 dp, drain score whole) and the
// localized `formatDate` / `formatDateTime` axis + table labels; and (3) the drain-score → color tier the web's
// `scoreColor` derives (≥80 good, ≥50 fair, else poor) and the sentry on/off badge tone.
//
// Units note (unit-conversion.instructions): the `/vampire-drain/stats` route is a deprecated legacy endpoint whose wire
// fields are percentages (drain %, drain-rate %/hr, battery %) and an already-kWh phantom-loss figure — NOT SI watt-hours
// — so, exactly like the web, no SI scaling is applied here; percentages and the legacy kWh value render verbatim. The
// only user preference applied is the locale used for grouped-number + localized-date formatting (web `fmtNumber` /
// `formatDate` read the active i18n locale).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling BatteryHealthPage does.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.battery.vampiredrain

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** The em dash shown for a missing value (web `'—'`). */
private const val EM_DASH = "\u2014"

/** Drain rate renders with two fraction digits (web `fmtNumber(avg_drain_rate, 2)`). */
private const val RATE_DECIMALS = 2

/** Phantom-loss kWh + worst-session % render with one fraction digit (web `fmtNumber(x, 1)`). */
private const val ONE_DECIMAL = 1

/** Drain score + battery percentages render whole (web `fmtNumber(x, 0)`). */
private const val WHOLE_DECIMALS = 0

/** The drain-score ceiling the gauge sweeps against (web `RadialGauge max={100}`). */
const val DRAIN_SCORE_MAX: Double = 100.0

/** The score thresholds the web `scoreColor` switches on: ≥80 good, ≥50 fair, else poor. */
private const val SCORE_GOOD_MIN = 80.0
private const val SCORE_FAIR_MIN = 50.0

/** The per-row Loss-% badge thresholds the web switches on: >5 danger, >2 warning, else success. */
private const val LOSS_HIGH_MIN = 5.0
private const val LOSS_MEDIUM_MIN = 2.0

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `VampireDrainPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("vampireDrain", "/vampire-drain", …)`, so the host binds this surface to that destination (and its
 * `/vampire-drain` + `/charging/vampire-drain` deep links) without the nav module depending on it.
 */
object VampireDrainPageRegistration {
    /** The navigation destination id (Destinations.kt `page("vampireDrain", "/vampire-drain", …)`). */
    const val ROUTE_ID: String = "vampireDrain"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/vampire-drain"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "VampireDrainPage"
}

/**
 * The drain-score health tier the gauge + score panel color by (web `scoreColor`: ≥80 → good/green, ≥50 → fair/amber,
 * else → poor/red). Kept as a framework-free enum so the threshold logic is unit-tested off-device; the render layer
 * maps each tier to a theme-aware status color.
 */
enum class DrainScoreTier { Good, Fair, Poor }

/** Maps a drain [score] to its [DrainScoreTier] (web `score >= 80 ? … : score >= 50 ? … : …`). */
fun drainScoreTier(score: Double): DrainScoreTier =
    when {
        score >= SCORE_GOOD_MIN -> DrainScoreTier.Good
        score >= SCORE_FAIR_MIN -> DrainScoreTier.Fair
        else -> DrainScoreTier.Poor
    }

/**
 * One decoded `/vampire-drain/stats` `entries[]` row — the native analogue of the web `VampireDrainEntry`. The
 * scalar fields are non-nullable with a `0` fallback (web reads them through `fmtNumber`, which renders `0` for an
 * absent value); [date] keeps its raw ISO string so the render layer localizes it.
 */
data class VampireDrainEntry(
    val id: Long,
    val date: String,
    val startBattery: Double,
    val endBattery: Double,
    val drainPct: Double,
    val drainRatePctHr: Double,
    val durationHours: Double,
    val energyLostKwh: Double,
    val sentryActive: Boolean,
)

/** One decoded `daily[]` parked-drain row — the native analogue of the web `daily` array element. */
data class VampireDrainDaily(
    val date: String,
    val drainPct: Double,
    val hoursParked: Double,
)

/**
 * Stable sort-column keys for the Drain-Sessions table (web `Column.key`). Kept as constants so the column
 * definitions, the sort logic, and the unit test all agree on one identifier per column.
 */
object VampireSortKey {
    const val DATE = "date"
    const val DURATION = "duration_hours"
    const val START = "start_battery"
    const val END = "end_battery"
    const val LOSS = "drain_pct"
    const val RATE = "drain_rate_pct_hr"
    const val SENTRY = "sentry_active"
}

/**
 * Orders the drain-session [entries] by the active column [key] (one of [VampireSortKey]) and direction — the native
 * analogue of the web `useSortToggle` + `sortFn`. An unknown / null key leaves the order untouched (web's unsorted
 * fallback); [descending] reverses the natural ascending order. Pure + framework-free so it runs in the JVM gate.
 */
fun sortVampireEntries(
    entries: List<VampireDrainEntry>,
    key: String?,
    descending: Boolean,
): List<VampireDrainEntry> {
    val comparator: Comparator<VampireDrainEntry> =
        when (key) {
            VampireSortKey.DATE -> compareBy { it.date }
            VampireSortKey.DURATION -> compareBy { it.durationHours }
            VampireSortKey.START -> compareBy { it.startBattery }
            VampireSortKey.END -> compareBy { it.endBattery }
            VampireSortKey.LOSS -> compareBy { it.drainPct }
            VampireSortKey.RATE -> compareBy { it.drainRatePctHr }
            VampireSortKey.SENTRY -> compareBy { it.sentryActive }
            else -> return entries
        }
    val sorted = entries.sortedWith(comparator)
    return if (descending) sorted.asReversed() else sorted
}

/** The per-row Loss-% badge tier (web `drain_pct > 5 ? 'danger' : > 2 ? 'warning' : 'success'`). */
enum class DrainLossTier { High, Medium, Low }

/** Maps a row's [drainPct] to its Loss-% badge tier (web `drain_pct > 5 … > 2 …`). */
fun drainLossTier(drainPct: Double): DrainLossTier =
    when {
        drainPct > LOSS_HIGH_MIN -> DrainLossTier.High
        drainPct > LOSS_MEDIUM_MIN -> DrainLossTier.Medium
        else -> DrainLossTier.Low
    }

/**
 * The decoded `/vampire-drain/stats` payload — the native analogue of the web `VampireDrainStats`: the four summary
 * scalars the header tiles + gauge read, the `entries[]` session list (the trend line + sessions table), and the
 * `daily[]` parked-drain list (the bar chart). Derived purely from the raw JSON so the projection is unit-testable.
 */
data class VampireDrainStats(
    val avgDrainRate: Double,
    val totalEnergyLost: Double,
    val worstDrainPct: Double,
    val drainScore: Double,
    val entries: List<VampireDrainEntry>,
    val daily: List<VampireDrainDaily>,
) {
    /** True whenever any renderable figure exists — drives whether the page shows content vs a first-load loader. */
    val hasData: Boolean
        get() = entries.isNotEmpty() || daily.isNotEmpty() || avgDrainRate != 0.0 || totalEnergyLost != 0.0 ||
            worstDrainPct != 0.0 || drainScore != 0.0

    companion object {
        /** The all-zero stats, surfaced before the feed loads / when nothing is recorded. */
        val EMPTY: VampireDrainStats =
            VampireDrainStats(0.0, 0.0, 0.0, 0.0, emptyList(), emptyList())
    }
}

/**
 * The user's display preferences this surface needs — a deliberately narrow slice of the web `useFormatting`/`fmtNumber`
 * reads from the `/settings` document: only the [locale] used for grouped-number + localized-date formatting. The page
 * does no unit conversion (drain percentages + the legacy kWh figure render verbatim, exactly like the web `fmtNumber`).
 */
data class VampireDisplayPrefs(
    val locale: Locale,
) {
    /** Mean idle-drain rate as the web `${fmtNumber(avg_drain_rate, 2)}%/hr`. */
    fun rate(value: Double): String = "${ChartFormat.number(value, RATE_DECIMALS, locale)}%/hr"

    /** Phantom energy loss as the web `${fmtNumber(total_energy_lost, 1)} kWh`. */
    fun energyKwh(value: Double): String = "${ChartFormat.number(value, ONE_DECIMAL, locale)} kWh"

    /** A one-fraction-digit percentage as the web `${fmtNumber(x, 1)}%` (worst session, per-row loss). */
    fun percent1(value: Double): String = "${ChartFormat.number(value, ONE_DECIMAL, locale)}%"

    /** A whole percentage as the web `${fmtNumber(x, 0)}%` (start/end battery). */
    fun percent0(value: Double): String = "${ChartFormat.number(value, WHOLE_DECIMALS, locale)}%"

    /** The drain score as the web `${fmtNumber(drain_score, 0)}/100`. */
    fun score(value: Double): String = "${ChartFormat.number(value, WHOLE_DECIMALS, locale)}/100"

    /** A bare two-fraction-digit number (web `fmtNumber(drain_rate_pct_hr, 2)` table cell). */
    fun number2(value: Double): String = ChartFormat.number(value, RATE_DECIMALS, locale)

    /** Parked duration as the web `${fmtNumber(duration_hours, 1)}h`. */
    fun durationHours(value: Double): String = "${ChartFormat.number(value, ONE_DECIMAL, locale)}h"

    /** A localized short date for the chart x-axis (web `formatDate`); blank/unparseable → the raw value. */
    fun dateShort(raw: String): String = formatWith(raw, FormatStyle.MEDIUM, time = false) ?: raw

    /** A localized medium date + short time for the sessions table (web `formatDateTime`); blank → em-dash. */
    fun dateTime(raw: String?): String {
        if (raw.isNullOrBlank()) return EM_DASH
        return formatWith(raw, FormatStyle.MEDIUM, time = true) ?: EM_DASH
    }

    private fun formatWith(
        raw: String,
        dateStyle: FormatStyle,
        time: Boolean,
    ): String? {
        if (raw.isBlank()) return null
        val parsed = runCatching { OffsetDateTime.parse(raw) }.getOrNull() ?: return null
        val formatter =
            if (time) {
                DateTimeFormatter.ofLocalizedDateTime(dateStyle, FormatStyle.SHORT)
            } else {
                DateTimeFormatter.ofLocalizedDate(dateStyle)
            }
        return parsed.toLocalDateTime().format(formatter.withLocale(locale))
    }

    companion object {
        /** The en-US default used before settings load (matches the web default locale). */
        val DEFAULT: VampireDisplayPrefs = VampireDisplayPrefs(locale = Locale.US)

        /** Resolves the display preferences from the raw `/settings` document (web `useFormatting().locale`). */
        fun fromSettings(settings: JsonElement?): VampireDisplayPrefs {
            val locale =
                UnitPreferences.fromSettings(settings).locale
                    ?.takeIf { it.isNotBlank() }
                    ?.let(Locale::forLanguageTag)
                    ?: Locale.US
            return VampireDisplayPrefs(locale = locale)
        }
    }
}

/**
 * Decodes the raw `/vampire-drain/stats` [json] envelope (web `useVampireDrainStats`) into a [VampireDrainStats]. A
 * non-object payload (or an absent body) yields [VampireDrainStats.EMPTY] (web `!data` → em-dash / zero fallbacks), and
 * each scalar / array element collapses its missing fields to `0` / skips itself exactly like the web optional-chaining.
 */
fun parseVampireStats(json: JsonElement?): VampireDrainStats {
    val root = json as? JsonObject ?: return VampireDrainStats.EMPTY
    return VampireDrainStats(
        avgDrainRate = root.doubleField("avg_drain_rate"),
        totalEnergyLost = root.doubleField("total_energy_lost"),
        worstDrainPct = root.doubleField("worst_drain_pct"),
        drainScore = root.doubleField("drain_score"),
        entries = parseEntries(root["entries"]),
        daily = parseDaily(root["daily"]),
    )
}

/** Decodes the `entries[]` session array; a row missing its `date` is skipped so a table row is never date-less. */
private fun parseEntries(json: JsonElement?): List<VampireDrainEntry> {
    val array = json as? JsonArray ?: return emptyList()
    return array.mapIndexedNotNull { index, element ->
        val row = element as? JsonObject ?: return@mapIndexedNotNull null
        val date = row.stringField("date")?.takeIf { it.isNotBlank() } ?: return@mapIndexedNotNull null
        VampireDrainEntry(
            id = row.longField("id") ?: index.toLong(),
            date = date,
            startBattery = row.doubleField("start_battery"),
            endBattery = row.doubleField("end_battery"),
            drainPct = row.doubleField("drain_pct"),
            drainRatePctHr = row.doubleField("drain_rate_pct_hr"),
            durationHours = row.doubleField("duration_hours"),
            energyLostKwh = row.doubleField("energy_lost_kwh"),
            sentryActive = row.boolField("sentry_active"),
        )
    }
}

/** Decodes the `daily[]` parked-drain array; a row missing its `date` is skipped so a bar is never date-less. */
private fun parseDaily(json: JsonElement?): List<VampireDrainDaily> {
    val array = json as? JsonArray ?: return emptyList()
    return array.mapNotNull { element ->
        val row = element as? JsonObject ?: return@mapNotNull null
        val date = row.stringField("date")?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
        VampireDrainDaily(
            date = date,
            drainPct = row.doubleField("drain_pct"),
            hoursParked = row.doubleField("hours_parked"),
        )
    }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [VampireDrainPageRegistration.SLUG] (P1/S11). Kept
 * free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first composition.
 * Carries no vehicle id / drain figure / location payload.
 */
fun recordVampireDrainOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to VampireDrainPageRegistration.SLUG))
}

/**
 * Maps the value inside a cache-then-network [Resource], preserving its lifecycle case + freshness flags. The cached
 * value (present on `Loading`/`Error` for an instant cold start) and the fresh `Success` value are both transformed;
 * the `Throwable` and the `fetchedAt`/`stale` stamps pass through untouched. Pure, so the view-model's
 * `JsonElement → model` projection stays unit-testable off-device.
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

private fun JsonObject.doubleField(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private fun JsonObject.longField(key: String): Long? {
    val primitive = this[key] as? JsonPrimitive ?: return null
    return primitive.longOrNull ?: primitive.contentOrNull?.toLongOrNull()
}

private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun JsonObject.boolField(key: String): Boolean = (this[key] as? JsonPrimitive)?.booleanOrNull == true
