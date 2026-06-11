// Pure, framework-free model + projection for the Tire Pressure Visual dashboard widget — the native
// analogue of the data the web component derives before returning JSX
// (web/src/features/dashboard/widgets/TirePressureVisualWidget.tsx). No Compose, no Android framework, no
// HTTP: every type here is unit-tested off device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/TirePressureVisualWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so
// the package intentionally diverges from the path — exactly as the sibling ClimateStatusWidget does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.tirepressurevisual

import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.units.formatPressure
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlin.math.roundToLong
import kotlin.time.Instant

/** Em dash shown for a missing reading — the web `'—'` fallback and the shared formatter's empty value. */
internal const val EM_DASH: String = "\u2014"

// The four corner pressure fields the web reads off the `/tire-pressure/latest` document.
private const val FIELD_FRONT_LEFT = "front_left"
private const val FIELD_FRONT_RIGHT = "front_right"
private const val FIELD_REAR_LEFT = "rear_left"
private const val FIELD_REAR_RIGHT = "rear_right"

// The four per-corner last-seen timestamps. These mirror the web `TirePressureSnapshot` type
// (`last_seen_time_*`) VERBATIM, so the native footer reading-time resolves exactly as the web does — a
// corner whose timestamp key is absent reads as missing (→ "No reading"), never a fabricated value.
private const val FIELD_LAST_SEEN_FL = "last_seen_time_fl"
private const val FIELD_LAST_SEEN_FR = "last_seen_time_fr"
private const val FIELD_LAST_SEEN_RL = "last_seen_time_rl"
private const val FIELD_LAST_SEEN_RR = "last_seen_time_rr"

// Per-corner pressure render precision — the web `fmtNumber(v, 1)` (one fixed fraction digit, independent
// of the user's decimal-precision preference, exactly as the web component pins it).
private const val PRESSURE_VALUE_DECIMALS = 1

// Relative-time arithmetic constants (web `formatTimestamp`).
private const val MILLIS_PER_MINUTE = 60_000.0
private const val MINUTES_PER_HOUR = 60.0
private const val HOURS_PER_DAY = 24.0

/**
 * Pressure thresholds, in the SAME magnitude the web `THRESHOLD` constant uses, ported VERBATIM from
 * `TirePressureVisualWidget.tsx`. The web applies these cutoffs to the raw `/tire-pressure/latest` value
 * with no conversion, and [TirePressureVisualProjection.getPressureStatus] does likewise — so the native
 * color-coding reproduces the web's pixel-for-pixel. The web component is the single source of truth for
 * this surface; any threshold/unit revision must land in the web source first and be re-ported here, so
 * the two grids never silently drift.
 */
internal object PressureThreshold {
    const val DANGER_LOW: Double = 2.068
    const val WARN_LOW: Double = 2.275
    const val WARN_HIGH: Double = 2.896
    const val DANGER_HIGH: Double = 3.103
}

/** Pressure status bucket driving each tire's fill + value color (web `'green' | 'amber' | 'red'`). */
enum class TireStatus {
    /** In the recommended band (web `green`). */
    Green,

    /** Soft over/under-inflation (web `amber`). */
    Amber,

    /** Hard over/under-inflation, or no reading (web `red`; web `bar == null` → red). */
    Red,
}

/** The four wheel positions, in the web `tires` array order (FL, FR, RL, RR). */
enum class TireCorner {
    FrontLeft,
    FrontRight,
    RearLeft,
    RearRight,
}

/**
 * Coarse, i18n-friendly bucket for the most-recent TPMS reading age — the native analogue of the web
 * `formatTimestamp` branches. The render layer maps each bucket to a localized string (P1/S10) so this
 * pure logic carries no English microcopy.
 */
sealed interface TireReadingAge {
    /** No (or blank) timestamp on any corner — web `t('widget.tireNoReading')`. */
    data object NoReading : TireReadingAge

    /** A present-but-unparseable timestamp — web `'—'`. */
    data object Invalid : TireReadingAge

    /** Younger than a minute — web `t('widget.tireJustNow')`. */
    data object JustNow : TireReadingAge

    /** `value` minutes ago — web `${diffMin}m ago`. */
    data class Minutes(
        val value: Long,
    ) : TireReadingAge

    /** `value` hours ago — web `${diffHrs}h ago`. */
    data class Hours(
        val value: Long,
    ) : TireReadingAge

    /** `value` days ago — web `${days}d ago`. */
    data class Days(
        val value: Long,
    ) : TireReadingAge
}

/** One render-ready corner: its [corner] position, formatted pressure [valueText], and [status] color. */
data class TireReading(
    val corner: TireCorner,
    val valueText: String,
    val status: TireStatus,
)

