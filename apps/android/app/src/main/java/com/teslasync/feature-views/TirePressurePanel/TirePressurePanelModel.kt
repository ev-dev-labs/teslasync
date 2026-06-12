// Pure, framework-free model + projection for the TirePressurePanel feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/vehicles/components/telemetry-panels/TirePressurePanel.tsx). No Compose, no Android
// framework, no HTTP: every declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate,
// so the composable stays a thin render layer. The web component receives a `TirePressureSnapshot` prop and,
// when it is present, renders a 2×2 grid of four per-wheel tiles (FL/FR/RL/RR) whose value + border color
// reflect the wheel's safety band, plus a single status chip summarizing the four (All Normal / Attention
// Needed / Check Pressure); when the snapshot is null it renders a friendly "No tire pressure data available"
// empty state.
//
// The readers below pull the typed SI fields (`front_left`, `front_right`, `rear_left`, `rear_right` — all
// Pascals, UnitKindPressure ToSI) and narrow each exactly as the web's typed contract does (a field that is
// absent or of the wrong JSON kind reads as missing). All band comparisons stay in Pascals — the single
// canonical source of truth shared with the web `TIRE_PRESSURE_PA` helper — and the Pa→kPa→display conversion
// runs only at the render boundary through the shared [UnitFormatter] (web `useUnits().formatPressure`, which
// expects kPa input), keeping the SI source unconverted (Phase-48 SI-canonical rule; ADR-013).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/TirePressurePanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling ClimatePanel / TirePressureSection surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.tirepressurepanel

import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, location, or any
 * tire payload, so a diagnostics line can never leak the vehicle's identity or its pressures.
 */
const val TIRE_PRESSURE_PANEL_SLUG: String = "TirePressurePanel"

/** Em dash shown for a missing reading — the shared formatter's empty value (web `formatPressure(null)`). */
internal const val EM_DASH: String = "\u2014"

/** 1 kPa = 1000 Pa. The shared `formatPressure` expects kPa input (web `paToKpa`). */
private const val PA_PER_KPA: Double = 1000.0

// The typed SI panel fields the web reads off the `TirePressureSnapshot` prop. Every value is Pascals (SI);
// the reader narrows each with the web's typed `number | null` contract (a quoted-string field reads as null).
private const val FIELD_FRONT_LEFT = "front_left"
private const val FIELD_FRONT_RIGHT = "front_right"
private const val FIELD_REAR_LEFT = "rear_left"
private const val FIELD_REAR_RIGHT = "rear_right"

/**
 * Tire-pressure safety thresholds in Pascals — the SI canonical band, a verbatim port of the web
 * `TIRE_PRESSURE_PA` helper (web/src/features/vehicles/components/vehicle-detail/helpers.ts). Keeping the band
 * in Pa makes the backend SI value the single source of truth shared by every tire surface; display
 * conversion to the user's pressure unit happens only at the renderer.
 */
