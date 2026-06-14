// Pure, framework-free model + projection for the UptimeHeatmap shared surface — the native analogue of the
// state the web component derives before returning JSX (web/src/components/status/UptimeHeatmap.tsx). No
// Compose, no Android UI, no HTTP: every type here is exercised by the :android:testReleaseUnitTest gate so
// the composable stays a thin render layer.
//
// The web `UptimeHeatmap` is a rolling N-day status grid: one square per day (oldest on the left) colored by
// that day's [UptimeStatus], a hover/tap popover revealing the day's status + optional summary, a heading,
// and a caption showing the overall uptime % across the window. It is purely presentational — its single
// data source is the caller-supplied `days` array (some callers synthesize it: today = current status, prior
// days = healthy by default, until day-by-day health history is available). This model reproduces exactly
// what the web component DERIVES from those props: the uptime-percentage fold
// (`(healthy + maintenance) / total`), the percentage's threshold tone (web `>=99` green / `>=95` amber /
// else red), the per-status label + tone maps, and the structurally-empty predicate (an empty window).
//
// The window is carried through the surface as a cache-then-network [io.teslasync.shared.core.data.repo.Resource]
// (ADR-013) so the prompt's loading/content/empty/error/stale/offline state matrix folds out of the same
// contract every other surface uses — the host feeds the window (the native `days` prop), and the freshness
// envelope flags last-known/offline values honestly instead of presenting them as live.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/UptimeHeatmap — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen is illegal in a package identifier), so the package intentionally diverges from
// the path. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.uptimeheatmap

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import java.util.Locale

/**
 * The per-day status a heatmap square encodes — the native port of the web `HeroStatus`
 * (`'healthy' | 'degraded' | 'unhealthy' | 'unknown' | 'maintenance'`, web
 * `components/status/StatusHero.tsx`). [isUp] folds the two states the web counts toward uptime
 * (`d.status === 'healthy' || d.status === 'maintenance'`).
 */
enum class UptimeStatus {
    Healthy,
    Degraded,
    Unhealthy,
    Unknown,
    Maintenance,
    ;

    /** True when the day counts as "up" for the uptime-% fold (web `healthy || maintenance`). */
    val isUp: Boolean
        get() = this == Healthy || this == Maintenance
}

/**
 * One day in the rolling window — the native port of the web `UptimeDay`.
 *
 * @property date the ISO date (yyyy-mm-dd) the square represents (web `date`); also the popover title.
 * @property status the day's resolved [UptimeStatus] (web `status`) — drives the square color + label.
 * @property summary an optional short description shown inside the popover (web `summary`).
 */
data class UptimeDay(
    val date: String,
    val status: UptimeStatus,
    val summary: String? = null,
)

/**
 * The surface's single data payload — the native port of the web component's props (`days`, `title`,
 * `footnote`). The host feeds it through the bound state-holder (the native `days` prop); the view never
 * fetches it. An empty [days] is the structurally-empty branch (web renders the heading with no squares and
 * no uptime badge).
 *
 * @property days the rolling window, oldest first (web `days`, rendered left-to-right).
 * @property title an optional heading override (web `title`); `null` ⇒ the default "Uptime — last N days".
 * @property footnote optional caption beneath the squares (web `footnote`).
 */
data class UptimeWindow(
    val days: List<UptimeDay>,
    val title: String? = null,
    val footnote: String? = null,
)

/**
 * The percentage's threshold tone — the native port of the web caption's color rules
 * (`uptimePct >= 99 ? green : uptimePct >= 95 ? amber : red`). Kept as a pure enum so the threshold logic is
 * unit-tested off-device and the view maps it to a theme color at the render boundary.
 */
enum class UptimePctTone { Good, Warn, Bad }

