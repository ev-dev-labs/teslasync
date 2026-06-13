// Pure, framework-free model + projection + diagnostics for the LiveIndicator shared surface — the native
// analogue of web/src/components/data-display/LiveIndicator.tsx. No Compose, no Android framework, no HTTP:
// every declaration here is exercised off-device in the :app:testReleaseUnitTest gate, keeping the composable
// a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces): an at-a-glance chip
// reflecting the HEALTH OF THE LIVE-DATA WIRE (SSE), derived from `useLiveConnection`. It renders the four
// states the hook surfaces, with the precedence connected > reconnecting > disconnected > unknown:
//   • connected    — emerald Wifi, "Live" plus a "· {relative-time}" freshness stamp (pill only);
//   • reconnecting — amber spinning Loader2, "Reconnecting…";
//   • disconnected — rose WifiOff, "Offline";
//   • unknown      — muted WifiOff, "Unknown" (a cold start that has never connected).
// Three variants: `pill` (icon + label + freshness), `dot` (a bare colored dot, no text), `compact`
// (icon + label, no freshness). It is explicitly NOT a per-datum freshness chip (that is DataFreshness) — this
// reflects the wire, not the age of a single value.
//
// How that maps onto the native shared state-holder layer (P1/S8, ADR-002, ADR-009): the surface binds the
// app-scoped live pipeline (`io.teslasync.android.data.live.LiveSessionStore`, the native `useLiveConnection`
// port) through [LiveIndicatorSource], projecting each session frame onto the PII-free [LiveConnectionSnapshot]
// the composable renders. The platform "every state renders" contract is honoured by the same four wire
// states: the cold-start loading / empty surface IS [LiveConnectionStatus.Unknown]; a failed wire (error /
// offline) IS [LiveConnectionStatus.Disconnected]; the >2-minute stale window the live layer flags
// ([io.teslasync.android.data.live.LiveSessionState.isStale]) is carried as [LiveConnectionSnapshot.stale] and
// shows as the connected chip with an aged freshness stamp (web parity — the wire is up; deep staleness is
// surfaced by the sibling LiveStaleDataBanner, exactly as the web splits indicator-vs-freshness). No branch is
// ever hidden: every status paints a non-blank chip or dot. Everything below is framework-free so the whole
// contract is covered by the JVM unit gate without a Compose host.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/LiveIndicator — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.liveindicator

import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the LiveIndicator surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`LiveIndicator`).
 */
object LiveIndicatorRegistration {
    /** Stable surface id (also the `viewModel` key the host binds the indicator with). */
    const val ID: String = "live-indicator"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "LiveIndicator"
}

/**
 * The three visual variants of the web `LiveIndicator`:
 *  - [Pill] colored chip with icon, label, and (when connected) a freshness stamp;
 *  - [Dot] a bare colored dot with no text, for dense headers / the app shell;
 *  - [Compact] colored chip with icon + label, but no freshness stamp.
 */
enum class LiveIndicatorVariant { Pill, Dot, Compact }

/**
 * The PII-free projection of the live pipeline the indicator renders — it carries no vehicle id and no signal
 * payload, only the wire-health signals. Folded from [io.teslasync.android.data.live.LiveSessionState] by
 * [LiveIndicatorSource].
 *
 * @property status the wire health (web `useLiveConnection().status`).
 * @property lastMessageAtMillis client clock of the last live message of any kind, or `null` when none yet
 *   (web `lastMessageAt`); drives the connected chip's "· {relative-time}" freshness stamp.
 * @property stale whether the open stream has gone silent past the 2-minute window (ADR-013) — the live
 *   layer's `isStale`; the wire is still [LiveConnectionStatus.Connected] but the freshness stamp ages.
 */
data class LiveConnectionSnapshot(
    val status: LiveConnectionStatus,
    val lastMessageAtMillis: Long?,
    val stale: Boolean,
) {
    companion object {
        /** The initial, pre-collection snapshot: a cold start that has never connected (web `unknown`). */
        fun unknown(): LiveConnectionSnapshot =
            LiveConnectionSnapshot(
                status = LiveConnectionStatus.Unknown,
                lastMessageAtMillis = null,
                stale = false,
            )
    }
}

/** The relative-time bucket the freshness stamp resolves to — the native mirror of web `formatRelativeTime`. */
enum class RelativeUnit {
    /** Held stable for the whole first minute (web `< 60s` → "Just now"). */
    JustNow,

    /** Whole minutes (web `< 60min`). */
    Minutes,

    /** Whole hours (web `< 24h`). */
    Hours,

    /** A localized absolute date once past a day (web `formatRelativeTime`'s date fall-through). */
    Absolute,

