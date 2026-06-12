// Pure, framework-free model + projection for the HealthOverview feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/driving/components/drivetrain-health/HealthOverview.tsx). No Compose, no Android, no
// HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping
// the composable a thin render layer.
//
// HealthOverview is a purely presentational surface — the web component takes its `overallHealth`,
// `healthScore`, and `motorStatus` as props from the owning drivetrain-health page (which owns the TanStack
// query and derives the health band), so this surface binds NO data hook of its own; its only web hook is
// `useTranslation`. As in the sibling BatteryPill / StatusHeader ports, the cache-then-network lifecycle
// (loading / error / stale / offline) lives on the owning page, not here; modelling those phases would
// invent behaviour the web source does not have (drift). The branches the web source actually defines — the
// `overallHealth !== 'good'` alert gate and the good / warning / critical styling fork that drives the icon,
// title, badge, and panel accent — are the complete state set this surface renders, and each is projected
// here. The lone null-safety addition is the blank-`motorStatus` fallback to an em dash, so the motor line
// is never a dangling "Motor State:".
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/HealthOverview — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling BatteryPill / StatusHeader surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.healthoverview

import io.teslasync.shared.core.diagnostics.Logger
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale

/**
 * The drivetrain health band — the native analogue of the web `HealthStatus` string union
 * (`'good' | 'warning' | 'critical'`, web .../drivetrain-health/constants.ts). The composable maps each
 * band onto the per-theme `TeslaTokens.status` palette (P1/S9) and the matching i18n labels (P1/S10):
 * `good` is the only state without an alert, `warning` raises the amber "running warm" notice, and
 * `critical` raises the red "overheating" notice.
 */
enum class HealthStatus {
    Good,
    Warning,
    Critical,
    ;

    /** The lower-case wire token (web string-union value) for this band; the inverse of [fromToken]. */
    val token: String
        get() =
            when (this) {
                Good -> GOOD_TOKEN
                Warning -> WARNING_TOKEN
                Critical -> CRITICAL_TOKEN
            }

    companion object {
        const val GOOD_TOKEN: String = "good"
        const val WARNING_TOKEN: String = "warning"
        const val CRITICAL_TOKEN: String = "critical"

        /**
         * Parse the web string-union [token] (case- and whitespace-insensitive) into a band. An
         * unrecognised value resolves to [Critical] so an unknown health posture fails safe — it surfaces
         * the alert rather than silently presenting a green "all healthy" panel.
         */
        fun fromToken(token: String): HealthStatus =
            when (token.trim().lowercase(Locale.ROOT)) {
                GOOD_TOKEN -> Good
                WARNING_TOKEN -> Warning
                CRITICAL_TOKEN -> Critical
                else -> Critical
            }
    }
}

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property overallHealth the health band driving the icon, title, badge, panel accent, and alert fork
 *   (web `overallHealth`).
 * @property healthScore the 0–100 condition rating rendered as the count-up `${healthScore}%` value
 *   (web `healthScore`, shown through `AnimatedNumber`).
 * @property motorStatusLabel the motor-state value shown after the "Motor State:" label — the raw web
 *   `motorStatus`, or an em dash when it is blank so the line is never left dangling (null-safety).
 * @property showAlert whether the temperature [AlertBanner] renders — web `overallHealth !== 'good'`, so it
 *   appears for both the warning and critical bands and is withheld when healthy.
 */
data class HealthOverviewDisplay(
    val overallHealth: HealthStatus,
    val healthScore: Double,
    val motorStatusLabel: String,
    val showAlert: Boolean,
)

/**
 * Pure projection from the surface's three props to its render-ready [HealthOverviewDisplay] — a 1:1 port of
 * the derivations the web component performs (the `overallHealth !== 'good'` alert gate and the motor-state
 * line) — plus the locale-aware integer formatter the web renders the score through (`AnimatedNumber` with
 * zero decimals, i.e. `Intl.NumberFormat` with no fraction digits).
 */
object HealthOverviewProjection {
    private const val EM_DASH: String = "\u2014"
    private const val PERCENT_SUFFIX: String = "%"

    /**
     * Select the render-ready view for the given props. A blank [motorStatus] collapses to an em dash so the
     * motor line always reads cleanly (web renders the raw value); every other field is carried verbatim.
     */
    fun project(
        overallHealth: HealthStatus,
        healthScore: Double,
        motorStatus: String,
    ): HealthOverviewDisplay =
        HealthOverviewDisplay(
            overallHealth = overallHealth,
            healthScore = healthScore,
            motorStatusLabel = motorStatus.ifBlank { EM_DASH },
            showAlert = overallHealth != HealthStatus.Good,
        )

    /**
     * The score text the web renders, `${healthScore}%` through `AnimatedNumber` — the score rounded to a
     * whole number with locale-aware grouping separators, then a literal percent sign. Mirrors the shared
     * `safeNumber` guard (a non-finite value formats as `0`) and uses HALF_UP rounding so ties round away
     * from zero like JavaScript's `toLocaleString`. Used for the surface's stable accessibility label (so
     * TalkBack announces the settled value rather than the count-up) and as the deterministic test oracle.
     */
    fun scorePercentLabel(
        score: Double,
        locale: Locale,
    ): String {
        val safe = if (score.isFinite()) score else 0.0
        val formatter =
            NumberFormat.getIntegerInstance(locale).apply {
                roundingMode = RoundingMode.HALF_UP
            }
        return formatter.format(safe) + PERCENT_SUFFIX
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the
 * health band, the score, or the motor status — so a diagnostics line can never leak the vehicle's
 * drivetrain posture.
 */
object HealthOverviewDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "HealthOverview"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
