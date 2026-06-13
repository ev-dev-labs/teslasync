// Pure, framework-free model + projection + diagnostics for the ServiceStatus shared surface — the native
// analogue of web/src/components/data-display/ServiceStatus.tsx. No Compose, no Android framework, no HTTP:
// every declaration here is exercised off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// WHAT THE WEB SOURCE IS (and therefore the COMPLETE branch set this surface reproduces). The web file exports
// two presentational pieces that together form the app's "service status":
//   • ServiceStatusBanner — a full-width OFFLINE banner that appears only while the browser reports no network
//     (`getConnectionStatus() === 'offline'`, fed by `navigator.onLine` + `onStatusChange`), with the copy
//     "You are offline. Data may be stale. Reconnecting automatically…" and a WifiOff icon.
//   • SystemHealthDot — a small colored dot reflecting the backend's overall health (`GET /system/status`'s
//     `overall`): healthy → green, degraded → amber, anything else (down) → red, with `title="System: {overall}"`.
//
// HOW THAT MAPS ONTO THE NATIVE WIRED STATE (P1/S8, ADR-002/005/009). Neither web data source has a literal
// native counterpart: `navigator.onLine` has no dedicated KMP observer, and `GET /system/status` has no shared
// KMP store (the shared `SystemStore` covers only `/system/rate-limits`), and this surface's allowed-files
// budget forbids adding one. The one WIRED, cross-cutting "is the service reachable / is data flowing" signal
// every native surface already shares is the app-scoped live-data pipeline (`LiveSessionStore`, ADR-009 — the
// same feed `LiveIndicator` binds). This surface binds THAT through [ServiceStatusSource] and folds the live
// wire health into both web regions honestly:
//   • the offline banner shows when the wire is DOWN ([LiveConnectionStatus.Disconnected]) — the native
//     "you are offline" signal;
//   • the health dot maps the wire health onto the web `overall` buckets — Connected&fresh → [SystemHealth.Healthy]
//     (green), Reconnecting or connected-but-stale → [SystemHealth.Degraded] (amber), Disconnected →
//     [SystemHealth.Down] (red), and a cold start that has never connected → [SystemHealth.Unknown] (the loading
//     surface). This is the native service-reachability proxy for backend health, NOT a `/system/status` read;
//     the truth is disclosed here rather than dressed up as something it is not.
//
// The platform "every state renders" contract is honoured by distinct, non-blank branches: loading (cold-start
// Unknown), empty (wire up but no telemetry yet → "No system health data"), error/offline (Disconnected → red
// dot + banner), stale (connected past the 2-minute window → amber dot + Stale chip), and content (the green
// dot). Everything below is framework-free so the whole contract is covered by the JVM unit gate without a
// Compose host.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package (a
// hyphen segment is illegal in a package identifier), so the package intentionally diverges from the path —
// exactly as the sibling shared surfaces do. `MatchingDeclarationName` is suppressed for the co-located
// supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.servicestatus

import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the ServiceStatus surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`ServiceStatus`); [ID]
 * is the stable `viewModel` key the host binds the surface with.
 */
object ServiceStatusRegistration {
    /** Stable surface id (also the `viewModel` key the host binds the surface with). */
    const val ID: String = "service-status"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ServiceStatus"
}

/**
 * The coarse backend-health bucket the dot paints — the native port of the web `SystemHealthDot`'s three
 * `overall` colours plus an explicit cold-start tier:
 *  - [Healthy] — green (web `overall === 'healthy'`);
 *  - [Degraded] — amber (web `overall === 'degraded'`, plus a connected-but-stale wire);
 *  - [Down] — red (web's `else` branch, an unreachable / disconnected service);
 *  - [Unknown] — neutral (the loading / no-data surface the web hides with `if (!data) return null`, which this
 *    surface renders explicitly so a region is never blank).
 */
enum class SystemHealth { Healthy, Degraded, Down, Unknown }

/**
 * The PII-free projection of the live pipeline the surface renders — it carries no vehicle id and no signal
 * payload, only the wire-health signals. Folded from [io.teslasync.android.data.live.LiveSessionState] by
 * [ServiceStatusSource].
 *
 * @property status the wire health (the native `navigator.onLine` + service-reachability proxy).
 * @property lastMessageAtMillis client clock of the last live message of any kind, or `null` when none yet;
 *   distinguishes a freshly-connected-but-idle wire (the empty state) from one carrying telemetry.
 * @property stale whether the open stream has gone silent past the 2-minute window (ADR-013) — the live
 *   layer's `isStale`; the wire is still up but the data ages (web "Data may be stale").
 */
data class ServiceStatusSnapshot(
    val status: LiveConnectionStatus,
    val lastMessageAtMillis: Long?,
    val stale: Boolean,
) {
    companion object {
        /** The initial, pre-collection snapshot: a cold start that has never connected (web `!data`). */
        fun unknown(): ServiceStatusSnapshot =
            ServiceStatusSnapshot(
                status = LiveConnectionStatus.Unknown,
                lastMessageAtMillis = null,
                stale = false,
            )
    }
}

