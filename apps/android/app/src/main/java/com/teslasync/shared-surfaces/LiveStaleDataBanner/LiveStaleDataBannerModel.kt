// Pure, framework-free model + projection + diagnostics for the LiveStaleDataBanner shared surface — the native
// analogue of web/src/components/feedback/LiveStaleDataBanner.tsx. No Compose, no Android framework, no HTTP:
// every declaration here is exercised off-device in the :android:testReleaseUnitTest gate, keeping the composable
// a thin render layer.
//
// What the web source IS (and therefore the COMPLETE branch set this surface reproduces): a page-level companion
// to <LiveIndicator>. It reads `useLiveConnection()` and shows an in-flow <AlertBanner variant="warning"> ONLY
// once the live wire has been `disconnected` continuously for longer than two minutes; for every other status —
// and for a disconnection still inside the two-minute window — it renders nothing (`if (!show) return null`). The
// web logic is precisely: stamp `disconnectedSinceRef` the first moment the status is observed as `disconnected`,
// promote to visible once `Date.now() - disconnectedSinceRef >= 2min` (a `setTimeout` fires at the boundary), and
// clear the stamp + hide on any non-disconnected status. When visible it draws the WifiOff icon, the
// `live.staleBanner.title` ("Live data unavailable"), and the `live.staleBanner.message` body.
//
// How that maps onto the native shared state-holder layer (P1/S8, ADR-002/009): the surface binds the app-scoped
// live pipeline (io.teslasync.android.data.live.LiveSessionStore — the native `useLiveConnection` port) through
// [LiveStaleDataBannerSource], folding each wire-health status onto the PII-free [StaleBannerState] the composable
// renders. The web `disconnectedSinceRef` becomes [StaleBannerState.disconnectedSinceMillis], stamped by [fold]
// from an injected clock the first instant the status is [LiveConnectionStatus.Disconnected] and cleared on any
// recovery — a faithful, fully-unit-tested port of the ref + threshold timer. The web string union value
// `'disconnected'` maps to [LiveConnectionStatus.Disconnected] (a wire that was up and is now closed); a cold
// start that never connected is [LiveConnectionStatus.Unknown], which — like the web `unknown` — keeps the banner
// hidden.
//
// Why the generic data-surface states (loading / empty / error / stale / offline) are NOT literal, separate
// renders here: the web component is a CONDITIONAL warning banner, not a data panel. It fetches nothing, lists
// nothing, and has exactly two visual outcomes — hidden, or the one amber outage banner. Inventing a skeleton, an
// empty row, or a retry surface would be drift from the spec (honesty covenant: no scope narrowing, no silent
// drift). The prompt's state vocabulary is honoured by the states the web source ACTUALLY has:
//   • loading / cold-start  → [LiveConnectionStatus.Unknown] (never connected) ⇒ hidden, exactly as web `unknown`;
//   • healthy / reconnecting → [LiveConnectionStatus.Connected] / [LiveConnectionStatus.Reconnecting] ⇒ hidden;
//   • offline / error / stale → [LiveConnectionStatus.Disconnected] sustained past the two-minute window ⇒ the
//     single amber "Live data unavailable" banner the web renders. The owning page that DOES fetch renders its own
//     loading / empty / error surfaces; this banner only annotates that page when its live wire has gone away.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/LiveStaleDataBanner — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling LiveIndicator surface does.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.livestaledatabanner

import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.shared.core.diagnostics.Logger

/**
 * The sustained-disconnection window before the banner appears — the native mirror of the web
 * `STALE_BANNER_THRESHOLD_MS` (`2 * 60_000`). The wire must be observed `disconnected` continuously for at least
 * this long before the warning is promoted to visible, so a transient reconnect never flaps the banner.
 */
const val STALE_BANNER_THRESHOLD_MILLIS: Long = 2 * 60_000L

/**
 * Canonical registry metadata for the LiveStaleDataBanner surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`LiveStaleDataBanner`).
 */
object LiveStaleDataBannerRegistration {
    /** Stable surface id (also the `viewModel` key the host binds the banner with). */
    const val ID: String = "live-stale-data-banner"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "LiveStaleDataBanner"
}

