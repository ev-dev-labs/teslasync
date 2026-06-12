// Pure, framework-free model + projection for the BatteryHealthSection feature view — the native
// analogue of everything the web component derives before returning JSX
// (web/src/features/analytics/components/weekly-digest/BatteryHealthSection.tsx). No Compose, no Android,
// no HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate,
// keeping the composable a thin render layer over these pure functions.
//
// The web component is purely presentational — its parent (the Weekly Digest page) computes the
// `DigestMetrics` document from the week's drives/charging/alerts and passes it down. This surface reads
// only four of those fields (the average battery at charge start/end, the charge-session count, and the
// total energy added) and renders two `BatteryPill`s plus three `MiniStat`s. This file owns the parts the
// web expresses inline: the rounded pill levels, the `getColor` threshold band (>=60 good / >=30 warning /
// else critical), the proportional bar fraction, the three formatted stat values (`fmtNumber`/`fmtInt`
// with the web `* 5.5` km estimate), and the lifecycle projection onto the shared cache-then-network
// [UiState] so the surface renders every state the P1/S8 layer can carry. Number formatting is delegated
// to the shared locale-aware [ChartFormat.number] (the native mirror of web `fmtNumber`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/BatteryHealthSection — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.batteryhealthsection

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale
import kotlin.math.roundToLong

/** Trailing percent sign — the web `fmtInt(level)%` / `fmtNumber(..., 1)%` suffix (a unit symbol). */
internal const val PERCENT_SUFFIX: String = "%"

/** The estimated-range unit suffix — the web `${fmtNumber(...)} km` literal (note the leading space). */
internal const val RANGE_UNIT_SUFFIX: String = " km"

/** Web `fmtNumber(batteryEnd - batteryStart, 1)` — the charge-gain stat is shown to one decimal. */
private const val GAIN_DECIMALS: Int = 1

/** Web `fmtInt(...)` / `fmtNumber(..., 0)` — whole-number formatting for pills, counts and the km estimate. */
private const val WHOLE_DECIMALS: Int = 0

/** Web `metrics.chargeEnergyAdded * 5.5` — the literal km-per-energy-unit factor for the range estimate. */
private const val RANGE_KM_PER_ENERGY_UNIT: Double = 5.5

/** State-of-charge at or above this percentage is "good" (web `getColor` `>= 60`). */
private const val LEVEL_GOOD_MIN_PCT: Long = 60L

/** State-of-charge at or above this percentage (but below [LEVEL_GOOD_MIN_PCT]) is "warning" (web `>= 30`). */
private const val LEVEL_WARNING_MIN_PCT: Long = 30L

/** The full battery bar — the web track fills to `min(level, 100)%`. */
private const val BATTERY_BAR_FULL_PCT: Long = 100L

/** Denominator that maps a 0–100 level onto the bar's `0f..1f` fill fraction. */
private const val BATTERY_BAR_DENOMINATOR: Float = 100f

/** Canonical registry + diagnostics identifiers for the surface (P1/S11). */
object BatteryHealthSectionRegistration {
    /** Stable surface id (mirrors the web weekly-digest section). */
    const val ID: String = "battery-health-section"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "BatteryHealthSection"
}

/**
 * The four `DigestMetrics` fields this surface reads — the native slice of the web `metrics` prop the
 * component consumes (`batteryStart`, `batteryEnd`, `chargingSessionCount`, `chargeEnergyAdded`). The other
 * digest fields belong to the sibling sections, so they are intentionally omitted.
 *
 * @property batteryStart the average state of charge at charge start, 0–100 (web `metrics.batteryStart`).
 * @property batteryEnd the average state of charge at charge end, 0–100 (web `metrics.batteryEnd`).
 * @property chargingSessionCount the number of charge sessions in the period (web `chargingSessionCount`).
 * @property chargeEnergyAdded the total energy added across the period, feeding the km estimate
 *   (web `metrics.chargeEnergyAdded`).
 */
data class BatteryHealthSnapshot(
    val batteryStart: Double,
    val batteryEnd: Double,
    val chargingSessionCount: Int,
    val chargeEnergyAdded: Double,
)

