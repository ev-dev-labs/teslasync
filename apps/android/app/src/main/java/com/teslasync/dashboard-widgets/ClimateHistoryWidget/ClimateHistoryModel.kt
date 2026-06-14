// Pure, framework-free model + projection for the Climate History dashboard widget — the native analogue
// of everything the web component derives via `useMemo` before returning JSX
// (web/src/features/dashboard/widgets/ClimateHistoryWidget.tsx). No Compose, no Android framework, no
// HTTP: every type here is unit-tested off device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer. The history feed arrives as a raw SI JSON array (`GET /climate`,
// temperatures in °C), so this file owns the decode (web optional-chaining → null-safe reads), the
// timestamp + temperature reads (web `created_at ?? timestamp`, `inside_temp`/`outside_temp`), the
// timestamp filter + chronological sort (web `.filter(...).sort(...)`), and the SI→display temperature
// conversion at the render boundary (web `useUnits()` + `convertTempFromSI`) — the SI source is never
// stored converted (Phase-48 SI-canonical; ADR-013).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/ClimateHistoryWidget — the P3 prompt's allowed-files path) cannot form
// a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling ClimateStatusWidget /
// PowerFlowHistoryWidget do. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.climatehistory

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.units.convertTempFromSI
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Em dash shown for a missing reading — the web `'—'` fallback and the shared formatter's empty value. */
internal const val EM_DASH: String = "\u2014"

/** Stable series keys (web `Area name="inside"` / `name="outside"`); also the legend / a11y row keys. */
internal const val KEY_INSIDE: String = "inside"
internal const val KEY_OUTSIDE: String = "outside"

private const val FIELD_INSIDE_TEMP = "inside_temp"
private const val FIELD_OUTSIDE_TEMP = "outside_temp"
private const val FIELD_CREATED_AT = "created_at"
private const val FIELD_TIMESTAMP = "timestamp"

/** Temperatures render as whole degrees — the web `fmtInt` on the stat values + `fmt(v, 0)` on the Y axis. */
internal const val TEMP_DECIMALS: Int = 0

/** Full date-time tick pattern — the web `formatDateTime` (`month:short, day, year, 2-digit hour:minute`). */
private const val TIME_PATTERN = "MMM d, yyyy, hh:mm a"

/**
 * The widget's grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the `isCompact`
 * / `isWide` logic in the web source: compact (stats-only, no chart/title) is a single column or fewer
 * (web `size.cols <= 1`); wide (wider axis ticks) is three or more columns (web `size.cols >= 3`).
 */