/**
 * The fully-resolved render state the composable paints — the native mirror of everything the web
 * `ServiceStatusBanner` + `SystemHealthDot` decide before returning JSX. Pure, so the composable only resolves
 * colours + localized strings from it.
 *
 * @property health the dot's colour/label bucket (web `SystemHealthDot` colour).
 * @property offline whether the full-width offline banner shows (web `ServiceStatusBanner`'s `isOffline`).
 * @property reconnecting whether the wire is mid-reconnect (amber, the "Reconnecting automatically" nuance).
 * @property stale whether a connected wire has aged past the staleness window → a "Stale" chip over the dot.
 * @property loading whether this is a cold start that has never connected → a skeleton/neutral dot.
 * @property empty whether the wire is up but no telemetry has arrived yet → "No system health data".
 * @property lastMessageAtMillis the freshness stamp carried through for tests / future relative-time chrome.
 */
data class ServiceStatusRender(
    val health: SystemHealth,
    val offline: Boolean,
    val reconnecting: Boolean,
    val stale: Boolean,
    val loading: Boolean,
    val empty: Boolean,
    val lastMessageAtMillis: Long?,
) {
    /** Whether the full-width offline banner should render (web `ServiceStatusBanner` visibility). */
    val showOfflineBanner: Boolean get() = offline

    /** Whether the "Stale" freshness chip should render over the dot (connected but aged, not offline). */
    val showStaleChip: Boolean get() = stale && !offline
}

/**
 * Pure projection of a [ServiceStatusSnapshot] into the [ServiceStatusRender] — the native mirror of the
 * branching both web pieces do. Framework-free so the whole contract is covered by the JVM unit gate without a
 * Compose host.
 */
object ServiceStatusProjection {
    /**
     * Folds the live-wire [snapshot] into the render state. Phase resolution honours both web regions and the
     * live layer's lifecycle: a cold start that never connected → [ServiceStatusRender.loading]; a down wire →
     * the offline banner + [SystemHealth.Down]; a reconnecting or connected-but-stale wire → [SystemHealth.Degraded];
     * a connected wire with no telemetry yet → the empty surface; and a connected, fresh wire → [SystemHealth.Healthy].
     */
    fun render(snapshot: ServiceStatusSnapshot): ServiceStatusRender {
        val status = snapshot.status
        val loading = status == LiveConnectionStatus.Unknown
        val offline = status == LiveConnectionStatus.Disconnected
        val reconnecting = status == LiveConnectionStatus.Reconnecting
        val connected = status == LiveConnectionStatus.Connected
        val stale = connected && snapshot.stale
        val empty = connected && !stale && snapshot.lastMessageAtMillis == null
        return ServiceStatusRender(
            health = healthOf(status, stale = stale, empty = empty),
            offline = offline,
            reconnecting = reconnecting,
            stale = stale,
            loading = loading,
            empty = empty,
            lastMessageAtMillis = snapshot.lastMessageAtMillis,
        )
    }

    /**
     * Buckets the live-wire [status] (plus the already-computed [stale]/[empty] flags) into the dot's
     * [SystemHealth] tier — the native mirror of the web `SystemHealthDot` colour selection extended with the
     * cold-start / idle tiers the web hides:
     *  - [LiveConnectionStatus.Unknown] → [SystemHealth.Unknown] (cold start / loading);
     *  - [LiveConnectionStatus.Disconnected] → [SystemHealth.Down] (web `else` / unreachable);
     *  - [LiveConnectionStatus.Reconnecting] → [SystemHealth.Degraded] (web `degraded`);
     *  - a connected-but-stale wire → [SystemHealth.Degraded] (data aging);
     *  - a connected-but-idle wire (no telemetry) → [SystemHealth.Unknown] (the empty surface);
     *  - otherwise (connected, fresh) → [SystemHealth.Healthy] (web `healthy`).
     */
    fun healthOf(
        status: LiveConnectionStatus,
        stale: Boolean,
        empty: Boolean,
    ): SystemHealth =
        when {
            status == LiveConnectionStatus.Unknown -> SystemHealth.Unknown
            status == LiveConnectionStatus.Disconnected -> SystemHealth.Down
            status == LiveConnectionStatus.Reconnecting -> SystemHealth.Degraded
            stale -> SystemHealth.Degraded
            empty -> SystemHealth.Unknown
            else -> SystemHealth.Healthy
        }
}

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [ServiceStatusRegistration.SLUG]
 * (P1/S11) — never a vehicle id nor a connection payload, so a diagnostics line can never leak which session a
 * user was viewing. Kept free of Compose so it is unit-tested with a recording [Logger]; the ViewModel calls it
 * once per surface open.
 */
fun recordServiceStatusOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to ServiceStatusRegistration.SLUG))
}