/**
 * The freshness envelope the shell flags over its (host-fed) window — folded from the bound feed's
 * [UiState] so a last-known window is never presented as live. [Live] shows no chip; [Stale] shows the stale
 * chip while a refresh runs over the cached window; [Offline] shows the offline chip when a refresh failed
 * but the cached window is still served. The surface's `role="status" aria-live="polite"` region announces
 * the transition (web parity).
 */
enum class UptimeHeatmapFreshness { Live, Stale, Offline }

/**
 * Canonical registry metadata for this surface — the native mirror of the web component's contract. The
 * diagnostics slug and the freshness window are pinned here so the native and web shells stay in lockstep.
 */
object UptimeHeatmapRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "UptimeHeatmap"

    /** Decimal places the uptime caption renders (web `fmtPercent(uptimePct, 2)`). */
    const val UPTIME_DECIMALS: Int = 2

    /** Uptime-% at or above which the caption is "healthy/good" toned (web `>= 99`). */
    const val GOOD_THRESHOLD: Double = 99.0

    /** Uptime-% at or above which the caption is "warning" toned (web `>= 95`); below ⇒ "bad". */
    const val WARN_THRESHOLD: Double = 95.0
}

/**
 * Localized chrome labels the surface folds into its output. Built from `stringResource` at the render
 * boundary (tests pass a deterministic instance), keeping [UptimeHeatmapProjection] a pure, locale-stable
 * object. The web component hardcodes these strings; the native port routes every one through the P1/S10
 * catalog (no English literal ships in native code).
 *
 * @property titleTemplate the default heading template with a `%1$s` day-count slot (web `Uptime — last N days`).
 * @property uptimeTemplate the caption template with a `%1$s` percentage slot (web `{pct} uptime`).
 * @property listLabel the squares grid's accessibility label (web `aria-label="Daily status history"`).
 * @property dayLabelTemplate the per-square label template, `%1$s` = date, `%2$s` = status (web `${date}: ${label}`).
 * @property surfaceLabel the panel's root accessibility label (web `role="status"` landmark).
 * @property statusLabels the per-[UptimeStatus] label (web `STATUS_LABEL`).
 * @property emptyTitle / [emptyMessage] the friendly empty-state copy (web shows an empty grid; the prompt
 *   mandates a non-blank empty surface).
 * @property resourceName personalizes the shared QueryError on a hard failure.
 * @property stale / [offline] the freshness-chip labels (reused common catalog keys).
 * @property loadingLabel the loading region's accessibility label (reused common catalog key).
 */
data class UptimeHeatmapStrings(
    val titleTemplate: String,
    val uptimeTemplate: String,
    val listLabel: String,
    val dayLabelTemplate: String,
    val surfaceLabel: String,
    val statusLabels: Map<UptimeStatus, String>,
    val emptyTitle: String,
    val emptyMessage: String,
    val resourceName: String,
    val stale: String,
    val offline: String,
    val loadingLabel: String,
) {
    /** The label for [status], falling back to the [UptimeStatus.Unknown] copy then an em dash. */
    fun statusLabel(status: UptimeStatus): String = statusLabels[status] ?: statusLabels[UptimeStatus.Unknown] ?: "—"

    /** The default heading for a [days]-long window (web `title ?? "Uptime — last ${days.length} days"`). */
    fun heading(days: Int): String = titleTemplate.format(days)

    /** The uptime caption for a formatted [percent] string (web `{fmtPercent(pct, 2)} uptime`). */
    fun uptimeCaption(percent: String): String = uptimeTemplate.format(percent)

    /** The per-square accessibility label (web `aria-label={`${date}: ${label}`}`). */
    fun dayLabel(
        date: String,
        status: UptimeStatus,
    ): String = dayLabelTemplate.format(date, statusLabel(status))

    /**
     * True when every accessibility-critical label is present (no blank list/landmark/day copy ships). Each
     * status must carry a genuine (non-fallback) label so a square is never announced anonymously.
     */
    val hasAccessibilityLabels: Boolean
        get() =
            surfaceLabel.isNotBlank() &&
                listLabel.isNotBlank() &&
                dayLabelTemplate.isNotBlank() &&
                UptimeStatus.entries.all { statusLabels[it]?.isNotBlank() == true }
}

