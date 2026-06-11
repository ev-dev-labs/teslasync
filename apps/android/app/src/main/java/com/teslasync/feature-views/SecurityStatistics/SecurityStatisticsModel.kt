// Pure, framework-free model + projection for the SecurityStatistics feature view — the native analogue
// of everything the web component derives before returning JSX
// (web/src/features/admin/components/security-access/SecurityStatistics.tsx). No Compose, no Android, no
// HTTP: every declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer over these pure functions.
//
// The web component is purely presentational — its parent (the security & access admin page) computes the
// `SecurityStats` from the security-event history and passes it down with the `sentryUptime` percentage and
// an `isLoading` flag. This file owns the parts the web component expresses from those props: the lifecycle
// projection of (snapshot, isLoading) onto the shared cache-then-network [UiState] (so the surface renders
// every state the P1/S8 layer can carry), the ordered seven-metric value list with the web `fmtInt`
// formatting (incl. the Sentry-uptime "%" suffix), and the PII-safe `view.opened` diagnostic.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SecurityStatistics — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.securitystatistics

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, location, or
 * actor, so a diagnostics line can never leak vehicle identity or owner movement from this security panel.
 */
const val SECURITY_STATISTICS_SLUG: String = "SecurityStatistics"

/**
 * The aggregate security counters the panel renders — the native projection of the web `SecurityStats`
 * (web/src/features/admin/components/security-access/helpers.ts). Every field is a non-negative count
 * derived from the vehicle's security-event history by the parent before this surface is composed.
 */
data class SecurityStats(
    val lockEvents: Int,
    val doorOpenCount: Int,
    val windowOpenCount: Int,
    val homelinkCount: Int,
    val guestCount: Int,
    val total: Int,
)

/**
 * The render-ready content payload — the [stats] counters plus the separately-derived [sentryUptimePct]
 * (0–100). The web component receives `sentryUptime` as a sibling prop to `securityStats`; bundling them
 * lets the surface carry a single [UiState] data value while still feeding the Sentry-uptime tile.
 */
data class SecurityStatsSnapshot(
    val stats: SecurityStats,
    val sentryUptimePct: Double,
)

/**
 * The seven metric tiles the web component renders, in source order. Identity only — the localized label,
 * the line glyph, and the accent color are resolved at the Compose boundary, keeping this enum free of any
 * Android or i18n dependency so it stays unit-testable off-device.
 */
enum class SecurityMetric {
    LockEvents,
    SentryUptime,
    DoorOpens,
    WindowOpens,
    Homelink,
    GuestMode,
    TotalEvents,
}

/** One render-ready tile: its [metric] identity and the already-formatted [value] string. */
data class SecurityMetricValue(
    val metric: SecurityMetric,
    val value: String,
)

/**
 * Pure projection from the panel's inputs to its render state — a 1:1 port of the web component's branch
 * ladder and value formatting. Stateless and side-effect-free so it is fully covered by the off-device unit
 * gate; the composable only resolves localized strings, glyphs, and accents and draws what these return.
 */
object SecurityStatisticsProjection {
    /**
     * Maps the panel's `(snapshot, isLoading)` props onto the shared cache-then-network [UiState] (P1/S8),
     * reproducing the web component's three visible outcomes with its exact precedence
     * (`isLoading ? skeletons : securityStats ? cards : empty`):
     *  - loading → [UiPhase.Loading] (the web seven-skeleton grid; takes precedence even if a snapshot
     *    is already cached, matching the web ternary order);
     *  - not loading + snapshot present → [UiPhase.Content] (the web metric-card grid);
     *  - not loading + no snapshot → [UiPhase.Empty] (the web `EmptyState`).
     *
     * The host's stateful binding can additionally carry refreshing/stale/offline/error; the composable
     * renders those too. This parity adapter only produces the states the web `(snapshot, isLoading)` props
     * can express.
     */
    fun projectUiState(
        snapshot: SecurityStatsSnapshot?,
        isLoading: Boolean,
    ): UiState<SecurityStatsSnapshot> =
        when {
            isLoading -> UiState.loading()
            snapshot != null -> UiState(phase = UiPhase.Content, data = snapshot)
            else -> UiState(phase = UiPhase.Empty)
        }

    /**
     * The seven tile values in web source order, each already formatted with the web `fmtInt` rule. The
     * Sentry-uptime tile carries the trailing "%" exactly like the web `` `${fmtInt(sentryUptime)}%` ``;
     * every other tile is a plain grouped integer. [locale] drives the grouping/decimal symbols so the
     * output is locale-correct (the composable passes the device locale; tests pin one for determinism).
     */
    fun metricValues(
        snapshot: SecurityStatsSnapshot,
        locale: Locale,
    ): List<SecurityMetricValue> {
        val stats = snapshot.stats
        return listOf(
            SecurityMetricValue(SecurityMetric.LockEvents, formatCount(stats.lockEvents, locale)),
            SecurityMetricValue(SecurityMetric.SentryUptime, formatCount(snapshot.sentryUptimePct, locale) + "%"),
            SecurityMetricValue(SecurityMetric.DoorOpens, formatCount(stats.doorOpenCount, locale)),
            SecurityMetricValue(SecurityMetric.WindowOpens, formatCount(stats.windowOpenCount, locale)),
            SecurityMetricValue(SecurityMetric.Homelink, formatCount(stats.homelinkCount, locale)),
            SecurityMetricValue(SecurityMetric.GuestMode, formatCount(stats.guestCount, locale)),
            SecurityMetricValue(SecurityMetric.TotalEvents, formatCount(stats.total, locale)),
        )
    }

    /**
     * Locale-aware grouped integer formatter — the native mirror of the web `fmtInt` (`fmtNumber(v, 0)`).
     * Groups thousands and rounds half away from zero so the output matches ECMAScript `Intl.NumberFormat`
     * (`halfExpand`) rather than Java's default banker's rounding (HALF_EVEN), e.g. `12345.6 → "12,346"`.
     * Accepts any [Number] (the integer counts or the fractional Sentry-uptime percentage).
     */
    fun formatCount(
        value: Number,
        locale: Locale,
    ): String =
        DecimalFormat("#,##0", DecimalFormatSymbols(locale))
            .apply { roundingMode = RoundingMode.HALF_UP }
            .format(value)
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SECURITY_STATISTICS_SLUG] (P1/S11).
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
fun recordSecurityStatisticsOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SECURITY_STATISTICS_SLUG))
}
