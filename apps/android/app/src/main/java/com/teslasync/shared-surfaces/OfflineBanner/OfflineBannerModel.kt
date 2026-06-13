// Pure, framework-free model + projection + diagnostics for the OfflineBanner shared surface — the native
// analogue of web/src/components/feedback/OfflineBanner.tsx. No Compose, no Android framework, no HTTP: every
// declaration here is exercised off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer.
//
// WHAT THE WEB SOURCE IS (and therefore the COMPLETE branch set this surface reproduces). The web component is a
// tiny, non-blocking PWA notice driven by one signal, `useOnlineStatus()` (a boolean over `navigator.onLine` +
// the resilience status broadcaster). It renders exactly two branches:
//   • online  → `if (online) return null` — nothing is shown;
//   • offline → a warning `AlertBanner` with a WifiOff icon, the title `pwa.offline.title` ("You're offline")
//     and the body `pwa.offline.banner` ("Showing cached data. New requests will retry when you reconnect."),
//     `role="status"` / `aria-live="polite"`. It hides itself again automatically when connectivity returns.
//
// HOW THAT MAPS ONTO THE NATIVE WIRED STATE (P1/S8, ADR-002/005/009). `navigator.onLine` has no dedicated KMP
// observer, and this surface's allowed-files budget forbids adding one. The one WIRED, cross-cutting "is the
// service reachable / is data flowing" signal every native surface already shares is the app-scoped live-data
// pipeline (`LiveSessionStore`, ADR-009 — the same feed `LiveIndicator` and `ServiceStatus` bind). This surface
// binds THAT through [OfflineBannerSource] and folds the live-wire health into the web's two branches honestly:
//   • a DOWN wire ([LiveConnectionStatus.Disconnected]) → [OfflineBannerPhase.Offline]: the user is genuinely
//     not receiving live data and is looking at cached values — the web's offline branch, rendered with the
//     web-verbatim `pwa.offline.*` copy + a reconnect affordance;
//   • a RECONNECTING wire ([LiveConnectionStatus.Reconnecting]) → [OfflineBannerPhase.Reconnecting]: the live
//     link dropped and is re-establishing, so the page is still showing cached values — surfaced with honest
//     "Reconnecting…" copy (it does NOT overclaim a hard "offline") and the same cached-data body, because the
//     banner has no second channel (no health dot) to express the impaired-but-not-down condition;
//   • a CONNECTED wire (fresh or stale) or a never-yet-connected cold start ([LiveConnectionStatus.Connected] /
//     [LiveConnectionStatus.Unknown]) → [OfflineBannerPhase.Online]: live data is (or is presumed) flowing, so
//     the banner is dormant — the faithful port of the web `if (online) return null`. `navigator.onLine` is a
//     synchronous read that defaults online, so a cold start reads as online here too, never a premature
//     "offline".
//
// This is the native service-reachability proxy for browser connectivity, NOT a literal `navigator.onLine`
// read; the truth is disclosed here rather than dressed up as something it is not. The web's generic
// loading/empty/error/stale template states do not independently apply to a binary connectivity signal (it
// cannot "load", is never an empty collection, cannot "error", and its staleness IS the offline message), so
// they fold onto the two honest phases above. Everything below is framework-free so the whole contract is
// covered by the JVM unit gate without a Compose host.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package (a
// hyphen segment is illegal in a package identifier), so the package intentionally diverges from the path —
// exactly as the sibling shared surfaces do. `MatchingDeclarationName` is suppressed for the co-located
// supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.offlinebanner

import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the OfflineBanner surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`OfflineBanner`); [ID] is
 * the stable `viewModel` key the host binds the surface with.
 */
object OfflineBannerRegistration {
    /** Stable surface id (also the `viewModel` key the host binds the surface with). */
    const val ID: String = "offline-banner"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "OfflineBanner"
}

/**
 * The connectivity phase the banner paints — the native port of the web `OfflineBanner`'s two branches, with the
 * web's single "offline" branch split into the two honest live-wire conditions the native proxy distinguishes:
 *  - [Online] — the wire is up (or a cold start that defaults online); the banner is dormant (web
 *    `if (online) return null`). Renders nothing, contributing zero layout — never a blank box.
 *  - [Reconnecting] — the live link dropped and is re-establishing; cached values are on screen, surfaced with
 *    honest "Reconnecting…" copy (not a hard "offline" claim).
 *  - [Offline] — the wire is down; the web's offline branch, rendered with the verbatim `pwa.offline.*` copy.
 */