/**
 * Pure projection + selection logic for the UptimeHeatmap surface — the native port of the web component's
 * derivations (the `useMemo` uptime-% fold, the caption's threshold tone, the empty-window predicate, and
 * the freshness fold). Side-effect-free so the whole contract is unit-tested off-device.
 */
object UptimeHeatmapProjection {
    private const val HTTP_UNAUTHORIZED = 401
    private const val HTTP_FORBIDDEN = 403
    private const val HTTP_NOT_FOUND = 404
    private const val PERCENT_MAX = 100.0

    /**
     * The overall uptime percentage across [days] — the native port of the web `useMemo`:
     * `days.length === 0 ? null : (healthy + maintenance) / days.length * 100`. Returns `null` for an empty
     * window so the caller hides the caption (web hides the badge when `uptimePct == null`).
     */
    fun uptimePercent(days: List<UptimeDay>): Double? {
        if (days.isEmpty()) return null
        val up = days.count { it.status.isUp }
        return up * PERCENT_MAX / days.size
    }

    /**
     * The caption tone for [percent] — the native port of the web color rules
     * (`>= 99` good / `>= 95` warn / else bad).
     */
    fun pctTone(percent: Double): UptimePctTone =
        when {
            percent >= UptimeHeatmapRegistration.GOOD_THRESHOLD -> UptimePctTone.Good
            percent >= UptimeHeatmapRegistration.WARN_THRESHOLD -> UptimePctTone.Warn
            else -> UptimePctTone.Bad
        }

    /**
     * Formats [percent] like the web `fmtPercent(uptimePct, 2)` — a fixed-[decimals] number plus `%`, in the
     * supplied [locale] (defaults to [Locale.US] for deterministic tests; the view passes the active locale).
     */
    fun formatPercent(
        percent: Double,
        locale: Locale = Locale.US,
        decimals: Int = UptimeHeatmapRegistration.UPTIME_DECIMALS,
    ): String = String.format(locale, "%.${decimals.coerceAtLeast(0)}f%%", percent)

    /**
     * The structurally-empty predicate for the window — an empty [UptimeWindow.days] is the "no value to
     * show" branch (web renders the heading with no squares), surfaced as a friendly empty state rather than
     * a blank panel per the prompt's states contract.
     */
    fun isEmpty(window: UptimeWindow): Boolean = window.days.isEmpty()

    /**
     * Maps the bound feed's [state] to the shell's [UptimeHeatmapFreshness] chip — honest freshness so a
     * cached window served after a stale TTL or a failed refresh is flagged, never shown as live.
     */
    fun freshness(state: UiState<*>): UptimeHeatmapFreshness =
        when {
            state.isOffline && state.errorKind != null -> UptimeHeatmapFreshness.Offline
            state.stale -> UptimeHeatmapFreshness.Stale
            else -> UptimeHeatmapFreshness.Live
        }

    /**
     * Maps the bound feed's hard-error [state] onto the shared [QueryErrorKind] recovery bucket so the
     * surface's error branch shows the right copy: an open breaker → [QueryErrorKind.Waiting]; a connectivity
     * failure → [QueryErrorKind.Network]; a 401/403 → [QueryErrorKind.Unauthorized]; a 404 →
     * [QueryErrorKind.NotFound]; every other failure → [QueryErrorKind.ServerError] with a retry.
     */
    fun queryErrorKind(state: UiState<*>): QueryErrorKind =
        when (state.errorKind) {
            ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
            ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
            ErrorKind.Http ->
                when (state.httpStatus) {
                    HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
                    HTTP_NOT_FOUND -> QueryErrorKind.NotFound
                    else -> QueryErrorKind.ServerError
                }
            ErrorKind.Decode, ErrorKind.Unknown, null -> QueryErrorKind.ServerError
        }
}