object TirePressurePa {
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

/** The four wheels, in the web tile render order (top-left → bottom-right). */
enum class TirePressureWheel { FrontLeft, FrontRight, RearLeft, RearRight }

/**
 * A single wheel's safety band — the native analogue of the web `getColor`/`getBorder` ladders. The render
 * layer resolves each band's color (value text + tile border) from this; [Unknown] is the web `pa == null`
 * muted branch.
 */
enum class TirePressureVariant { Normal, Warning, Critical, Unknown }

/**
 * The aggregate status of the four wheels — the native analogue of the web status chip's
 * `allGood ? … : anyBad ? … : …` ternary, in the same precedence.
 */
enum class TireOverallStatus { AllNormal, AttentionNeeded, CheckPressure }

/**
 * The four SI (Pascals) tire-pressure readings the web reads off the `TirePressureSnapshot` prop. Pure data so
 * the projection stays unit-testable off-device; a `null` field is an absent reading or one of the wrong JSON
 * kind (web typed `number | null`).
 */
data class TirePressureReading(
    val frontLeftPa: Double?,
    val frontRightPa: Double?,
    val rearLeftPa: Double?,
    val rearRightPa: Double?,
) {
    /** The Pascal reading for [wheel], or `null` when absent. */
    fun pressure(wheel: TirePressureWheel): Double? =
        when (wheel) {
            TirePressureWheel.FrontLeft -> frontLeftPa
            TirePressureWheel.FrontRight -> frontRightPa
            TirePressureWheel.RearLeft -> rearLeftPa
            TirePressureWheel.RearRight -> rearRightPa
        }

    companion object {
        /** The all-absent reading used for a non-object snapshot (the web null-prop branch). */
        val EMPTY: TirePressureReading = TirePressureReading(null, null, null, null)
    }
}

/**
 * One render-ready per-wheel tile — the native analogue of one web grid tile. [label] is the visible
 * abbreviation (FL/FR/RL/RR), [valueText] the fully formatted, unit-suffixed pressure (or the em-dash
 * fallback), [variant] selects the value/border color, and [contentDescription] is the grouped, full-wheel-name
 * TalkBack phrase so the dense tile reads as a self-describing unit.
 */
data class TireWheelDisplay(
    val wheel: TirePressureWheel,
    val label: String,
    val valueText: String,
    val variant: TirePressureVariant,
    val contentDescription: String,
)

/**
 * The fully projected, render-ready view of the tire snapshot — the native analogue of everything the web
 * component computes before returning JSX. Pure data (no Compose types) so every branch is unit-tested
 * directly. When [hasData] is false the surface renders its empty state (web `tireData == null`); otherwise it
 * renders the four [wheels] tiles and the aggregate status chip.
 *
 * @property hasData whether a tire snapshot object was decoded (web `tireData` truthy).
 * @property wheels the four per-wheel tiles in web order; empty only in the empty projection.
 * @property status the aggregate band (web `allGood`/`anyBad`/else).
 * @property statusLabel the localized status text the chip renders (web `'All Normal'`/`'Attention Needed'`/`'Check Pressure'`).
 * @property statusContentDescription the chip's TalkBack phrase (the localized status label).
 */
data class TirePressurePanelDisplay(
    val hasData: Boolean,
    val wheels: List<TireWheelDisplay>,
    val status: TireOverallStatus,
    val statusLabel: String,
    val statusContentDescription: String,
) {
    companion object {
        /** The no-snapshot projection (web `tireData == null`): the surface shows its empty state. */
        fun empty(): TirePressurePanelDisplay =
            TirePressurePanelDisplay(
                hasData = false,
                wheels = emptyList(),
                status = TireOverallStatus.CheckPressure,
                statusLabel = "",
                statusContentDescription = "",
            )
    }
}

/**
 * The localized strings the panel renders — the native mirror of the title `t('common.tirePressure')` plus the
 * tile/status microcopy the web hard-codes, resolved once at the Compose boundary (P1/S10) and passed in so the
 * projection stays framework-free yet fully localized.
 *
 * @property title the panel title (web `t('common.tirePressure', 'Tire Pressure')`).
 * @property flLabel / [frLabel] / [rlLabel] / [rrLabel] the visible tile abbreviations (web `'FL'`/`'FR'`/`'RL'`/`'RR'`).
 * @property frontLeft / [frontRight] / [rearLeft] / [rearRight] the full wheel names, used for the tile TalkBack phrase.
 * @property allNormal / [attentionNeeded] / [checkPressure] the three status-chip labels.
 * @property noData the empty-state message (web `'No tire pressure data available'`).
 * @property snapshotLabel personalizes the error surface's retry copy.
 */
data class TirePressurePanelStrings(
    val title: String,
    val flLabel: String,
    val frLabel: String,
    val rlLabel: String,
    val rrLabel: String,
    val frontLeft: String,
    val frontRight: String,
    val rearLeft: String,
    val rearRight: String,
    val allNormal: String,
    val attentionNeeded: String,
    val checkPressure: String,
    val noData: String,
    val snapshotLabel: String = title,
)

/**
 * Pure projection from the tire snapshot to the panel's render state — a 1:1 port of the web component's field
 * reads, per-wheel band logic, aggregate-status ternary, and Pa→kPa→display formatting. Stateless and
 * side-effect-free so it is fully covered by the off-device unit gate; the composable only resolves localized
 * strings + the live [UnitFormatter] and draws what these return.
 */
object TirePressurePanelProjection {
    /**
     * The four readings the web derives from the snapshot. Each field uses the typed `number` guard (a
     * quoted-string value reads as `null`, matching the web's typed contract); a non-object snapshot yields
     * [TirePressureReading.EMPTY].
     */
    fun parse(snapshot: JsonElement?): TirePressureReading {
        val obj = snapshot as? JsonObject ?: return TirePressureReading.EMPTY
        return TirePressureReading(
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
     * The safety band of a single wheel's Pascal reading — a verbatim port of the web `getColor`/`getBorder`
     * ladders: `null` → [TirePressureVariant.Unknown]; outside the critical band → [TirePressureVariant.Critical];
     * outside the warning band → [TirePressureVariant.Warning]; otherwise [TirePressureVariant.Normal].
     */
    fun variantOf(pa: Double?): TirePressureVariant =
        when {
            pa == null || !pa.isFinite() -> TirePressureVariant.Unknown
            pa < TirePressurePa.LOW_CRITICAL || pa > TirePressurePa.HIGH_CRITICAL -> TirePressureVariant.Critical
            pa < TirePressurePa.LOW_WARNING || pa > TirePressurePa.HIGH_WARNING -> TirePressureVariant.Warning
            else -> TirePressureVariant.Normal
        }

    /**
     * The aggregate status of the four wheels — the web status ternary in the same precedence:
     * every wheel present and inside the warning band ⇒ [TireOverallStatus.AllNormal]; else any wheel present
     * and outside the critical band ⇒ [TireOverallStatus.AttentionNeeded]; otherwise [TireOverallStatus.CheckPressure].
     */
    fun overallStatus(reading: TirePressureReading): TireOverallStatus {
        val all = TirePressureWheel.entries.map { reading.pressure(it) }
        val allGood = all.all { it != null && it >= TirePressurePa.LOW_WARNING && it <= TirePressurePa.HIGH_WARNING }
        val anyBad = all.any { it != null && (it < TirePressurePa.LOW_CRITICAL || it > TirePressurePa.HIGH_CRITICAL) }
        return when {
            allGood -> TireOverallStatus.AllNormal
            anyBad -> TireOverallStatus.AttentionNeeded
            else -> TireOverallStatus.CheckPressure
        }
    }

    /**
     * Projects [snapshot] onto the render-ready [TirePressurePanelDisplay] using [formatter] for the
     * Pa→kPa→display boundary (web `useUnits().formatPressure`) and [strings] for every label. A
     * `null`/`JsonNull`/non-object snapshot yields [TirePressurePanelDisplay.empty] (the web null-prop branch);
     * otherwise every wheel + the aggregate status is read + formatted exactly as the web component does.
     */
    fun project(
        snapshot: JsonElement?,
        formatter: UnitFormatter,
        strings: TirePressurePanelStrings,
    ): TirePressurePanelDisplay {
        if (snapshot !is JsonObject) return TirePressurePanelDisplay.empty()
        val reading = parse(snapshot)
        val wheels = TirePressureWheel.entries.map { wheelDisplay(it, reading.pressure(it), formatter, strings) }
        val status = overallStatus(reading)
        val statusLabel = statusLabel(status, strings)
        return TirePressurePanelDisplay(
            hasData = true,
            wheels = wheels,
            status = status,
            statusLabel = statusLabel,
            statusContentDescription = statusLabel,
        )
    }

    /** The localized status-chip text for [status] — web `'All Normal'`/`'Attention Needed'`/`'Check Pressure'`. */
    fun statusLabel(
        status: TireOverallStatus,
        strings: TirePressurePanelStrings,
    ): String =
        when (status) {
            TireOverallStatus.AllNormal -> strings.allNormal
            TireOverallStatus.AttentionNeeded -> strings.attentionNeeded
            TireOverallStatus.CheckPressure -> strings.checkPressure
        }

    /**
     * Builds one per-wheel tile: the band [variant], the formatted pressure (web `formatPressure(paToKpa(pa))`),
     * the visible abbreviation, and the grouped full-wheel-name TalkBack phrase (`"$fullName, $value"`).
     */
    private fun wheelDisplay(
        wheel: TirePressureWheel,
        pa: Double?,
        formatter: UnitFormatter,
        strings: TirePressurePanelStrings,
    ): TireWheelDisplay {
        val value = formatter.pressure(paToKpa(pa))
        val fullName = fullName(wheel, strings)
        return TireWheelDisplay(
            wheel = wheel,
            label = abbrevLabel(wheel, strings),
            valueText = value,
            variant = variantOf(pa),
            contentDescription = "$fullName, $value",
        )
    }

    /** The visible tile abbreviation for [wheel] (web `'FL'`/`'FR'`/`'RL'`/`'RR'`). */
    private fun abbrevLabel(
        wheel: TirePressureWheel,
        strings: TirePressurePanelStrings,
    ): String =
        when (wheel) {
            TirePressureWheel.FrontLeft -> strings.flLabel
            TirePressureWheel.FrontRight -> strings.frLabel
            TirePressureWheel.RearLeft -> strings.rlLabel
            TirePressureWheel.RearRight -> strings.rrLabel
        }

    /** The full wheel name for [wheel], used in the tile's TalkBack phrase. */
    private fun fullName(
        wheel: TirePressureWheel,
        strings: TirePressurePanelStrings,
    ): String =
        when (wheel) {
            TirePressureWheel.FrontLeft -> strings.frontLeft
            TirePressureWheel.FrontRight -> strings.frontRight
            TirePressureWheel.RearLeft -> strings.rearLeft
            TirePressureWheel.RearRight -> strings.rearRight
        }

    /** A JSON number field as a [Double], or `null` when absent or not a JSON number (web typed `number`). */
    private fun JsonObject.numberOrNull(key: String): Double? {
        val primitive = this[key] as? JsonPrimitive ?: return null
        return if (primitive.isString) null else primitive.doubleOrNull
    }
}

/**
 * Resource name (by-name) for the status-chip "Attention Needed" label. The visible title / wheel-abbreviation /
 * "All Normal" / "Check Pressure" / empty keys all exist in the i18n catalog (P1/S10) and resolve at compile
 * time; this one string the catalog does not define (the web source uses a raw literal with no `t()` call), so
 * it is resolved by-name with a native fallback — reproducing i18next's "return the default when the key is
 * absent" behaviour so the surface still carries the web's English text verbatim while routing through the i18n
 * facade.
 */
const val KEY_ATTENTION_NEEDED: String = "translation_telemetry_attentionNeeded"

/** Native fallback microcopy backing the one status string the i18n catalog does not define. */
object TirePressurePanelDefaults {
    /** Web `'✗ Attention Needed'` chip text (glyph excluded; the native chip renders its own icon). */
    const val ATTENTION_NEEDED: String = "Attention Needed"
}

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result for
 * [resourceName] when it resolves to a non-blank string, otherwise the [fallback] default. [lookup] is a thin
 * seam over the Android string catalog in production (an optional by-name resource read) and a map in tests, so
 * the resolve-or-fallback decision stays pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [TIRE_PRESSURE_PANEL_SLUG] (P1/S11). Carries
 * no tire payload or vehicle id, so a diagnostics line can never leak pressures or identity. Kept free of
 * Compose so it is unit-tested with a recording [Logger]; the view-model calls it from the composable's
 * first-composition effect.
 */
fun recordTirePressurePanelOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to TIRE_PRESSURE_PANEL_SLUG))
}