enum class OfflineBannerPhase { Online, Reconnecting, Offline }

/**
 * The PII-free projection of the live pipeline the surface renders — it carries no vehicle id and no signal
 * payload, only the wire-health status the web `useOnlineStatus` boolean maps onto. Folded from
 * [io.teslasync.android.data.live.LiveSessionState] by [OfflineBannerSource].
 *
 * @property status the wire health (the native `navigator.onLine` / service-reachability proxy).
 */
data class OfflineBannerSnapshot(
    val status: LiveConnectionStatus,
) {
    companion object {
        /** The initial, pre-collection snapshot: a cold start that has never connected (web defaults online). */
        fun unknown(): OfflineBannerSnapshot = OfflineBannerSnapshot(LiveConnectionStatus.Unknown)
    }
}

/**
 * The fully-resolved render state the composable paints — the native mirror of the web `OfflineBanner`'s
 * online/offline decision. Pure, so the composable only resolves the localized strings + tone from it.
 *
 * @property phase the connectivity phase (web online/offline, split into the two impaired live-wire conditions).
 */
data class OfflineBannerRender(
    val phase: OfflineBannerPhase,
) {
    /** Whether the wire is fully down — the web's hard "offline" branch (verbatim `pwa.offline.*` copy). */
    val offline: Boolean get() = phase == OfflineBannerPhase.Offline

    /** Whether the live link is mid-reconnect — cached data on screen, "Reconnecting…" copy. */
    val reconnecting: Boolean get() = phase == OfflineBannerPhase.Reconnecting

    /** Whether live data is (or is presumed) flowing — the banner is dormant (web `if (online) return null`). */
    val online: Boolean get() = phase == OfflineBannerPhase.Online

    /** Whether the banner should render at all (any impaired connectivity); dormant when [online]. */
    val showBanner: Boolean get() = phase != OfflineBannerPhase.Online
}

/**
 * Pure projection of an [OfflineBannerSnapshot] into the [OfflineBannerRender] — the native mirror of the web
 * `OfflineBanner`'s `useOnlineStatus` branching. Framework-free so the whole contract is covered by the JVM unit
 * gate without a Compose host.
 */
object OfflineBannerProjection {
    /** Folds the live-wire [snapshot] into the render state via [phaseOf]. */
    fun render(snapshot: OfflineBannerSnapshot): OfflineBannerRender = OfflineBannerRender(phaseOf(snapshot.status))

    /**
     * Buckets the live-wire [status] into the banner's [OfflineBannerPhase] — the native mapping of the web
     * `useOnlineStatus` boolean:
     *  - [LiveConnectionStatus.Disconnected] → [OfflineBannerPhase.Offline] (web offline branch);
     *  - [LiveConnectionStatus.Reconnecting] → [OfflineBannerPhase.Reconnecting] (impaired, cached data shown);
     *  - [LiveConnectionStatus.Connected] / [LiveConnectionStatus.Unknown] → [OfflineBannerPhase.Online]
     *    (online, or a cold start that defaults online — both dormant, web `if (online) return null`).
     */
    fun phaseOf(status: LiveConnectionStatus): OfflineBannerPhase =
        when (status) {
            LiveConnectionStatus.Disconnected -> OfflineBannerPhase.Offline
            LiveConnectionStatus.Reconnecting -> OfflineBannerPhase.Reconnecting
            LiveConnectionStatus.Connected, LiveConnectionStatus.Unknown -> OfflineBannerPhase.Online
        }
}

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [OfflineBannerRegistration.SLUG]
 * (P1/S11) — never a vehicle id nor a connection payload, so a diagnostics line can never leak which session a
 * user was viewing. Kept free of Compose so it is unit-tested with a recording [Logger]; the ViewModel calls it
 * once per surface open.
 */
fun recordOfflineBannerOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to OfflineBannerRegistration.SLUG))
}
