// Pure, framework-free model + projection for the HealthRecommendations feature view — the native analogue
// of everything the web component derives before returning JSX
// (web/src/features/driving/components/drivetrain-health/HealthRecommendations.tsx). No Compose, no Android,
// no HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping
// the composable a thin render layer.
//
// HealthRecommendations is a purely presentational, prop-driven surface. The web component takes a single
// `overallHealth` prop (`'good' | 'warning' | 'critical'`) — computed upstream by the drivetrain-health page
// from the live motor/thermal signals — and `useMemo`s an ordered list of advisory tips from it. Its only
// other dependency is `useTranslation` (the P1/S10 i18n catalog). It binds NO data hook of its own, so — as
// with the sibling HighlightCard port — there is no loading / error / stale / offline lifecycle to model here
// (that belongs to the owning page; inventing it would be drift the spec does not have). What the web source
// genuinely varies is the recommendation list as a function of `overallHealth`, and that is exactly what this
// projection reproduces and the tests exercise. The list is NEVER empty: the four low-priority baseline tips
// are appended unconditionally, so an "empty" branch cannot occur and the panel is never a blank box.
//
// The web `Recommendation` carries a React list `key`, the resolved `text`, and a `priority`. Here the stable
// identity + priority live in [HealthRecommendation] (pure, testable), and the localized text is resolved at
// the Compose render boundary via the P1/S10 i18n facade (stringResource) — never stored in this layer, so no
// English literal lives in the model.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/HealthRecommendations — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling HighlightCard / BatteryHealthSection surfaces
// do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.healthrecommendations

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Overall drivetrain-health classification — the native analogue of the web `HealthStatus` union
 * (`'good' | 'warning' | 'critical'`, from `drivetrain-health/constants.ts`). The web value is computed
 * upstream and threaded in as the `overallHealth` prop; this surface only reads it to select which advisory
 * tips to show.
 */
enum class HealthStatus {
    Good,
    Warning,
    Critical,
    ;

    companion object {
        /**
         * Maps a raw `overallHealth` string to its [HealthStatus]. The web keys are exact lowercase; an absent
         * (`null`) or unrecognised value folds to [Good] — the least-alarming, baseline-only classification, so
         * an upstream glitch degrades to "show the universal tips" rather than fabricating a critical alert.
         */
        fun fromRaw(value: String?): HealthStatus =
            when (value) {
                "good" -> Good
                "warning" -> Warning
                "critical" -> Critical
                else -> Good
            }
    }
}

/**
 * The urgency tier of a recommendation — the native mirror of the web `Recommendation.priority`
 * (`'high' | 'medium' | 'low'`). Drives the row's accent color and leading glyph at the render boundary
 * (high → danger + alert, medium → warning + alert, low → info + trending-up).
 */
enum class RecommendationPriority {
    High,
    Medium,
    Low,
}

/**
 * A single drivetrain-health recommendation — the stable identity ([listKey]), its i18n key ([i18nKey]), and
 * its [priority]. Mirrors the nine `t('drivetrain.tips.*', …)` tips the web component can emit. The enum
 * constant order is the canonical web declaration order so callers can rely on it; [HealthRecommendationsProjection]
 * selects and orders the subset shown for a given [HealthStatus].
 *
 * @property listKey the web React list `key` (e.g. `"critical-stop"`) — a stable, locale-independent id used
 *   as the Compose list key and in tests, exactly as on the web.
 * @property i18nKey the P1/S10 catalog key whose value the composable resolves for the tip text
 *   (e.g. `drivetrain.tips.criticalStop`). The text itself is never stored here (no English literal in code).
 * @property priority the urgency tier driving the row's accent + glyph.
 */
enum class HealthRecommendation(
    val listKey: String,
    val i18nKey: String,
    val priority: RecommendationPriority,
) {
    CriticalStop("critical-stop", "drivetrain.tips.criticalStop", RecommendationPriority.High),
    ServiceUrgent("service-urgent", "drivetrain.tips.serviceUrgent", RecommendationPriority.High),
    ReduceLoad("reduce-load", "drivetrain.tips.reduceLoad", RecommendationPriority.Medium),
    CheckCoolant("check-coolant", "drivetrain.tips.checkCoolant", RecommendationPriority.Medium),
    AvoidSupercharging("avoid-supercharging", "drivetrain.tips.avoidSupercharging", RecommendationPriority.Medium),
    RegularService("regular-service", "drivetrain.tips.regularService", RecommendationPriority.Low),
    GentleAccel("gentle-accel", "drivetrain.tips.gentleAccel", RecommendationPriority.Low),
    Precondition("precondition", "drivetrain.tips.precondition", RecommendationPriority.Low),
    MonitorTemps("monitor-temps", "drivetrain.tips.monitorTemps", RecommendationPriority.Low),
}

/**
 * Pure projection from the surface's only input ([HealthStatus]) to its ordered recommendation list — a 1:1
 * port of the web component's `useMemo` body. Reproduces the exact branch order:
 *
 *   1. critical → critical-stop, service-urgent (high)
 *   2. warning OR critical → reduce-load, check-coolant, avoid-supercharging (medium)
 *   3. always → regular-service, gentle-accel, precondition, monitor-temps (low)
 *
 * so the same input always yields the same list, in the same order, as the web. Stateless and Compose-free.
 */
object HealthRecommendationsProjection {
    /**
     * Build the ordered recommendation list for [health], mirroring the web `useMemo`. The four low-priority
     * baseline tips are always appended last, so the result is never empty (size 4 for [HealthStatus.Good],
     * 7 for [HealthStatus.Warning], 9 for [HealthStatus.Critical]).
     */
    fun recommendationsFor(health: HealthStatus): List<HealthRecommendation> =
        buildList {
            if (health == HealthStatus.Critical) {
                add(HealthRecommendation.CriticalStop)
                add(HealthRecommendation.ServiceUrgent)
            }
            if (health == HealthStatus.Warning || health == HealthStatus.Critical) {
                add(HealthRecommendation.ReduceLoad)
                add(HealthRecommendation.CheckCoolant)
                add(HealthRecommendation.AvoidSupercharging)
            }
            add(HealthRecommendation.RegularService)
            add(HealthRecommendation.GentleAccel)
            add(HealthRecommendation.Precondition)
            add(HealthRecommendation.MonitorTemps)
        }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the health
 * classification or any tip text — so a diagnostics line can never leak vehicle state.
 */
object HealthRecommendationsDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "HealthRecommendations"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
