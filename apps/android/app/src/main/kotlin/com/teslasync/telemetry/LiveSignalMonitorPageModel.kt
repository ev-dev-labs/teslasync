// Pure, framework-free model + projections for the LiveSignalMonitorPage telemetry surface — the native
// analogue of the small amount of state the web page derives before composing its chrome
// (web/src/features/telemetry/pages/LiveSignalMonitorPage.tsx). No Compose, no Android UI, no HTTP: every
// declaration here is plain Kotlin (it references only the platform `LiveConnectionStatus` enum and the
// shared-core Logger), so the composable stays a thin render layer and this logic is unit-testable off-device.
//
// The web page is a thin wrapper over the shared `useLiveSignalStream` + `LiveSignalTail`: its only page-owned
// state is the SSE connection flag driving the header `Badge` (web `live.connected ? 'success' : 'danger'` with
// the `liveMonitor.connected` / `liveMonitor.disconnected` copy). This file ports that one derivation
// ([isLiveConnected]) plus the registration identity and the PII-safe `view.opened` diagnostic; the live tail
// itself is the already-built `LiveSignalTail` feature view, so no firehose/buffer logic is re-implemented here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.telemetry.livesignalmonitor

import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `LiveSignalMonitorPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("liveSignalMonitor", "/live-monitor", …)`, so [io.teslasync.android.navigation.PageHosts] binds this
 * surface to that destination (and its `/live-monitor` deep link) without the nav module depending on it.
 */
object LiveSignalMonitorPageRegistration {
    /** The navigation destination id (Destinations.kt `page("liveSignalMonitor", "/live-monitor", …)`). */
    const val ROUTE_ID: String = "liveSignalMonitor"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/live-monitor"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "LiveSignalMonitorPage"
}

/** The tail buffer cap handed to the `LiveSignalTail` feature view — verbatim the web page's `TAIL_MAX = 500`. */
const val LIVE_MONITOR_TAIL_MAX: Int = 500

/**
 * Web `live.connected` — whether the SSE wire is up. The shared client folds `Connection.Open`/`Connection.Stale`
 * onto [LiveConnectionStatus.Connected] (the wire is up; data staleness is surfaced separately), so the page
 * header badge is "Connected" (success) only for that status and "Disconnected" (danger) for every other.
 */
fun isLiveConnected(status: LiveConnectionStatus): Boolean = status == LiveConnectionStatus.Connected

/**
 * One projected emission of the shared live pipeline the page binds to — the native analogue of the web
 * `useLiveSignalStream` connection slice. Carries the wire health plus the freshness fields so the page can
 * surface the ADR-013 stale tier without re-opening a second subscription.
 *
 * @property status the wire health (web `connected`): Connected / Reconnecting / Disconnected / Unknown.
 * @property isStale whether the open stream has gone silent past the 2-minute freshness window (ADR-013).
 * @property lastMessageAtMillis the client clock of the last live message of any kind, or `null` before any.
 */
data class LiveMonitorConnection(
    val status: LiveConnectionStatus,
    val isStale: Boolean,
    val lastMessageAtMillis: Long?,
) {
    companion object {
        /** Pre-connection seed: neutral wire, not stale, no message yet (web cold start before any frame). */
        val Initial: LiveMonitorConnection =
            LiveMonitorConnection(status = LiveConnectionStatus.Unknown, isStale = false, lastMessageAtMillis = null)
    }
}

/**
 * The resolved page state the header renders: the live wire [status] plus the derived [connected] flag the
 * `Badge` reads, and the freshness fields. Always complete (never a blank-hiding null), so the header chrome
 * renders in every connection state.
 */
data class LiveMonitorUiState(
    val status: LiveConnectionStatus,
    val isStale: Boolean,
    val lastMessageAtMillis: Long?,
) {
    /** Web `live.connected` — drives the success/danger header badge + its Connected/Disconnected copy. */
    val connected: Boolean get() = isLiveConnected(status)

    companion object {
        /** Pre-connection seed (web cold start): unknown wire, not connected, not stale. */
        val Initial: LiveMonitorUiState =
            LiveMonitorUiState(status = LiveConnectionStatus.Unknown, isStale = false, lastMessageAtMillis = null)
    }
}

/** Project a [LiveMonitorConnection] source emission onto the rendered [LiveMonitorUiState]. Pure, so unit-tested. */
fun liveMonitorUiStateOf(connection: LiveMonitorConnection): LiveMonitorUiState =
    LiveMonitorUiState(
        status = connection.status,
        isStale = connection.isStale,
        lastMessageAtMillis = connection.lastMessageAtMillis,
    )

/**
 * Emit the one PII-safe `view.opened` diagnostic with the surface [LiveSignalMonitorPageRegistration.SLUG]
 * (P1/S11). Carries no vehicle id or signal value, so a diagnostics line can never leak the live state.
 */
fun recordLiveSignalMonitorPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to LiveSignalMonitorPageRegistration.SLUG))
}
