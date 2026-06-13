// Pure, framework-free model + projection for the TirePressureSection feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/vehicles/components/vehicle-detail/TirePressureSection.tsx). No Compose, no Android
// framework, no HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate,
// so the composable stays a thin render layer. The web component receives a `TirePressureSnapshot` prop and,
// when it is present, renders a responsive grid of four per-corner tiles (Front Left / Front Right / Rear Left /
// Rear Right); each tile shows the corner's localized label, the formatted current pressure, and a status
// `Badge` (Normal / Low / Critical / No Data). When the snapshot is null it renders a friendly
// "No tire pressure data available" empty state.
//
// The readers below pull the typed SI fields (`front_left`, `front_right`, `rear_left`, `rear_right` — all
// Pascals, UnitKindPressure ToSI) and narrow each exactly as the web's typed contract does (a field that is
// absent or of the wrong JSON kind reads as missing). Both web helpers are ported verbatim: the badge **tone**
// reproduces `tirePressureVariant` (web vehicle-detail/helpers.ts), and the badge **text** reproduces the
// component's own `value != null ? … Normal/Low/Critical : No Data` ternary. All band comparisons stay in
// Pascals — the single canonical source of truth shared with the web `TIRE_PRESSURE_PA` helper — and the
// Pa→kPa→display conversion runs only at the render boundary through the shared [UnitFormatter] (web
// `useUnits().formatPressure`, which expects kPa input), keeping the SI source unconverted (Phase-48
// SI-canonical rule; ADR-013).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/TirePressureSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling ClimatePanel / TirePressurePanel surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.tirepressuresection

import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, location, or any tire
 * payload, so a diagnostics line can never leak the vehicle's identity or its pressures.
 */
const val TIRE_PRESSURE_SECTION_SLUG: String = "TirePressureSection"

/** Em dash shown for a missing reading — the shared formatter's empty value (web `formatPressure(null)`). */
internal const val EM_DASH: String = "\u2014"

/** 1 kPa = 1000 Pa. The shared `formatPressure` expects kPa input (web `paToKpa`). */
private const val PA_PER_KPA: Double = 1000.0

// The typed SI fields the web reads off the `TirePressureSnapshot` prop. Every value is Pascals (SI); the reader
// narrows each with the web's typed `number | null` contract (a quoted-string field reads as null).
private const val FIELD_FRONT_LEFT = "front_left"
private const val FIELD_FRONT_RIGHT = "front_right"
private const val FIELD_REAR_LEFT = "rear_left"
private const val FIELD_REAR_RIGHT = "rear_right"

/**
 * Tire-pressure safety thresholds in Pascals — the SI canonical band, a verbatim port of the web
 * `TIRE_PRESSURE_PA` helper (web/src/features/vehicles/components/vehicle-detail/helpers.ts). Keeping the band in
 * Pa makes the backend SI value the single source of truth shared by every tire surface; display conversion to
 * the user's pressure unit happens only at the renderer.
 */
object TirePressureSectionPa {
    /** Below this is critical-low (≈ 30.0 psi / 2.068 bar). */
    const val LOW_CRITICAL: Double = 206_800.0

    /** Below this is warning-low (≈ 35.0 psi / 2.413 bar). */
    const val LOW_WARNING: Double = 241_300.0

    /** Above this is warning-high (≈ 45.0 psi / 3.103 bar). */
    const val HIGH_WARNING: Double = 310_300.0

    /** Above this is critical-high (≈ 50.0 psi / 3.447 bar). */
    const val HIGH_CRITICAL: Double = 344_700.0
}

/** Converts an SI Pascal value to kPa (the shared `formatPressure` input), or `null` when absent/non-finite. */
fun paToKpa(pa: Double?): Double? = pa?.takeIf { it.isFinite() }?.let { it / PA_PER_KPA }

/** The four tire corners, in the web tile render order (the `tirePressures` array order). */
enum class TireCorner { FrontLeft, FrontRight, RearLeft, RearRight }

/**
 * The badge **tone** of a single corner's reading — a verbatim port of the web `tirePressureVariant` helper's
 * `'success' | 'warning' | 'danger' | 'neutral'` return. The render layer maps this to the shared `Badge`
 * variant (Success/Warning/Danger/Neutral); [Neutral] is the web `pa == null` muted branch.
 */
enum class TireBadgeTone { Success, Warning, Danger, Neutral }

/**
 * The badge **text** category of a single corner — a verbatim port of the web component's own
 * `value != null ? (… Normal / Low / Critical) : No Data` ternary. The render layer resolves each to its
 * localized label; [NoData] is the web `value == null` branch.
 */
enum class TireBadgeStatus { Normal, Low, Critical, NoData }

/**
 * The four SI (Pascals) tire-pressure readings the web reads off the `TirePressureSnapshot` prop. Pure data so
 * the projection stays unit-testable off-device; a `null` field is an absent reading or one of the wrong JSON
 * kind (web typed `number | null`).
 */
