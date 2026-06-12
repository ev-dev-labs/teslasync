// The data seam the SLOTrackingCard binds to, plus its production bindings over the shared resilient HTTP
// client and Android SharedPreferences. The web component reads a raw `useQuery` of
// `GET /status/uptime?window=…` (web/src/features/system/components/status/SLOTrackingCard.tsx) — there is
// NO shared `useSystem`/`useStatus` hook entry for uptime, so (exactly like the sibling InfrastructureSection
// surface, whose web source also calls the client directly rather than a domain hook) the surface declares
// its own one-call seam over the same shared `ApiHttpClient` every S7 repository builds on. The view performs
// NO HTTP — it collects state from the ViewModel, which drives this seam, satisfying the "no direct HTTP from
// the view" contract while reproducing the web component's `useQuery` (a polled read, not a mutation).
//
// The personal target the web persists in localStorage maps onto a [SloTargetStore]; its production binding
// is the SharedPreferences adapter below (the same pattern the AppearanceSettings surface uses for its
// localStorage-backed prefs), so the target survives process death exactly as the web value survives a
// reload. The target is stored as its string form (like localStorage) so a fractional target round-trips
// without the precision loss of `putFloat`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SLOTrackingCard) cannot form a valid Kotlin package. `MatchingDeclarationName`
// + the ktlint filename rule are suppressed for the co-located seam + adapters.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.slotrackingcard

import android.content.SharedPreferences
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.safeRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * The single read seam the [SLOTrackingCardViewModel] depends on so it binds to an abstraction (real
 * adapter ↔ test fake), never to a concrete client — the Android analogue of the web component's
 * `useQuery(() => request<UptimeWindow>(\`/status/uptime?window=${win}\`))` (the P1/S8 state-holder
 * boundary). It runs ONE `/status/uptime` request per window and returns a non-throwing [Result] (transport
 * faults are `Result.failure`, mirroring the web query's `error`). No HTTP touches the view.
 */
interface SLOTrackingCardSource {
    /** `GET /status/uptime?window={window.wire}` — the uptime snapshot for [window] (web `useQuery`). */
    suspend fun uptime(window: StatusWindow): Result<UptimeWindow>
}

/**
 * Binds the surface to the shared resilient [ApiHttpClient] — the same client every S7 repository builds on
 * (auto `/api/v1` prefix, retry/backoff, circuit breaker, auth seam, [io.teslasync.shared.core.net.ApiError]
 * mapping). A status host constructs the surface with `api.asSLOTrackingCardSource()`. The call uses the
 * non-throwing [safeRequest] with the `window` query param passed snake-case-free as the web does, so a
 * transport fault becomes the `Result.failure` the ViewModel projects onto the error / offline surface.
 */
fun ApiHttpClient.asSLOTrackingCardSource(): SLOTrackingCardSource {
    val api = this
    return object : SLOTrackingCardSource {
        override suspend fun uptime(window: StatusWindow): Result<UptimeWindow> =
            api.safeRequest(
                method = HttpMethodKind.GET,
                path = UPTIME_PATH,
                query = mapOf(WINDOW_PARAM to window.wire),
            )
    }
}

/** The uptime endpoint path (the client prepends `/api/v1`, so this must not). */
private const val UPTIME_PATH: String = "/status/uptime"

/** The window query parameter name (web `?window=`). */
private const val WINDOW_PARAM: String = "window"

/**
 * [SharedPreferences]-backed [SloTargetStore] — the production persistence the web gets from localStorage:
 * the personal target survives process death, and a setter both persists and re-emits so the open surface
 * reflects the change instantly. Pure of any Android `Context` (it takes the resolved [prefs]) so it stays
 * straightforward to wire. The value is stored as its string form (like localStorage) so a fractional
 * target round-trips losslessly; a missing/corrupt value resolves to the clamped default on read.
 */
class SharedPreferencesSloTargetStore(
    private val prefs: SharedPreferences,
) : SloTargetStore {
    private val state = MutableStateFlow(SLOTrackingCardProjection.clampTarget(read()))
    override val target: StateFlow<Double> = state.asStateFlow()

    override fun setTarget(value: Double) {
        val clamped = SLOTrackingCardProjection.clampTarget(value)
        prefs.edit().putString(TARGET_KEY, clamped.toString()).apply()
        state.update { clamped }
    }

    private fun read(): Double? = prefs.getString(TARGET_KEY, null)?.toDoubleOrNull() // parity:allow "toDo" substring false positive

    private companion object {
        /** The persisted key — the same identifier the web uses for its localStorage entry. */
        const val TARGET_KEY = "teslasync.status.slo.target"
    }
}