data class ClimateHistorySize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column or fewer (web `isCompact = size.cols <= 1`): stats only, no chart or title. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    /** True at three or more columns (web `isWide = size.cols >= 3`): wider axis ticks. */
    val isWide: Boolean get() = cols >= WIDE_MIN_COLS

    private companion object {
        const val COMPACT_MAX_COLS = 1
        const val WIDE_MIN_COLS = 3
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/climate.ts (`climate-history`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web
 * grids stay in lockstep.
 */
object ClimateHistoryRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "climate-history"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "climate"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ClimateHistoryWidget"

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val defaultSize: ClimateHistorySize = ClimateHistorySize(cols = 2, rows = 4)

    /** Minimum footprint: 2 columns × 4 rows (web `minSize`). */
    val minSize: ClimateHistorySize = ClimateHistorySize(cols = 2, rows = 4)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize: ClimateHistorySize = ClimateHistorySize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: ClimateHistorySize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: ClimateHistorySize): ClimateHistorySize =
        ClimateHistorySize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * One decoded history row reduced to the three fields the web chart reads from each entry: the raw ISO
 * [timeIso] (web `entry.created_at ?? entry.timestamp`) and the two SI Celsius temperatures (web
 * `entry.insideTemp` / `entry.outsideTemp`, both nullable so a gap stays a gap — the web `connectNulls`).
 * Temperatures are kept in SI Celsius here; the SI→display conversion happens in [ClimateHistoryProjection]
 * at the render boundary, never on this stored value.
 */
data class ClimateSample(
    val timeIso: String,
    val insideC: Double?,
    val outsideC: Double?,
)

/**
 * The decoded climate-history snapshot the view-model projects — the native analogue of the web
 * component's `chartData` memo. [samples] is already filtered to rows carrying a timestamp and sorted
 * chronologically (web `.filter(...).sort(...)`). Pure data so the projection is unit-tested without a UI
 * host.
 */
data class ClimateHistorySnapshot(
    val samples: List<ClimateSample>,
) {
    /** Web `hasData = chartData.length > 0` — drives the chart/stats vs "No climate history" empty gate. */
    val hasData: Boolean get() = samples.isNotEmpty()

    companion object {
        /** The "nothing resolved" fallback (no vehicle / disabled query / empty history). */
        val EMPTY: ClimateHistorySnapshot = ClimateHistorySnapshot(samples = emptyList())

        /** A snapshot carrying the decoded, filtered + sorted history rows. */
        fun ofSamples(samples: List<ClimateSample>): ClimateHistorySnapshot = ClimateHistorySnapshot(samples = samples)
    }
}

/** One projected summary statistic for the header row — the native analogue of a web `ChartSummaryStat`. */
data class ClimateHistoryStat(
    val label: String,
    val value: String,
    val unit: String?,
)

/**
 * The localized strings the surface needs, resolved through the i18n facade (P1/S10) at the Compose
 * boundary and passed in so the projection stays framework-free and JVM-testable. They map to the
 * `widget.climateHistory.*` keys; [cabin] / [outside] name both the stat row and the two chart series.
 */
data class ClimateHistoryStrings(
    val title: String,
    val cabin: String,
    val outside: String,
    val noData: String,
)

/**
 * The fully projected, render-ready view of the climate history for one footprint — the native analogue
 * of everything the web component computes via `useMemo` (the `chartData` map, the `latestInside` /
 * `latestOutside` scans, and the compact/standard stat selection) before returning JSX. Pure data (no
 * Compose types) so the projection is unit-tested without a UI host.
 *
 * @property hasData whether any chart point resolved (web `hasData`); when false the surface shows its
 *   empty state instead of the stat row + chart.
 * @property xLabels the per-point display time labels (web `formatTime(time)`), in render order.
 * @property insideValues the SI→display cabin temperatures (web `inside`), `null` for a gap.
 * @property outsideValues the SI→display outside temperatures (web `outside`), `null` for a gap.
 * @property stats the summary tiles (Cabin + Outside latest values), empty unless [hasData].
 * @property tempUnit the active temperature unit suffix (web `unitPrefs.temperature`, e.g. `°C` / `°F`).
 */
data class ClimateHistoryDisplay(
    val hasData: Boolean,
    val isCompact: Boolean,
    val isWide: Boolean,
    val xLabels: List<String>,
    val insideValues: List<Double?>,
    val outsideValues: List<Double?>,
    val stats: List<ClimateHistoryStat>,
    val title: String,
    val cabinLabel: String,
    val outsideLabel: String,
    val noDataMessage: String,
    val tempUnit: String,
)

/**
 * Formats an ISO-8601 [iso] timestamp as a localized full date-time label in [zone] using [locale] — the
 * native port of the web `useDateFormat().formatDateTime` axis/tooltip formatter. An unparseable or blank
 * value returns the [EM_DASH] the web `formatDateTime` returns for an invalid date.
 */
fun climateTimeLabel(
    iso: String,
    locale: Locale = Locale.getDefault(),
    zone: ZoneId = ZoneId.systemDefault(),
): String {
    if (iso.isBlank()) return EM_DASH
    return runCatching {
        DateTimeFormatter
            .ofPattern(TIME_PATTERN, locale)
            .withZone(zone)
            .format(Instant.parse(iso))
    }.getOrNull() ?: EM_DASH
}

/**
 * Decodes the raw `GET /climate` history [json] array into the chronologically sorted [ClimateSample]
 * list — the native port of the web `buildChartData`. Each row's timestamp is `created_at ?? timestamp`
 * (web `entry.created_at ?? entry.timestamp`); a row without either is dropped (web
 * `.filter(d => d.created_at || d.timestamp)`); the two SI Celsius temperatures are read null-tolerantly
 * (a field that is absent / `JsonNull` / not a JSON number reads as `null`, web `!= null` guard). Rows are
 * sorted by their ISO timestamp, which for the server's UTC ISO strings is chronological (web
 * `a.time.localeCompare(b.time)`). A non-array input yields an empty list; non-object rows are skipped.
 */
fun parseClimateSamples(json: JsonElement?): List<ClimateSample> {
    val array = json as? JsonArray ?: return emptyList()
    return array
        .mapNotNull { element ->
            val obj = element as? JsonObject ?: return@mapNotNull null
            val timeIso = obj.string(FIELD_CREATED_AT) ?: obj.string(FIELD_TIMESTAMP)
            if (timeIso.isNullOrBlank()) return@mapNotNull null
            ClimateSample(
                timeIso = timeIso,
                insideC = obj.double(FIELD_INSIDE_TEMP),
                outsideC = obj.double(FIELD_OUTSIDE_TEMP),
            )
        }.sortedBy { it.timeIso }
}

private fun JsonObject.double(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull?.takeIf { it.isFinite() }

private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

/**
 * Pure projection from a [ClimateHistorySnapshot] to the render-ready [ClimateHistoryDisplay] — the native
 * port of the web component's `chartData` / `latestInside` / `latestOutside` memos and its compact vs
 * standard stat selection. The SI→display temperature conversion is applied here through the shared
 * [UnitFormatter] (web `useUnits()` + `convertTempFromSI`), keeping the SI source unconverted (Phase-48;
 * ADR-013). Time labels format with [zone]; numbers + the unit suffix come from the formatter's locale +
 * temperature preference.
 */
object ClimateHistoryProjection {
    /**
     * Project [snapshot] for [size] using the localized [strings] and the display [formatter]. The stat
     * row is empty unless [ClimateHistorySnapshot.hasData]; otherwise it carries the latest non-null
     * cabin + outside readings (web `latestInside` / `latestOutside` reverse scans), formatted as whole
     * degrees with the active temperature unit. Time labels render in [zone].
     */
    fun project(
        snapshot: ClimateHistorySnapshot,
        size: ClimateHistorySize,
        strings: ClimateHistoryStrings,
        formatter: UnitFormatter,
        zone: ZoneId = ZoneId.systemDefault(),
    ): ClimateHistoryDisplay {
        val locale = localeFrom(formatter.prefs.locale)
        val tempPref = formatter.prefs.temperature
        val samples = snapshot.samples
        val insideValues = samples.map { sample -> sample.insideC?.let { convertTempFromSI(it, tempPref) } }
        val outsideValues = samples.map { sample -> sample.outsideC?.let { convertTempFromSI(it, tempPref) } }
        val hasData = snapshot.hasData
        return ClimateHistoryDisplay(
            hasData = hasData,
            isCompact = size.isCompact,
            isWide = size.isWide,
            xLabels = samples.map { climateTimeLabel(it.timeIso, locale, zone) },
            insideValues = insideValues,
            outsideValues = outsideValues,
            stats =
                if (hasData) {
                    listOf(
                        ClimateHistoryStat(strings.cabin, formatLatest(insideValues, locale), tempPref.label),
                        ClimateHistoryStat(strings.outside, formatLatest(outsideValues, locale), tempPref.label),
                    )
                } else {
                    emptyList()
                },
            title = strings.title,
            cabinLabel = strings.cabin,
            outsideLabel = strings.outside,
            noDataMessage = strings.noData,
            tempUnit = tempPref.label,
        )
    }

    /** The last non-null reading formatted as whole degrees (web `fmtInt(latest)`), or the em dash. */
    private fun formatLatest(
        values: List<Double?>,
        locale: Locale,
    ): String {
        val latest = values.lastOrNull { it != null } ?: return EM_DASH
        return ChartFormat.number(latest, TEMP_DECIMALS, locale)
    }

    private fun localeFrom(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(tag)
}

/**
 * The active vehicle id the widget reads climate history for — the native port of the web
 * `vid = vehicleId ?? vehicles?.[0]?.id ?? 0`. A positive [preferredVehicleId] wins; otherwise the first
 * enrolled vehicle is used; `null` means neither is available (the surface shows its empty state, web's
 * disabled `enabled: vid > 0` query).
 */
fun resolveVehicleId(
    preferredVehicleId: Long?,
    vehicles: List<Vehicle>?,
): Long? = preferredVehicleId?.takeIf { it > 0L } ?: firstVehicleId(vehicles)

/** The first enrolled vehicle's id, or `null` when the fleet list is absent or empty. */
fun firstVehicleId(vehicles: List<Vehicle>?): Long? = vehicles?.firstOrNull()?.id?.takeIf { it > 0L }
