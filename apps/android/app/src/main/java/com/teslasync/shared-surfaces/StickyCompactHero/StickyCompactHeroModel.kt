// Pure, framework-free model + projection for the StickyCompactHero shared surface — the native analogue of
// the state the web bar derives before returning JSX (web/src/components/status/StickyCompactHero.tsx). No
// Compose, no Android UI, no HTTP: every type here is exercised by the :android:testReleaseUnitTest gate so the
// composable stays a thin render layer.
//
// The web `StickyCompactHero` is collapsed-on-scroll status chrome: a sticky bar that the parent renders only
// once the full `StatusHero` has scrolled out of view (an IntersectionObserver on the web; host-driven
// visibility on Android). It is purely presentational — it receives a [HeroStatus] (the same five-value union the
// web imports from `./StatusHero`), an optional last-checked label, and an optional refresh handler, and maps the
// status to an icon, a tone color, and a short headline. What this model reproduces is exactly those derivations:
// the status → tone projection (web `TEXT_FOR_STATUS`), the short headline selector (web `SHORT_HEADLINE`), and
// the freshness/error fold the platform's cache-then-network status feed adds on top.
//
// The web bar hard-codes its English headlines and aria labels; the native port routes every string through the
// P1/S10 catalog instead (no English literals in native code), so the labels live in [StickyCompactHeroStrings]
// (resolved at the render boundary) and the projection stays locale-stable.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/StickyCompactHero — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen is illegal in a package identifier), so the package intentionally diverges from the
// path. `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed for the co-located supporting types.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.stickycompacthero

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for this surface — the native mirror of the web component's contract. The
 * diagnostics [SLUG] is the surface slug the prompt mandates (`StickyCompactHero`), emitted with the one-shot
 * `view.opened` event (P1/S11); [ID] is the stable `viewModel` key the host binds the surface with.
 */
object StickyCompactHeroRegistration {
    /** Stable surface id (also the `viewModel` key the host binds the surface with). */
    const val ID: String = "sticky-compact-hero"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "StickyCompactHero"
}

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * The five at-a-glance instance states — the native port of the web `HeroStatus` union
 * (`'healthy' | 'degraded' | 'unhealthy' | 'unknown' | 'maintenance'`, imported from `./StatusHero`). Each value
 * drives the bar's icon, tone color, and short headline. [Unknown] is the honest "not yet known" value the bar
 * shows before/without a resolved status (web `SHORT_HEADLINE.unknown = 'Status unknown'`).
 */
enum class HeroStatus {
    Healthy,
    Degraded,
    Unhealthy,
    Unknown,
    Maintenance,
    ;

    companion object {
        /**
         * Parses a wire/string status into the enum — the cached → projection adapter the host uses when its
         * status feed carries the raw string union the web type models. An absent, blank, or unrecognized value
         * collapses to [Unknown] so an unwired or partial feed renders honestly rather than guessing a health.
         */
        fun fromRaw(raw: String?): HeroStatus =
            when (raw?.trim()?.lowercase()) {
                "healthy" -> Healthy
                "degraded" -> Degraded
                "unhealthy" -> Unhealthy
                "maintenance" -> Maintenance
                else -> Unknown
            }
    }
}

/**
 * The freshness envelope the bar flags over its (host-provided) status feed — folded from the bound feed's
 * [UiState] so a last-known status is never presented as live. [Live] shows no chip; [Stale] shows the stale chip
 * while a re-check runs over the cached status; [Offline] shows the offline chip when a status fetch failed but a
 * cached status is still served (web parity adds the honest-freshness contract the presentational bar lacks).
 */
enum class StickyCompactHeroFreshness { Live, Stale, Offline }

/**
 * Localized labels the surface folds into its output. Built from `stringResource` at the render boundary (tests
 * pass a deterministic instance), keeping [StickyCompactHeroProjection] a pure, locale-stable object. The web bar
 * hard-codes these strings; the native port resolves each through the P1/S10 catalog:
 *   • the five status headlines ← `translation_{Healthy,Degraded,Unhealthy,Unknown,Maintenance}` (the short
 *     status-name labels, the faithful native analogue of the web `SHORT_HEADLINE` map);
 *   • [regionLabel] ← `translation_Status` (the landmark that names the summary region, web `aria-label`);
 *   • [refresh] ← `translation_common_refresh` (the refresh control, web `aria-label="Refresh status"`);
 *   • [loading]/[stale]/[offline]/[retry]/[errorMessage] ← the shared freshness + error chrome keys.
 */
