// Pure, framework-free model + projection + diagnostics for the LiveTelemetrySegment shared surface — the
// native analogue of web/src/components/layout/status-bar/LiveTelemetrySegment.tsx. No Compose, no Android
// framework, no HTTP: every declaration here is exercised off-device in the :android:testReleaseUnitTest gate,
// keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces): a DENSE single-line
// footer status-bar segment that mirrors the sibling `LiveIndicator` but in a compact form, reflecting the
// SSE/MQTT pipeline freshness from `useLiveConnection` ({ status, lastMessageAt }). It renders the four wire
// states the hook surfaces:
//   • connected    — emerald Wifi, "Live" + an inline "· {Xs}" age stamp (seconds-granularity, web parity);
//   • reconnecting — amber spinning Loader2, "Reconnecting";
//   • disconnected — rose WifiOff, "Offline";
//   • unknown      — muted WifiOff, "Idle" (a cold start that has never connected).
// It carries an `iconOnly` mode (web `iconOnly` prop) that drops the label + age stamp to just the dot + icon,
// and the whole segment is a tap target that navigates to the live signal explorer (web `<Link to=
// "/signal-diff">`). Unlike `LiveIndicator`'s relative-time stamp ("3m ago"), this segment shows the raw
// seconds-first age the web `ageSecondsLabel` produces ("12s" → "3m" → "2h"), and a tooltip reading
// "Live telemetry stream · Last message {age} ago" while connected (web `tooltipBody`).
//
// How that maps onto the native shared state-holder layer (P1/S8, ADR-002, ADR-009): the surface binds the
// app-scoped live pipeline (`io.teslasync.android.data.live.LiveSessionStore`, the native `useLiveConnection`
// port) through [LiveTelemetrySegmentSource], projecting each session frame onto the PII-free
// [LiveTelemetrySnapshot] the composable renders. The platform "every state renders" contract is honoured by
// the same four wire states: the cold-start loading / empty surface IS [LiveConnectionStatus.Unknown]; a
// failed wire (error / offline) IS [LiveConnectionStatus.Disconnected]; the >2-minute stale window the live
// layer flags ([io.teslasync.android.data.live.LiveSessionState.isStale]) is carried as
// [LiveTelemetrySnapshot.stale] and shows as the connected segment with an aged age stamp (web parity — the
// wire is up; deep staleness is surfaced by the sibling LiveStaleDataBanner). No branch is ever hidden: every
// status paints a non-blank segment (the dot + icon always render, even in `iconOnly`). Everything below is
// framework-free so the whole contract is covered by the JVM unit gate without a Compose host.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/LiveTelemetrySegment — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.livetelemetrysegment

import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the LiveTelemetrySegment surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`LiveTelemetrySegment`).
 */
object LiveTelemetrySegmentRegistration {
    /** Stable surface id (also the `viewModel` key the host binds the segment with). */
    const val ID: String = "live-telemetry-segment"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "LiveTelemetrySegment"
}

/**
 * The relative-age bucket the segment's compact stamp resolves to — the native mirror of the web
 * `ageSecondsLabel`. Seconds-first (unlike `LiveIndicator`'s "Just now"), capped at hours, with [None] for a
 * missing / future stamp (the web "—").
 */
enum class AgeUnit {
    /** No stamp to show — never received a message, or a future-skewed stamp (web "—"). */
    None,

    /** Whole seconds (web `${sec}s`, shown for the first minute). */
    Seconds,

    /** Whole minutes (web `${min}m`, `< 60min`). */
    Minutes,

    /** Whole hours (web `${hr}h`, everything past an hour — never rolls over to days, web parity). */
    Hours,
}

/**
 * A resolved compact age stamp, framework-free so it is unit-tested off-device. [unit] selects the symbol the
 * composable appends; [value] is the whole-unit count for [AgeUnit.Seconds] / [Minutes] / [Hours] (`0` for
 * [AgeUnit.None]). The native mirror of the string the web `ageSecondsLabel` returns.
 */
data class AgeLabel(
    val unit: AgeUnit,
    val value: Long = 0,
)

/**
 * The PII-free projection of the live pipeline the segment renders — it carries no vehicle id and no signal
 * payload, only the wire-health signals the web `useLiveConnection` exposes. Folded from
 * [io.teslasync.android.data.live.LiveSessionState] by [LiveTelemetrySegmentSource].
 *
 * @property status the wire health (web `useLiveConnection().status`).
 * @property lastMessageAtMillis client clock of the last live message of any kind, or `null` when none yet
 *   (web `lastMessageAt`); drives the connected segment's "· {age}" stamp and the tooltip's age.
 * @property stale whether the open stream has gone silent past the 2-minute window (ADR-013) — the live
 *   layer's `isStale`; the wire is still [LiveConnectionStatus.Connected] but the age stamp grows.
 */