data class TireCornerReading(
    val frontLeftPa: Double?,
    val frontRightPa: Double?,
    val rearLeftPa: Double?,
    val rearRightPa: Double?,
) {
    /** The Pascal reading for [corner], or `null` when absent. */
    fun pressure(corner: TireCorner): Double? =
        when (corner) {
            TireCorner.FrontLeft -> frontLeftPa
            TireCorner.FrontRight -> frontRightPa
            TireCorner.RearLeft -> rearLeftPa
            TireCorner.RearRight -> rearRightPa
        }

    companion object {
        /** The all-absent reading used for a non-object snapshot (the web null-prop branch). */
        val EMPTY: TireCornerReading = TireCornerReading(null, null, null, null)
    }
}

/**
 * One render-ready per-corner tile — the native analogue of one web grid tile (a nested `GlassPanel`). [label]
 * is the localized corner name (Front Left/…); [valueText] the fully formatted, unit-suffixed pressure (or the
 * em-dash fallback when absent); [tone] selects the `Badge` color; [statusText] the localized badge text; and
 * [contentDescription] is the grouped TalkBack phrase so the dense tile reads as a self-describing unit.
 */
data class TireCornerTile(
    val corner: TireCorner,
    val label: String,
    val valueText: String,
    val tone: TireBadgeTone,
    val statusText: String,
    val contentDescription: String,
)

/**
 * The fully projected, render-ready view of the tire snapshot — the native analogue of everything the web
 * component computes before returning JSX. Pure data (no Compose types) so every branch is unit-tested directly.
 * When [hasData] is false the surface renders its empty state (web `tireData == null`); otherwise it renders the
 * four [tiles] in web order.
 *
 * @property hasData whether a tire snapshot object was decoded (web `tireData` truthy).
 * @property tiles the four per-corner tiles in web order; empty only in the empty projection.
 */
data class TirePressureSectionDisplay(
    val hasData: Boolean,
    val tiles: List<TireCornerTile>,
) {
    companion object {
        /** The no-snapshot projection (web `tireData == null`): the surface shows its empty state. */
        fun empty(): TirePressureSectionDisplay = TirePressureSectionDisplay(hasData = false, tiles = emptyList())
    }
}

/**
 * The localized strings the section renders — the native mirror of every `t('…')` call the web component makes,
 * resolved once at the Compose boundary (P1/S10) and passed in so the projection stays framework-free yet fully
 * localized.
 *
 * @property title the panel title (web `t('vehicles.detail.tirePressure', 'Tire Pressure')`).
 * @property frontLeft / [frontRight] / [rearLeft] / [rearRight] the corner labels (web `t('vehicles.detail.tireFl')` …).
 * @property normal / [low] / [critical] / [noData] the four badge texts (web `t('common.normal')` …).
 * @property noTireData the empty-state message (web `t('vehicles.detail.noTireData')`).
 * @property snapshotLabel personalizes the error surface's retry copy.
 */
data class TirePressureSectionStrings(
    val title: String,
    val frontLeft: String,
    val frontRight: String,
    val rearLeft: String,
    val rearRight: String,
    val normal: String,
    val low: String,
    val critical: String,
    val noData: String,
    val noTireData: String,
    val snapshotLabel: String = title,
)

/**
 * Pure projection from the tire snapshot to the section's render state — a 1:1 port of the web component's field
 * reads, per-corner tone + badge-text logic, and Pa→kPa→display formatting. Stateless and side-effect-free so it
 * is fully covered by the off-device unit gate; the composable only resolves localized strings + the live
 * [UnitFormatter] and draws what these return.
 */
object TirePressureSectionProjection {
    /**
     * The four readings the web derives from the snapshot. Each field uses the typed `number` guard (a
     * quoted-string value reads as `null`, matching the web's typed contract); a non-object snapshot yields
     * [TireCornerReading.EMPTY].
     */
    fun parse(snapshot: JsonElement?): TireCornerReading {
        val obj = snapshot as? JsonObject ?: return TireCornerReading.EMPTY
        return TireCornerReading(
            frontLeftPa = obj.numberOrNull(FIELD_FRONT_LEFT),
            frontRightPa = obj.numberOrNull(FIELD_FRONT_RIGHT),
            rearLeftPa = obj.numberOrNull(FIELD_REAR_LEFT),
            rearRightPa = obj.numberOrNull(FIELD_REAR_RIGHT),
        )
    }

    /**
     * True when [snapshot] carries no tire object (web `tireData` falsy) → render the empty state. Used by the
     * view-model to classify the cache-then-network feed onto [io.teslasync.android.data.UiPhase.Empty].
     */
    fun isEmptySnapshot(snapshot: JsonElement?): Boolean = snapshot !is JsonObject

