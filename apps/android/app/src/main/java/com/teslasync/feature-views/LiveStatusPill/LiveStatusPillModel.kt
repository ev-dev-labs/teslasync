// Pure, framework-free model + projection for the LiveStatusPill feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/system/components/status/LiveStatusPill.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable
// a thin render layer.
//
// LiveStatusPill is a purely presentational badge: the web component takes its connection `state`, the
// `lastUpdateAt` stamp, and a `now` tick as props from the /system-status page (which owns the
// `useStatusLiveSSE` pump), so this surface binds NO data hook of its own. As in the sibling BatteryPill /
// AchievementBadge / StatusHeader ports, the cache-then-network lifecycle (loading / error / stale / offline)
// lives on the owning page, not here; modelling those phases would invent behaviour the spec does not have
// (drift). The branches the web source actually defines are the complete state set this surface renders, and
// each is projected here: the three connection states (web `TONE` map: live / reconnecting / offline) and the
// five relative-age buckets the web `relative(now, lastUpdateAt)` produces (em dash / just-now / seconds /
// minutes / hours).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/LiveStatusPill — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livestatuspill

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.computeAgeSeconds
import io.teslasync.shared.core.diagnostics.Logger

/**
 * The health of the live SSE stream — the native analogue of the web `StatusLiveState` union
 * (`'live' | 'reconnecting' | 'offline'`) that the `useStatusLiveSSE` pump emits. There is no fourth
 * "unknown" member (unlike the shared [io.teslasync.android.components.datadisplay.LiveConnectionStatus]) so
 * the surface models exactly the three states the web prop can carry.
 */
enum class LiveStatusState {
    /** SSE flowing — green dot + "Live" (web `tone.live`). */
    Live,

    /** Last open errored and a retry is in flight — amber pulsing dot + "Reconnecting" (web `tone.reconnecting`). */
    Reconnecting,

    /** Gave up after backoff — grey dot + "Offline" (web `tone.offline`). */
    Offline,
    ;

    /**
     * The wire token, mirroring the web `data-status-live-state` attribute (and the string the SSE hook
     * emits). Lets the owning state-holder round-trip the state and lets tests pin parity with the web.
     */
    val wire: String
        get() =
            when (this) {
                Live -> "live"
                Reconnecting -> "reconnecting"
                Offline -> "offline"
            }

    companion object {
        /**
         * Maps the live SSE hook's wire token (web `StatusLiveState`) to a state. `"live"` and
         * `"reconnecting"` map verbatim; every other token — including `"offline"` and any unrecognized
         * value — resolves to [Offline], the safe "not live" posture so an unknown stream is never painted
         * as connected.
         */
        fun fromWire(value: String): LiveStatusState =
            when (value) {
                "live" -> Live
                "reconnecting" -> Reconnecting
                else -> Offline
            }
    }
}

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host;
 * because the composable is a thin render layer, each field here is exactly what it draws.
 *
 * @property state the connection state driving the dot color, icon, label, and pulse (web `TONE[state]`).
 * @property age the relative-age bucket for the "updated X ago" tail (web `relative(now, lastUpdateAt)`).
 * @property pulse whether the status dot animates (web `tone.pulse`) — true only while [LiveStatusState.Reconnecting].
 */
data class LiveStatusPillDisplay(
    val state: LiveStatusState,
    val age: FreshnessAge,
    val pulse: Boolean,
)

/**
 * Pure projection from the web props (`state`, `lastUpdateAt`, `now`) to the render-ready
 * [LiveStatusPillDisplay] — a 1:1 port of the two derivations the web component performs (the `TONE` lookup
 * and the `relative()` helper) before returning JSX.
 */
object LiveStatusPillProjection {
    /** Web `secs < 5`: below this the stream reads "just now". Tighter than the shared 10s FreshnessIndicator window. */
    private const val JUST_NOW_SECONDS: Long = 5

    private const val SECONDS_PER_MINUTE: Long = 60
    private const val SECONDS_PER_HOUR: Long = 3_600

    /** The accessibility sentence join — locale-neutral punctuation, carries no translatable word. */
    private const val SENTENCE_JOIN: String = ". "

    /**
     * The relative-age bucket for the "updated X ago" tail — a 1:1 port of the web
     * `relative(now, lastUpdateAt)`: a null stamp yields [FreshnessAge.Unknown] (the web em dash), `<5s` is
     * just-now, `<60s` is seconds, `<1h` is minutes, and everything else is hours. The web caps at hours — a
     * day-old stream reads "30h ago", never "1d ago" — so this never returns [FreshnessAge.Days] or
     * [FreshnessAge.Weeks]. Reuses the shared [computeAgeSeconds] for the `max(0, floor((now - ts) / 1000))`
     * math (a future stamp clamps to 0 → just-now); the 5-second just-now cutoff is this surface's own.
     */
    fun relativeAge(
        nowMillis: Long,
        lastUpdateAtMillis: Long?,
    ): FreshnessAge {
        val secs = computeAgeSeconds(lastUpdateAtMillis, nowMillis) ?: return FreshnessAge.Unknown
        return when {
            secs < JUST_NOW_SECONDS -> FreshnessAge.JustNow
            secs < SECONDS_PER_MINUTE -> FreshnessAge.Seconds(secs)
            secs < SECONDS_PER_HOUR -> FreshnessAge.Minutes(secs / SECONDS_PER_MINUTE)
            else -> FreshnessAge.Hours(secs / SECONDS_PER_HOUR)
        }
    }

    /** Whether the status dot animates — web `tone.pulse`, set only for the reconnecting state. */
    fun shouldPulse(state: LiveStatusState): Boolean = state == LiveStatusState.Reconnecting

    /** Projects the web props onto the render-ready [LiveStatusPillDisplay]. */
    fun project(
        state: LiveStatusState,
        nowMillis: Long,
        lastUpdateAtMillis: Long?,
    ): LiveStatusPillDisplay =
        LiveStatusPillDisplay(
            state = state,
            age = relativeAge(nowMillis, lastUpdateAtMillis),
            pulse = shouldPulse(state),
        )

    /**
     * The merged accessibility phrase — the native analogue of the web `role="status"` + `aria-label`
     * ("...{label}, updated {rel}"). Composed from the already-localized [stateLabel] and [freshnessPhrase]
     * so it carries no English literal and needs no new catalog key (the surface's allowed-files scope
     * forbids one). Reads e.g. "Live. Last updated: 5s ago" or "Offline. Never updated".
     */
    fun contentDescription(
        stateLabel: String,
        freshnessPhrase: String,
    ): String = stateLabel + SENTENCE_JOIN + freshnessPhrase
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the
 * connection state or timestamp — so a diagnostics line can never leak a vehicle's live posture.
 */
object LiveStatusPillDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "LiveStatusPill"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