/**
 * The state-of-charge color band — the native analogue of the web `BatteryPill` `getColor` thresholds
 * (`>= 60` good, `>= 30` warning, otherwise critical). The render layer maps each band onto a semantic
 * status token so light/dark and high-contrast all resolve correctly.
 */
enum class BatteryHealthColorBand {
    /** State of charge at or above 60% (web success green). */
    Good,

    /** State of charge in [30%, 60%) (web warning amber). */
    Warning,

    /** State of charge below 30% (web critical red). */
    Critical,

    ;

    companion object {
        /** The band for a rounded [level] (0–100) — verbatim parity with the web `getColor` thresholds. */
        fun forLevel(level: Long): BatteryHealthColorBand =
            when {
                level >= LEVEL_GOOD_MIN_PCT -> Good
                level >= LEVEL_WARNING_MIN_PCT -> Warning
                else -> Critical
            }
    }
}

/** Which of the two battery pills a [BatteryPillModel] represents; the render layer resolves its label. */
enum class BatteryPillKind {
    /** Average battery at charge start (web `metrics.batteryStart`). */
    AvgStart,

    /** Average battery at charge end (web `metrics.batteryEnd`). */
    AvgEnd,
}

/** Which of the three mini stats a [BatteryHealthStat] represents; the render layer resolves label + glyph. */
enum class BatteryHealthMetric {
    /** Average charge gain percentage (web `batteryEnd - batteryStart`). */
    AvgChargeGain,

    /** Number of charge sessions (web `chargingSessionCount`). */
    ChargeSessions,

    /** Estimated range added in km (web `chargeEnergyAdded * 5.5`). */
    EstRangeAdded,
}

/**
 * One render-ready battery pill — the native analogue of the props the web `BatteryPill` derives from its
 * `level`. Pure data: [kind] selects the localized label at render time, [levelRounded] is the rounded
 * percentage (web `Math.round(level)`), [percentText] is the already-formatted `"72%"` value, [band] drives
 * the icon/value/bar color, and [barFraction] is the `0f..1f` proportional track fill.
 */
data class BatteryPillModel(
    val kind: BatteryPillKind,
    val levelRounded: Long,
    val percentText: String,
    val band: BatteryHealthColorBand,
    val barFraction: Float,
)