/**
 * The PII-free fold of the live pipeline the banner reasons about — it carries no vehicle id and no signal
 * payload, only the wire-health status and the client clock the wire was first observed disconnected. Folded from
 * [LiveConnectionStatus] by [LiveStaleDataBannerProjection.fold].
 *
 * @property status the latest wire health (web `useLiveConnection().status`).
 * @property disconnectedSinceMillis the client clock the wire was first observed [LiveConnectionStatus.Disconnected]
 *   in the current outage, or `null` whenever the wire is not disconnected — the native mirror of the web
 *   `disconnectedSinceRef`.
 */
data class StaleBannerState(
    val status: LiveConnectionStatus,
    val disconnectedSinceMillis: Long?,
) {
    companion object {
        /** The initial, pre-collection fold: a cold start that has never connected (web `unknown`) ⇒ hidden. */
        fun initial(): StaleBannerState = StaleBannerState(status = LiveConnectionStatus.Unknown, disconnectedSinceMillis = null)
    }
}

/**
 * The fully-resolved render decision the composable paints — the native mirror of the web `if (!show) return null`
 * gate. The banner has no other configurable surface, so a single [visible] flag is the entire render contract.
 *
 * @property visible whether the amber "Live data unavailable" banner is shown (web `show`); `false` ⇒ the
 *   composable emits nothing, exactly as the web component returns `null`.
 */
data class StaleBannerRender(
    val visible: Boolean,
)

/**
 * Pure projection of the live wire health into the banner's fold + render decision — the native mirror of every
 * decision the web `LiveStaleDataBanner` makes between `useLiveConnection` and the rendered (or absent) banner.
 * Framework-free so the whole contract is covered by the JVM unit gate without a Compose host.
 */
object LiveStaleDataBannerProjection {
    /**
     * Folds the latest wire [status] into [prev], stamping [StaleBannerState.disconnectedSinceMillis] with
     * [nowMillis] the first instant the wire is observed [LiveConnectionStatus.Disconnected] and preserving that
     * stamp while it stays disconnected — the native mirror of the web effect setting `disconnectedSinceRef` once
     * and leaving it. Any non-disconnected status clears the stamp (web `disconnectedSinceRef.current = null`), so
     * a later outage re-stamps from scratch and the two-minute window restarts.
     */
    fun fold(
        prev: StaleBannerState,
        status: LiveConnectionStatus,
        nowMillis: Long,
    ): StaleBannerState =
        if (status == LiveConnectionStatus.Disconnected) {
            StaleBannerState(status = status, disconnectedSinceMillis = prev.disconnectedSinceMillis ?: nowMillis)
        } else {
            StaleBannerState(status = status, disconnectedSinceMillis = null)
        }

    /**
     * Decides whether the banner is visible at wall-clock [nowMillis] — the native mirror of the web `show`
     * computation. Visible only while the wire is [LiveConnectionStatus.Disconnected] AND it has stayed so for at
     * least [STALE_BANNER_THRESHOLD_MILLIS]; every other status, and a disconnection still inside the window,
     * resolves to hidden.
     */
    fun render(
        state: StaleBannerState,
        nowMillis: Long,
    ): StaleBannerRender {
        val since = state.disconnectedSinceMillis
        val disconnected = state.status == LiveConnectionStatus.Disconnected
        val visible = disconnected && since != null && nowMillis - since >= STALE_BANNER_THRESHOLD_MILLIS
        return StaleBannerRender(visible = visible)
    }

    /**
     * Milliseconds remaining before a current disconnection crosses the window and the banner appears, floored at
     * zero — the native mirror of the web `STALE_BANNER_THRESHOLD_MS - elapsed` the `setTimeout` waits. Returns the
     * full [STALE_BANNER_THRESHOLD_MILLIS] when the wire is not disconnected (no countdown is running).
     */
    fun remainingMillis(
        state: StaleBannerState,
        nowMillis: Long,
    ): Long {
        val since = state.disconnectedSinceMillis ?: return STALE_BANNER_THRESHOLD_MILLIS
        return (STALE_BANNER_THRESHOLD_MILLIS - (nowMillis - since)).coerceAtLeast(0L)
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a vehicle id,
 * a connection payload, or the banner copy — so a diagnostics line can never leak which session the user was
 * viewing. Kept free of Compose so it is unit-tested with a recording [Logger]; the ViewModel calls it once per
 * surface open.
 */
object LiveStaleDataBannerDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = LiveStaleDataBannerRegistration.SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
