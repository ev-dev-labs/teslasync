// Pure, framework-free model + projection for the BatteryPill feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/analytics/components/weekly-digest/BatteryPill.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// BatteryPill is a purely presentational surface — the web component takes its `level` and `label` as
// props from the weekly-digest BatteryHealthSection that owns the TanStack query (the section rounds the
// level and resolves the label through its own `t()` call), so this surface binds NO data hook and makes
// NO `t()` call of its own. As in the sibling AchievementBadge / StatusHeader ports, the cache-then-network
// lifecycle (loading / error / stale / offline) lives on the owning page, not here; modelling those phases
// would invent behaviour the spec does not have (drift). The branches the web source actually defines — the
// level→color band (`level >= 60` good, `level >= 30` warning, else critical) and the `min(level, 100)` bar
// fill — are the complete state set this surface renders, and each is projected here.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/BatteryPill — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling AchievementBadge / StatusHeader surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.batterypill

import io.teslasync.shared.core.diagnostics.Logger
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale

/**
 * The battery state-of-charge band — the native analogue of the web ternary that selects the pill color
 * from `STATUS_COLORS` (web/src/lib/colors.ts): `level >= 60 ? good : level >= 30 ? warning : critical`.
 * The composable maps each band onto the per-theme `TeslaTokens.status` palette (P1/S9), whose
 * success/warning/danger values are exactly the web `#10b981` / `#f59e0b` / `#ef4444` hexes.
 */
enum class BatteryStatus {
    Good,
    Warning,
    Critical,
    ;

    companion object {
        /** Web `level >= 60`: at or above this the charge is healthy (green). */
        const val GOOD_THRESHOLD: Double = 60.0

        /** Web `level >= 30`: at or above this (but below [GOOD_THRESHOLD]) the charge is a warning (amber). */
        const val WARNING_THRESHOLD: Double = 30.0

        /**
         * Classify a 0–100 [level] into its band. The comparisons are inclusive (`>=`), matching the web
         * ternary, so the exact threshold values land in the higher band.
         */
        fun fromLevel(level: Double): BatteryStatus =
            when {
                level >= GOOD_THRESHOLD -> Good
                level >= WARNING_THRESHOLD -> Warning
                else -> Critical
            }
    }
}

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property level the raw 0–100 state of charge (web `level`); rendered as the `{fmtInt(level)}%` value.
 * @property status the color band (web `STATUS_COLORS` ternary) driving the icon, value, and bar tint.
 * @property barFraction the meter fill as a 0..1 fraction — the web `Math.min(level, 100)%` width, also
 *   clamped at the low end so a negative level renders an empty bar instead of a negative width.
 */
data class BatteryPillDisplay(
    val level: Double,
    val status: BatteryStatus,
    val barFraction: Float,
)

/**
 * Pure projection from a raw [Double] level to its render-ready [BatteryPillDisplay] — a 1:1 port of the two
 * derivations the web component performs (the `STATUS_COLORS` color band and the `Math.min(level, 100)` bar
 * width) before returning JSX.
 */
object BatteryPillProjection {
    private const val BAR_MIN: Double = 0.0
    private const val BAR_MAX: Double = 100.0
    private const val PERCENT_SUFFIX: String = "%"

    /** Select the render-ready view for [level]. */
    fun project(level: Double): BatteryPillDisplay =
        BatteryPillDisplay(
            level = level,
            status = BatteryStatus.fromLevel(level),
            barFraction = (level.coerceIn(BAR_MIN, BAR_MAX) / BAR_MAX).toFloat(),
        )

    /**
     * The value text the web renders, `${fmtInt(level)}%` (web/src/lib/numberFormat.ts): the level rounded
     * to a whole number with locale-aware grouping separators, then a literal percent sign. Mirrors
     * `fmtInt`'s `safeNumber` guard (a non-finite value formats as `0`) and its locale-grouped, zero-fraction
     * output; the rounding mode is HALF_UP so ties round away from zero like JavaScript's `toLocaleString`.
     */
    fun percentLabel(
        level: Double,
        locale: Locale,
    ): String {
        val safe = if (level.isFinite()) level else 0.0
        val formatter =
            NumberFormat.getIntegerInstance(locale).apply {
                roundingMode = RoundingMode.HALF_UP
            }
        return formatter.format(safe) + PERCENT_SUFFIX
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the
 * battery level or label — so a diagnostics line can never leak a user's charge posture.
 */
object BatteryPillDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "BatteryPill"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