/** One render-ready mini stat: its [metric] identity (selects label + glyph) and already-formatted [value]. */
data class BatteryHealthStat(
    val metric: BatteryHealthMetric,
    val value: String,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes
 * before returning JSX. Pure data (no Compose types) so every branch is unit-tested directly.
 *
 * @property pills the two battery pills in source order: [BatteryPillKind.AvgStart] then
 *   [BatteryPillKind.AvgEnd].
 * @property stats the three mini stats in source order: avg charge gain, charge sessions, est. range added.
 */
data class BatteryHealthDisplay(
    val pills: List<BatteryPillModel>,
    val stats: List<BatteryHealthStat>,
)

/**
 * Pure projection from the section's inputs to its render state — a 1:1 port of the web component's inline
 * derivations and value formatting. Stateless and side-effect-free so it is fully covered by the off-device
 * unit gate; the composable only resolves localized strings, glyphs, and colors and draws what these return.
 */
object BatteryHealthSectionProjection {
    /**
     * Maps the section's `(snapshot, isLoading)` props onto the shared cache-then-network [UiState] (P1/S8).
     * The web component itself has no loading/error surface (its parent owns those); this adapter adds the
     * lifecycle states the host's feed can carry while preserving web precedence: loading wins outright, a
     * present snapshot renders [UiPhase.Content], and an absent snapshot renders [UiPhase.Empty] (a friendly
     * no-data state). The host's binding can additionally carry refreshing/stale/offline/error.
     */
    fun projectUiState(
        snapshot: BatteryHealthSnapshot?,
        isLoading: Boolean,
    ): UiState<BatteryHealthSnapshot> =
        when {
            isLoading -> UiState.loading()
            snapshot != null -> UiState(phase = UiPhase.Content, data = snapshot)
            else -> UiState(phase = UiPhase.Empty)
        }

    /**
     * The fully projected [BatteryHealthDisplay] for [snapshot], formatted for [locale] (web `fmtNumber`
     * uses the active locale). Pills come first (start, end), then the three stats in web source order.
     */
    fun display(
        snapshot: BatteryHealthSnapshot,
        locale: Locale,
    ): BatteryHealthDisplay =
        BatteryHealthDisplay(
            pills =
                listOf(
                    pill(BatteryPillKind.AvgStart, snapshot.batteryStart, locale),
                    pill(BatteryPillKind.AvgEnd, snapshot.batteryEnd, locale),
                ),
            stats =
                listOf(
                    BatteryHealthStat(BatteryHealthMetric.AvgChargeGain, avgChargeGainText(snapshot, locale)),
                    BatteryHealthStat(BatteryHealthMetric.ChargeSessions, chargeSessionsText(snapshot, locale)),
                    BatteryHealthStat(BatteryHealthMetric.EstRangeAdded, estRangeAddedText(snapshot, locale)),
                ),
        )

    /**
     * One battery pill for a raw [levelValue] (web `BatteryPill` receives `Math.round(level)`): the level is
     * rounded half-up (web `Math.round`), the band/percent/bar are all derived from that rounded value, and
     * a non-finite source is guarded to 0 (web `safeNumber`). [locale] groups the percentage (web `fmtInt`).
     */
    fun pill(
        kind: BatteryPillKind,
        levelValue: Double,
        locale: Locale,
    ): BatteryPillModel {
        val rounded = safe(levelValue).roundToLong()
        return BatteryPillModel(
            kind = kind,
            levelRounded = rounded,
            percentText = formatWhole(rounded + 0.0, locale) + PERCENT_SUFFIX,
            band = BatteryHealthColorBand.forLevel(rounded),
            barFraction = barFraction(rounded),
        )
    }

    /** Web `${fmtNumber(metrics.batteryEnd - metrics.batteryStart, 1)}%` — the raw (unrounded) difference. */
    fun avgChargeGainText(
        snapshot: BatteryHealthSnapshot,
        locale: Locale,
    ): String = ChartFormat.number(safe(snapshot.batteryEnd - snapshot.batteryStart), GAIN_DECIMALS, locale) + PERCENT_SUFFIX

    /** Web `fmtInt(metrics.chargingSessionCount)` — the grouped whole session count. */
    fun chargeSessionsText(
        snapshot: BatteryHealthSnapshot,
        locale: Locale,
    ): String = formatWhole(snapshot.chargingSessionCount + 0.0, locale)

    /** Web `${fmtNumber(metrics.chargeEnergyAdded * 5.5, 0)} km` — the whole-km range estimate. */
    fun estRangeAddedText(
        snapshot: BatteryHealthSnapshot,
        locale: Locale,
    ): String = formatWhole(safe(snapshot.chargeEnergyAdded * RANGE_KM_PER_ENERGY_UNIT), locale) + RANGE_UNIT_SUFFIX

    /** The proportional bar fill — web `width: ${Math.min(level, 100)}%`, clamped to `0f..1f`. */
    private fun barFraction(level: Long): Float = level.coerceIn(0L, BATTERY_BAR_FULL_PCT).toFloat() / BATTERY_BAR_DENOMINATOR

    /** Whole-number locale formatting — the native mirror of web `fmtInt` (`fmtNumber(v, 0)`). */
    private fun formatWhole(
        value: Double,
        locale: Locale,
    ): String = ChartFormat.number(value, WHOLE_DECIMALS, locale)

    /** Web `safeNumber(v)`: the value when finite, otherwise 0 (so a NaN never reaches the formatter). */
    private fun safe(value: Double): Double = if (value.isFinite()) value else 0.0
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [BatteryHealthSectionRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it
 * from its first-composition effect. Carries no VIN, location, or battery value — only the surface slug.
 */
fun recordBatteryHealthSectionOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to BatteryHealthSectionRegistration.SLUG))
}
