// The single data port the ConnectionSegment shared surface binds to — the native analogue of the web
// `useApiHealth` hook the segment reflects (web/src/components/layout/status-bar/ConnectionSegment.tsx). The web
// hook polls the backend root `/healthz`; the cross-platform port of that whole domain is the shared-core
// `ApiHealthStore` (commonMain — the KMP `useApiHealth` holder that owns the probe, the 15s poll cadence, and
// the identical bucketing thresholds). This surface binds THAT through this seam. The view-model depends on
// this abstraction (a real adapter over the shared P1/S8 holder in production, a fake in tests), never on a
// concrete store or the HTTP client, so the view performs NO HTTP and runs no poll itself (P1/S8 boundary,
// ADR-002).
//
// The health contract is preserved end to end: every [io.teslasync.shared.core.presentation.apihealth.ApiHealthState]
// emission's status / latency / last-checked stamp flows through unchanged onto the PII-free
// [ConnectionSnapshot] the segment renders — exactly the signals the dot + icon + label + suffix project. No
// vehicle id and no request payload ever cross this seam. The shared model's ISO `lastCheckedAt` is parsed to
// epoch millis here (at the adapter boundary, off the view) so the projection's freshness fold stays a pure,
// locale-stable function.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/ConnectionSegment) cannot form a valid Kotlin package;
// `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed for the co-located adapters alongside
// the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.connectionsegment

import io.teslasync.shared.core.presentation.apihealth.ApiHealthState
import io.teslasync.shared.core.presentation.apihealth.ApiHealthStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import java.time.Instant
import java.time.format.DateTimeParseException

/**
 * The seam the [ConnectionSegmentViewModel] binds to so it depends on an abstraction (real adapter ↔ test
 * fake), never on a concrete store or the HTTP client. [apiHealth] is the cold, lifecycle-aware API-health feed
 * (web `useApiHealth`); the segment surfaces only its tier + latency + freshness, never any request payload.
 * No HTTP touches the view.
 */
fun interface ConnectionSegmentSource {
    /**
     * The shared poll's API health as a stream of PII-free [ConnectionSnapshot]s. Collecting it (via the
     * ViewModel) subscribes to the shared [ApiHealthStore]; the last observer leaving suspends the poll — the
     * store's `WhileSubscribed` contract (the web `refetchIntervalInBackground: false` analogue).
     */
    fun apiHealth(): Flow<ConnectionSnapshot>
}

/**
 * Binds the surface to the shared **P1/S8** [ApiHealthStore] — the single API-health poll holder every native
 * status indicator shares (the Android `useApiHealth` port). Each [ApiHealthState] emission is projected onto
 * the PII-free [ConnectionSnapshot] the segment renders; the ISO `lastCheckedAt` is parsed to epoch millis so
 * the projection's freshness fold needs no time parsing. No HTTP touches the view.
 */
fun ApiHealthStore.asConnectionSegmentSource(): ConnectionSegmentSource {
    val store = this
    return ConnectionSegmentSource { store.state.map { it.toConnectionSnapshot() } }
}

/**
 * Builds a [ConnectionSegmentSource] from a single health-feed provider — the host wiring seam used when a
 * caller already holds the feed (and the test double used to drive each tier deterministically). Mirrors the
 * contract of the store adapter above.
 */
fun connectionSegmentSource(feed: () -> Flow<ConnectionSnapshot>): ConnectionSegmentSource = ConnectionSegmentSource { feed() }

/**
 * A static, single-emission source for previews, tests, and any caller that already holds a resolved
 * [snapshot]. Emits it once as the surface's whole feed.
 */
fun staticConnectionSegmentSource(snapshot: ConnectionSnapshot): ConnectionSegmentSource = connectionSegmentSource { flowOf(snapshot) }

/**
 * Projects the shared [ApiHealthState] (web `useApiHealth` result) onto the PII-free [ConnectionSnapshot] — the
 * tier and latency pass through verbatim and the ISO `lastCheckedAt` is parsed to epoch millis for the
 * freshness fold. Internal so the adapter mapping is unit-tested without a UI host.
 */
internal fun ApiHealthState.toConnectionSnapshot(): ConnectionSnapshot =
    ConnectionSnapshot(
        status = status,
        latencyMs = latencyMs,
        lastCheckedAtMillis = parseIsoMillis(lastCheckedAt),
    )

/**
 * Parses an ISO-8601 instant (the shared model's `lastCheckedAt`, e.g. `2023-11-14T22:13:20Z`) to epoch millis,
 * resolving to `null` for an absent or unparseable stamp so a malformed value degrades to "no known freshness"
 * (never stale) rather than throwing. `java.time` is safe here: this is an Android-only file and the module's
 * `minSdk` is 26.
 */
private fun parseIsoMillis(iso: String?): Long? {
    if (iso.isNullOrBlank()) return null
    return try {
        Instant.parse(iso).toEpochMilli()
    } catch (_: DateTimeParseException) {
        null
    }
}