data class LiveTelemetrySnapshot(
    val status: LiveConnectionStatus,
    val lastMessageAtMillis: Long?,
    val stale: Boolean,
) {
    companion object {
        /** The initial, pre-collection snapshot: a cold start that has never connected (web `unknown`). */
        fun unknown(): LiveTelemetrySnapshot =
            LiveTelemetrySnapshot(
                status = LiveConnectionStatus.Unknown,
                lastMessageAtMillis = null,
                stale = false,
            )
    }
}

/**
 * The fully-resolved render state the composable paints — the native mirror of everything the web
 * `LiveTelemetrySegment` decides between `useLiveConnection` and the rendered `<Link>`. Pure, so the composable
 * only resolves colors + localized strings from it.
 *
 * @property status the wire health (drives the dot color, icon, and label).
 * @property age the compact age stamp ([AgeUnit.None] paints "—" in the tooltip and no inline stamp).
 * @property showInlineAge whether the inline "· {age}" stamp renders (web `!iconOnly && status ===
 *   'connected' && lastMessageAt`).
 * @property showLabel whether the short text label renders (web `!iconOnly`).
 * @property spin whether the icon spins (web reconnecting `animate-spin`, suppressed under reduced motion).
 * @property connected whether the wire is up — selects the tooltip branch (web `status === 'connected'`).
 * @property stale whether the connected wire has aged past the staleness window (carried for tests + styling).
 */
data class LiveTelemetryRender(
    val status: LiveConnectionStatus,
    val age: AgeLabel,
    val showInlineAge: Boolean,
    val showLabel: Boolean,
    val spin: Boolean,
    val connected: Boolean,
    val stale: Boolean,
)

/**
 * Pure projection of a [LiveTelemetrySnapshot] into the render state — the native mirror of everything the web
 * `LiveTelemetrySegment` decides between its hook and the rendered segment. Framework-free so the whole
 * contract is covered by the JVM unit gate without a Compose host.
 */
object LiveTelemetrySegmentProjection {
    private const val MILLIS_PER_SECOND = 1_000L
    private const val SECONDS_PER_MINUTE = 60L
    private const val MINUTES_PER_HOUR = 60L

    /**
     * Projects [snapshot] for the [iconOnly] mode at wall-clock [nowMs] into the render state. [reduceMotion]
     * suppresses the reconnecting icon spin (web reduced-motion branch). The inline age stamp renders only
     * when the label is shown and the wire is connected with a known last-message time, exactly as the web
     * inline condition does (`!iconOnly && status === 'connected' && lastMessageAt`).
     */
    fun render(
        snapshot: LiveTelemetrySnapshot,
        iconOnly: Boolean,
        nowMs: Long,
        reduceMotion: Boolean,
    ): LiveTelemetryRender {
        val connected = snapshot.status == LiveConnectionStatus.Connected
        return LiveTelemetryRender(
            status = snapshot.status,
            age = ageLabel(snapshot.lastMessageAtMillis, nowMs),
            showInlineAge = !iconOnly && connected && snapshot.lastMessageAtMillis != null,
            showLabel = !iconOnly,
            spin = snapshot.status == LiveConnectionStatus.Reconnecting && !reduceMotion,
            connected = connected,
            stale = snapshot.stale,
        )
    }

    /**
     * The compact age stamp, a 1:1 port of the web `ageSecondsLabel`: a missing or future-skewed stamp yields
     * [AgeUnit.None] (the web "—"); otherwise whole seconds for the first minute (web `${sec}s`), whole minutes
     * up to an hour (web `${min}m`), then whole hours with no day rollover (web `${hr}h` — a 25-hour-old wire
     * reads "25h", never "1d"). Mirrors the web `Math.floor` truncation via integer division.
     */
    fun ageLabel(
        lastMessageAtMillis: Long?,
        nowMs: Long,
    ): AgeLabel {
        if (lastMessageAtMillis == null) return AgeLabel(AgeUnit.None)
        val ms = nowMs - lastMessageAtMillis
        val seconds = ms / MILLIS_PER_SECOND
        val minutes = seconds / SECONDS_PER_MINUTE
        return when {
            ms < 0 -> AgeLabel(AgeUnit.None)
            seconds < SECONDS_PER_MINUTE -> AgeLabel(AgeUnit.Seconds, seconds)
            minutes < MINUTES_PER_HOUR -> AgeLabel(AgeUnit.Minutes, minutes)
            else -> AgeLabel(AgeUnit.Hours, minutes / MINUTES_PER_HOUR)
        }
    }
}

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface
 * [LiveTelemetrySegmentRegistration.SLUG] (P1/S11) — never a vehicle id nor a connection payload, so a
 * diagnostics line can never leak which session a user was viewing. Kept free of Compose so it is unit-tested
 * with a recording [Logger]; the ViewModel calls it once per surface open.
 */
fun recordLiveTelemetrySegmentOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to LiveTelemetrySegmentRegistration.SLUG))
}