    /** Nothing to show — never received a live message (web empty relative-time string). */
    None,
}

/**
 * A resolved relative-time label, framework-free so it is unit-tested off-device. [unit] selects the i18n
 * string the composable resolves; [value] is the whole-unit count for [RelativeUnit.Minutes] / [Hours]; and
 * [atMillis] carries the epoch-millisecond stamp the composable formats for [RelativeUnit.Absolute].
 */
data class RelativeLabel(
    val unit: RelativeUnit,
    val value: Int = 0,
    val atMillis: Long? = null,
)

/**
 * The fully-resolved render state the composable paints — the native mirror of everything the web
 * `LiveIndicator` decides between `useLiveConnection` and the rendered `<span>`. Pure, so the composable only
 * resolves colors + localized strings from it.
 *
 * @property status the wire health (drives color + icon + label).
 * @property variant the visual variant the host requested (drives dot-vs-chip layout).
 * @property freshness the relative-time stamp ([RelativeUnit.None] paints no stamp).
 * @property showFreshness whether the freshness stamp renders (web `variant === 'pill' && connected &&
 *   lastMessageAt`).
 * @property spin whether the icon spins (web reconnecting `animate-spin`, suppressed under reduced motion).
 * @property stale whether the connected wire has aged past the staleness window (carried for tests + styling).
 */
data class LiveRender(
    val status: LiveConnectionStatus,
    val variant: LiveIndicatorVariant,
    val freshness: RelativeLabel,
    val showFreshness: Boolean,
    val spin: Boolean,
    val stale: Boolean,
)

/**
 * Pure projection of a [LiveConnectionSnapshot] into the render state — the native mirror of everything the
 * web `LiveIndicator` decides between its hook and the rendered chip. Framework-free so the whole contract is
 * covered by the JVM unit gate without a Compose host.
 */
object LiveIndicatorProjection {
    private const val MILLIS_PER_SECOND = 1_000L
    private const val SECONDS_PER_MINUTE = 60L
    private const val SECONDS_PER_HOUR = 3_600L
    private const val SECONDS_PER_DAY = 86_400L

    /**
     * Projects [snapshot] for [variant] at wall-clock [nowMs] into the render state. [reduceMotion] suppresses
     * the reconnecting icon spin (web reduced-motion branch). The freshness stamp renders only for the pill
     * variant while connected with a known last-message time, exactly as the web inline condition does.
     */
    fun render(
        snapshot: LiveConnectionSnapshot,
        variant: LiveIndicatorVariant,
        nowMs: Long,
        reduceMotion: Boolean,
    ): LiveRender {
        val connected = snapshot.status == LiveConnectionStatus.Connected
        return LiveRender(
            status = snapshot.status,
            variant = variant,
            freshness = relativeLabel(snapshot.lastMessageAtMillis, nowMs),
            showFreshness = variant == LiveIndicatorVariant.Pill && connected && snapshot.lastMessageAtMillis != null,
            spin = snapshot.status == LiveConnectionStatus.Reconnecting && !reduceMotion,
            stale = snapshot.stale,
        )
    }

    /**
     * The freshness stamp, mirroring the web `formatRelativeTime`: "Just now" for the first minute, whole
     * minutes (`< 60min`), whole hours (`< 24h`), then a localized absolute date. A `null` stamp resolves to
     * [RelativeUnit.None] (never received a message), and negative clock skew clamps to "Just now".
     */
    fun relativeLabel(
        lastMessageAtMillis: Long?,
        nowMs: Long,
    ): RelativeLabel {
        if (lastMessageAtMillis == null) return RelativeLabel(RelativeUnit.None)
        val seconds = ((nowMs - lastMessageAtMillis) / MILLIS_PER_SECOND).coerceAtLeast(0)
        return when {
            seconds < SECONDS_PER_MINUTE -> RelativeLabel(RelativeUnit.JustNow)
            seconds < SECONDS_PER_HOUR -> RelativeLabel(RelativeUnit.Minutes, (seconds / SECONDS_PER_MINUTE).toInt())
            seconds < SECONDS_PER_DAY -> RelativeLabel(RelativeUnit.Hours, (seconds / SECONDS_PER_HOUR).toInt())
            else -> RelativeLabel(RelativeUnit.Absolute, atMillis = lastMessageAtMillis)
        }
    }
}

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [LiveIndicatorRegistration.SLUG]
 * (P1/S11) — never a vehicle id nor a connection payload, so a diagnostics line can never leak which session a
 * user was viewing. Kept free of Compose so it is unit-tested with a recording [Logger]; the ViewModel calls
 * it once per surface open.
 */
fun recordLiveIndicatorOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to LiveIndicatorRegistration.SLUG))
}