    /**
     * The badge tone of a single corner's Pascal reading — a verbatim port of the web `tirePressureVariant`
     * helper: `null`/non-finite → [TireBadgeTone.Neutral]; outside the critical band → [TireBadgeTone.Danger];
     * outside the warning band → [TireBadgeTone.Warning]; otherwise [TireBadgeTone.Success].
     */
    fun toneOf(pa: Double?): TireBadgeTone =
        when {
            pa == null || !pa.isFinite() -> TireBadgeTone.Neutral
            pa < TirePressureSectionPa.LOW_CRITICAL || pa > TirePressureSectionPa.HIGH_CRITICAL -> TireBadgeTone.Danger
            pa < TirePressureSectionPa.LOW_WARNING || pa > TirePressureSectionPa.HIGH_WARNING -> TireBadgeTone.Warning
            else -> TireBadgeTone.Success
        }

    /**
     * The badge text category of a single corner's Pascal reading — a verbatim port of the web component's own
     * ternary: `value == null` → [TireBadgeStatus.NoData]; inside the warning band → [TireBadgeStatus.Normal];
     * else inside the critical band → [TireBadgeStatus.Low]; otherwise [TireBadgeStatus.Critical].
     */
    fun badgeStatusOf(pa: Double?): TireBadgeStatus =
        when {
            pa == null || !pa.isFinite() -> TireBadgeStatus.NoData
            pa >= TirePressureSectionPa.LOW_WARNING && pa <= TirePressureSectionPa.HIGH_WARNING -> TireBadgeStatus.Normal
            pa >= TirePressureSectionPa.LOW_CRITICAL && pa <= TirePressureSectionPa.HIGH_CRITICAL -> TireBadgeStatus.Low
            else -> TireBadgeStatus.Critical
        }

    /** The localized badge text for [status] — web `t('common.normal'/'common.low'/'common.critical'/'common.noData')`. */
    fun badgeLabel(
        status: TireBadgeStatus,
        strings: TirePressureSectionStrings,
    ): String =
        when (status) {
            TireBadgeStatus.Normal -> strings.normal
            TireBadgeStatus.Low -> strings.low
            TireBadgeStatus.Critical -> strings.critical
            TireBadgeStatus.NoData -> strings.noData
        }

    /**
     * Projects [snapshot] onto the render-ready [TirePressureSectionDisplay] using [formatter] for the
     * Pa→kPa→display boundary (web `useUnits().formatPressure`) and [strings] for every label. A
     * `null`/`JsonNull`/non-object snapshot yields [TirePressureSectionDisplay.empty] (the web null-prop branch);
     * otherwise every corner is read + formatted exactly as the web component does.
     */
    fun project(
        snapshot: JsonElement?,
        formatter: UnitFormatter,
        strings: TirePressureSectionStrings,
    ): TirePressureSectionDisplay {
        if (snapshot !is JsonObject) return TirePressureSectionDisplay.empty()
        val reading = parse(snapshot)
        val tiles = TireCorner.entries.map { cornerTile(it, reading.pressure(it), formatter, strings) }
        return TirePressureSectionDisplay(hasData = true, tiles = tiles)
    }

    /**
     * Builds one per-corner tile: the localized label, the formatted pressure (web `formatPressure(paToKpa(pa))`),
     * the badge [TireBadgeTone] (web `tirePressureVariant`) + [TireBadgeStatus] text (web ternary), and the
     * grouped TalkBack phrase (`"$label, $value, $status"`).
     */
    private fun cornerTile(
        corner: TireCorner,
        pa: Double?,
        formatter: UnitFormatter,
        strings: TirePressureSectionStrings,
    ): TireCornerTile {
        val label = cornerLabel(corner, strings)
        val value = formatter.pressure(paToKpa(pa))
        val statusText = badgeLabel(badgeStatusOf(pa), strings)
        return TireCornerTile(
            corner = corner,
            label = label,
            valueText = value,
            tone = toneOf(pa),
            statusText = statusText,
            contentDescription = "$label, $value, $statusText",
        )
    }

    /** The localized corner label for [corner] (web `t('vehicles.detail.tireFl')` …). */
    private fun cornerLabel(
        corner: TireCorner,
        strings: TirePressureSectionStrings,
    ): String =
        when (corner) {
            TireCorner.FrontLeft -> strings.frontLeft
            TireCorner.FrontRight -> strings.frontRight
            TireCorner.RearLeft -> strings.rearLeft
            TireCorner.RearRight -> strings.rearRight
        }

    /** A JSON number field as a [Double], or `null` when absent or not a JSON number (web typed `number`). */
    private fun JsonObject.numberOrNull(key: String): Double? {
        val primitive = this[key] as? JsonPrimitive ?: return null
        return if (primitive.isString) null else primitive.doubleOrNull
    }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [TIRE_PRESSURE_SECTION_SLUG] (P1/S11). Carries
 * no tire payload or vehicle id, so a diagnostics line can never leak pressures or identity. Kept free of Compose
 * so it is unit-tested with a recording [Logger]; the view-model calls it from the composable's first-composition
 * effect.
 */
fun recordTirePressureSectionOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to TIRE_PRESSURE_SECTION_SLUG))
}