data class StickyCompactHeroStrings(
    val regionLabel: String,
    val healthy: String,
    val degraded: String,
    val unhealthy: String,
    val unknown: String,
    val maintenance: String,
    val refresh: String,
    val loading: String,
    val stale: String,
    val offline: String,
    val retry: String,
    val errorMessage: String,
) {
    /** The short headline for [status] — the native port of the web `SHORT_HEADLINE[status]` lookup. */
    fun headline(status: HeroStatus): String =
        when (status) {
            HeroStatus.Healthy -> healthy
            HeroStatus.Degraded -> degraded
            HeroStatus.Unhealthy -> unhealthy
            HeroStatus.Unknown -> unknown
            HeroStatus.Maintenance -> maintenance
        }

    /**
     * True when every accessibility-critical label is present (no blank landmark, control, or status copy ships).
     * The five headlines double as the clickable summary's spoken label, so each must be non-blank too.
     */
    val hasAccessibilityLabels: Boolean
        get() =
            regionLabel.isNotBlank() &&
                refresh.isNotBlank() &&
                healthy.isNotBlank() &&
                degraded.isNotBlank() &&
                unhealthy.isNotBlank() &&
                unknown.isNotBlank() &&
                maintenance.isNotBlank()
}

/**
 * Pure projection + selection logic for the StickyCompactHero surface — the native port of the web bar's
 * derivations (`TEXT_FOR_STATUS[status]` tone, `SHORT_HEADLINE[status]` headline) plus the freshness/error fold
 * the platform's cache-then-network status feed adds. Side-effect-free so the whole contract is unit-tested
 * off-device.
 */
object StickyCompactHeroProjection {
    private const val HTTP_UNAUTHORIZED = 401
    private const val HTTP_FORBIDDEN = 403
    private const val HTTP_NOT_FOUND = 404

    /**
     * The tone color for [status] — the native port of the web `TEXT_FOR_STATUS` map
     * (green/amber/red/zinc/blue ⇒ success/warning/danger/neutral/info). [StatusTone.Neutral] carries no semantic
     * health, exactly like the web `unknown` `text-zinc-400`.
     */
    fun tone(status: HeroStatus): StatusTone =
        when (status) {
            HeroStatus.Healthy -> StatusTone.Success
            HeroStatus.Degraded -> StatusTone.Warning
            HeroStatus.Unhealthy -> StatusTone.Danger
            HeroStatus.Unknown -> StatusTone.Neutral
            HeroStatus.Maintenance -> StatusTone.Info
        }

    /**
     * The status the bar renders for [state] — the resolved value when present, else [HeroStatus.Unknown] so the
     * bar shows the honest "status unknown" face rather than blanking (web `SHORT_HEADLINE.unknown`).
     */
    fun statusOf(state: UiState<HeroStatus>): HeroStatus = state.data ?: HeroStatus.Unknown

    /**
     * Maps the bound feed's [state] to the bar's [StickyCompactHeroFreshness] chip — honest freshness so a cached
     * status served after a stale TTL or a failed re-check is flagged, never shown as live.
     */
    fun freshness(state: UiState<*>): StickyCompactHeroFreshness =
        when {
            state.isOffline && state.errorKind != null -> StickyCompactHeroFreshness.Offline
            state.stale -> StickyCompactHeroFreshness.Stale
            else -> StickyCompactHeroFreshness.Live
        }

    /**
     * Maps the bound feed's hard-error [state] onto the shared [QueryErrorKind] recovery bucket so the bar's error
     * branch shows the right copy: an open breaker → [QueryErrorKind.Waiting]; a connectivity failure →
     * [QueryErrorKind.Network]; a 401/403 → [QueryErrorKind.Unauthorized]; a 404 → [QueryErrorKind.NotFound];
     * every other failure → [QueryErrorKind.ServerError].
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

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [StickyCompactHeroRegistration.SLUG]
 * (P1/S11) — never any health value, timestamp, or deployment identity, so a diagnostics line can never leak the
 * instance state. Kept free of Compose so it is unit-tested with a recording [Logger]; the ViewModel calls it
 * once per surface open.
 */
fun recordStickyCompactHeroOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to StickyCompactHeroRegistration.SLUG))
}