/**
 * The fully projected, render-ready view of the tire-pressure snapshot — the native analogue of
 * everything the web component computes before returning JSX. Pure data (no Compose types) so every
 * branch is unit-tested directly.
 *
 * @property hasData whether a snapshot object was decoded (web `tireData` truthy); when false the surface
 *   renders its empty state instead of the diagram.
 * @property tires the four corners in FL, FR, RL, RR order, each already SI→display converted + status-classified.
 * @property allNormal whether every corner is [TireStatus.Green] (web `allNormal`) — drives the badge.
 * @property hasWarning whether any corner is not green (web `hasWarning`) — drives the badge.
 * @property unitLabel the user's pressure unit label for the footer (web `pressureUnit`, e.g. "bar").
 * @property readingAge the relative age of the most-recent corner timestamp (web `latestReading`).
 */
data class TirePressureVisualDisplay(
    val hasData: Boolean,
    val tires: List<TireReading>,
    val allNormal: Boolean,
    val hasWarning: Boolean,
    val unitLabel: String,
    val readingAge: TireReadingAge,
) {
    /** The corner reading for [corner], or `null` when [hasData] is false. */
    fun tire(corner: TireCorner): TireReading? = tires.firstOrNull { it.corner == corner }

    companion object {
        /** The no-snapshot projection (web `tireData == null`): the surface shows its empty state. */
        val EMPTY: TirePressureVisualDisplay =
            TirePressureVisualDisplay(
                hasData = false,
                tires = emptyList(),
                allNormal = false,
                hasWarning = false,
                unitLabel = "",
                readingAge = TireReadingAge.NoReading,
            )
    }
}

/**
 * The widget grid footprint (columns × rows). The web component reads `size.cols` to decide whether to
 * hide its title in a compact (single-column) placement; this type mirrors the registry's size contract
 * consumed by the grid host.
 */
data class TirePressureSize(
    val cols: Int,
    val rows: Int,
)

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/tires.ts (`tire-pressure-visual`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web grids
 * stay in lockstep.
 */
object TirePressureVisualRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "tire-pressure-visual"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "tires"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "TirePressureVisualWidget"

    /** Default footprint: 2 columns × 4 rows. */
    val DEFAULT_SIZE: TirePressureSize = TirePressureSize(cols = 2, rows = 4)

    /** Minimum footprint: 2 columns × 4 rows. */
    val MIN_SIZE: TirePressureSize = TirePressureSize(cols = 2, rows = 4)

    /** Maximum footprint: 4 columns × 40 rows. */
    val MAX_SIZE: TirePressureSize = TirePressureSize(cols = 4, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: TirePressureSize): Boolean =
        size.cols in MIN_SIZE.cols..MAX_SIZE.cols && size.rows in MIN_SIZE.rows..MAX_SIZE.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: TirePressureSize): TirePressureSize =
        TirePressureSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )

    /** Whether the surface hides its title (web `isCompact = size.cols <= 1`). */
    fun isCompact(size: TirePressureSize): Boolean = size.cols <= 1
}

/**
 * Pure projection from a decoded tire-pressure snapshot [JsonElement] to the render-ready
 * [TirePressureVisualDisplay] — the native port of the field reads, status classification, pressure
 * formatting, and latest-reading-time logic in `TirePressureVisualWidget.tsx`. The web reads the four
 * corner pressures off `/tire-pressure/latest` (SI kilopascals; Phase-48), classifies each against the
 * verbatim [PressureThreshold] cutoffs, formats each via `usePressureFormat`, and derives the badge +
 * footer time. This reproduces those exact reads against the typed contract (a field that is absent or
 * not of the expected JSON kind reads as missing). The SI→display pressure conversion is applied here
 * through the shared [UnitFormatter] (web `useUnits()`), keeping the SI source unconverted (ADR-013).
 */
object TirePressureVisualProjection {
    /**
     * Project [snapshot] into the render model using [formatter] for the SI→display pressure boundary and
     * [nowMs] for the relative reading-age. A `null`/`JsonNull`/non-object snapshot yields
     * [TirePressureVisualDisplay.EMPTY] (web's `tireData` falsy branch).
     */
    fun project(
        snapshot: JsonElement?,
        formatter: UnitFormatter,
        nowMs: Long,
    ): TirePressureVisualDisplay {
        val obj = snapshot as? JsonObject ?: return TirePressureVisualDisplay.EMPTY

        val tires =
            listOf(
                reading(TireCorner.FrontLeft, obj.doubleField(FIELD_FRONT_LEFT), formatter),
                reading(TireCorner.FrontRight, obj.doubleField(FIELD_FRONT_RIGHT), formatter),
                reading(TireCorner.RearLeft, obj.doubleField(FIELD_REAR_LEFT), formatter),
                reading(TireCorner.RearRight, obj.doubleField(FIELD_REAR_RIGHT), formatter),
            )

        val latestReading =
            listOfNotNull(
                obj.stringField(FIELD_LAST_SEEN_FL),
                obj.stringField(FIELD_LAST_SEEN_FR),
                obj.stringField(FIELD_LAST_SEEN_RL),
                obj.stringField(FIELD_LAST_SEEN_RR),
            ).filter { it.isNotBlank() }.maxOrNull()

        return TirePressureVisualDisplay(
            hasData = true,
            tires = tires,
            allNormal = tires.all { it.status == TireStatus.Green },
            hasWarning = tires.any { it.status != TireStatus.Green },
            unitLabel = formatter.prefs.pressure.label,
            readingAge = computeReadingAge(latestReading, nowMs),
        )
    }

