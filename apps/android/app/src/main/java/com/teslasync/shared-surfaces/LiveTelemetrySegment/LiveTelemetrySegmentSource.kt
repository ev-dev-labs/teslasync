// The single data port the LiveTelemetrySegment shared surface binds to — the native analogue of the web
// `useLiveConnection` hook the segment surfaces the health of. The web `LiveTelemetrySegment` reads the
// app-global live-data pipeline; this surface binds the Android counterpart, the app-scoped
// `io.teslasync.android.data.live.LiveSessionStore` (ADR-009), through this seam. The view-model depends on
// this abstraction (a real adapter over the shared live layer in production, a fake in tests), never on a
// concrete store or the SSE client, so the view performs NO HTTP and opens no stream itself (P1/S8 boundary,
// ADR-002).
//
// The wire-health contract is preserved end to end: every emission's status / last-message / staleness flows
// through unchanged onto the PII-free [LiveTelemetrySnapshot] — exactly the signals the segment projects into
// its dot + icon + label + age stamp. No vehicle id and no signal payload ever cross this seam.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/LiveTelemetrySegment) cannot form a valid Kotlin package;
// `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed for the co-located adapters alongside
// the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.livetelemetrysegment

import io.teslasync.android.data.live.LiveSessionStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * The seam the [LiveTelemetrySegmentViewModel] binds to so it depends on an abstraction (real adapter ↔ test
 * fake), never on a concrete store or the SSE client. [connection] is the cold, lifecycle-aware live
 * wire-health feed (web `useLiveConnection`); the segment surfaces only its status + age, never any signals.
 * No HTTP touches the view.
 */
fun interface LiveTelemetrySegmentSource {
    /**
     * The live pipeline's wire-health as a stream of PII-free [LiveTelemetrySnapshot]s. Collecting it (via the
     * ViewModel) opens the shared gated SSE subscription; the last observer leaving closes it — the platform
     * live-layer contract (ADR-009).
     */
    fun connection(): Flow<LiveTelemetrySnapshot>
}

/**
 * Binds the surface to the app-scoped **S8** [LiveSessionStore] — the single live pipeline holder every live
 * surface shares (ADR-009), the Android `useLiveConnection` port. Each session frame's connection lifecycle,
 * last-message clock, and staleness flag is projected onto the PII-free [LiveTelemetrySnapshot] the segment
 * renders; the merged per-vehicle signals never leave the store. No HTTP touches the view.
 */
fun LiveSessionStore.asLiveTelemetrySegmentSource(): LiveTelemetrySegmentSource {
    val store = this
    return LiveTelemetrySegmentSource {
        store.state.map { session ->
            LiveTelemetrySnapshot(
                status = session.status,
                lastMessageAtMillis = session.lastMessageAtMillis,
                stale = session.isStale,
            )
        }
    }
}

/**
 * Builds a [LiveTelemetrySegmentSource] from a single wire-health feed provider — the host wiring seam used
 * when a caller already has the connection flow in hand (and the test double used to drive each wire state
 * deterministically). Mirrors the contract of the store adapter above.
 */
fun liveTelemetrySegmentSource(connection: () -> Flow<LiveTelemetrySnapshot>): LiveTelemetrySegmentSource =
    LiveTelemetrySegmentSource { connection() }