    /** True when [snapshot] carries no snapshot object (web `tireData` falsy) → render the empty state. */
    fun isEmptySnapshot(snapshot: JsonElement?): Boolean = snapshot !is JsonObject

    /**
     * Classifies a raw corner [value] into its [TireStatus] — a VERBATIM port of the web
     * `getPressureStatus`: a null reading is red, a value outside the danger band is red, a value outside
     * the warn band is amber, otherwise green. Operates on the raw API value exactly as the web does (see
     * [PressureThreshold]).
     */
    fun getPressureStatus(value: Double?): TireStatus =
        when {
            value == null -> TireStatus.Red
            value < PressureThreshold.DANGER_LOW || value > PressureThreshold.DANGER_HIGH -> TireStatus.Red
            value < PressureThreshold.WARN_LOW || value > PressureThreshold.WARN_HIGH -> TireStatus.Amber
            else -> TireStatus.Green
        }

    /**
     * Buckets the most-recent corner timestamp [iso] into a [TireReadingAge] relative to [nowMs] — the
     * native port of the web `formatTimestamp` cutoffs (`< 1m` → just-now, `< 60m` → minutes,
     * `< 24h` → hours, else days), with a blank timestamp → no-reading and an unparseable one → invalid.
     */
    fun computeReadingAge(
        iso: String?,
        nowMs: Long,
    ): TireReadingAge {
        val epochMs = iso?.takeIf { it.isNotBlank() }?.let { parseIsoMillis(it) }
        return when {
            iso.isNullOrBlank() -> TireReadingAge.NoReading
            epochMs == null -> TireReadingAge.Invalid
            else -> bucketReadingAge(nowMs - epochMs)
        }
    }

    /** Buckets an age delta (ms) into the web `formatTimestamp` minute/hour/day tiers (rounded like `Math.round`). */
    private fun bucketReadingAge(deltaMs: Long): TireReadingAge {
        val diffMin = (deltaMs / MILLIS_PER_MINUTE).roundToLong()
        val diffHrs = (diffMin / MINUTES_PER_HOUR).roundToLong()
        return when {
            diffMin < 1L -> TireReadingAge.JustNow
            diffMin < MINUTES_PER_HOUR -> TireReadingAge.Minutes(diffMin)
            diffHrs < HOURS_PER_DAY -> TireReadingAge.Hours(diffHrs)
            else -> TireReadingAge.Days((diffHrs / HOURS_PER_DAY).roundToLong())
        }
    }

    private fun reading(
        corner: TireCorner,
        value: Double?,
        formatter: UnitFormatter,
    ): TireReading =
        TireReading(
            corner = corner,
            valueText = formatPressureValue(value, formatter),
            status = getPressureStatus(value),
        )

    /**
     * Formats a single SI-kilopascal corner [kpa] as the bare display number (no unit suffix) — the
     * native equivalent of the web `fmtNumber(toPressureValue(val), 1)`. It reuses the shared, golden-pinned
     * [formatPressure] (so the number matches the web `Intl.NumberFormat` output exactly) and strips the
     * unit label the footer renders separately; a null/non-finite reading is the em dash (web `'—'`).
     */
    private fun formatPressureValue(
        kpa: Double?,
        formatter: UnitFormatter,
    ): String {
        if (kpa == null || !kpa.isFinite()) return EM_DASH
        val withUnit = formatPressure(kpa, formatter.prefs, PRESSURE_VALUE_DECIMALS)
        return withUnit.removeSuffix(" ${formatter.prefs.pressure.label}")
    }

    private fun parseIsoMillis(iso: String): Long? =
        try {
            Instant.parse(iso).toEpochMilliseconds()
        } catch (_: IllegalArgumentException) {
            null
        }
}

/** Read a numeric field, or `null` when absent / `JsonNull` / not a JSON number (web typed `number`). */
private fun JsonObject.doubleField(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

/** Read a JSON string field, or `null` when absent / `JsonNull` / not a quoted string (web typed `string`). */
private fun JsonObject.stringField(key: String): String? =
    (this[key] as? JsonPrimitive)?.let { if (it.isString) it.contentOrNull else null }

/**
 * The active vehicle id the widget reads tire pressure for — the native port of the web
 * `id = vehicleId ?? vehicles?.[0]?.id ?? 0`. A positive [preferredVehicleId] wins; otherwise the first
 * enrolled vehicle is used; `null` means neither is available (the surface shows its empty state).
 */
fun resolveVehicleId(
    preferredVehicleId: Long?,
    vehicles: List<Vehicle>?,
): Long? = preferredVehicleId?.takeIf { it > 0L } ?: firstVehicleId(vehicles)

/** The first enrolled vehicle's id, or `null` when the fleet list is absent or empty. */
fun firstVehicleId(vehicles: List<Vehicle>?): Long? = vehicles?.firstOrNull()?.id?.takeIf { it > 0L }
