// Pure, framework-free model + projection + diagnostics for the ConnectionSegment shared surface — the native
// analogue of web/src/components/layout/status-bar/ConnectionSegment.tsx. No Compose, no Android framework, no
// HTTP: every declaration here is exercised off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// WHAT THE WEB SOURCE IS (and therefore the COMPLETE branch set this surface reproduces). The web file is the
// footer status-bar's API-connection-health segment, derived from `useApiHealth` (a 15s poll of the backend
// root `/healthz`). It surfaces four coarse health tiers, each paired with BOTH a colour AND an icon so the
// state stays legible to users with colour-vision differences:
//   • ok       — emerald Activity, "Online", "API · {latency}ms";
//   • degraded — amber AlertTriangle, "Degraded", "API · {latency}ms";
//   • offline  — rose CircleSlash, "Offline", "API · Offline";
//   • unknown  — muted HelpCircle, "Connecting…", "API" (the `!data` cold-start before the first probe).
// The whole segment is a deep link to the System Status screen, carries a tooltip
// ("API connection · {state}[ · {latency}ms]") and an aria-label ("API connection status: {state}[ ({latency}ms)]"),
// and honours an `iconOnly` prop that drops the label + latency, leaving just the dot + icon.
//
// HOW THAT MAPS ONTO THE NATIVE SHARED STATE-HOLDER LAYER (P1/S8, ADR-002). The web hook's domain has a literal
// cross-platform counterpart: the shared-core `ApiHealthStore` (commonMain) — the KMP port of `useApiHealth`
// that owns the `/healthz` probe, the 15s poll cadence, and the identical bucketing thresholds, exposing a hot
// `StateFlow<ApiHealthState>`. This surface binds THAT through [ConnectionSegmentSource]; the view performs no
// HTTP and opens no poll itself. The shared [io.teslasync.shared.core.presentation.apihealth.ApiHealthStatus]
// is reused verbatim as the tier enum so native and web bucket identically.
//
// The platform "every state renders — no hidden surfaces" contract maps the generic loading / empty / error /
// stale / offline matrix onto the web source's real tiers (a status segment surfaces one scalar health value,
// not a list, so it never has a blank region):
//   • loading / empty → the UNKNOWN tier (the web `!data` cold start before the first probe completes — a
//     non-blank "API · Connecting…" with the HelpCircle glyph);
//   • error / offline → the OFFLINE tier (a non-2xx / transport-failure / timed-out probe — "API · Offline"
//     with the CircleSlash glyph; tapping the segment deep-links to the System Status screen, the triage /
//     retry affordance);
//   • stale → derived honestly from the probe freshness the shared model already carries
//     ([ApiHealthState.lastCheckedAt]): when the most recent probe of an up tier (ok / degraded) is older than
//     [ConnectionSegmentProjection.DEFAULT_STALE_WINDOW_MS] (the poll has stopped refreshing — e.g. the surface
//     scrolled off and `WhileSubscribed` suspended it), the last-known tier is shown with its measurement
//     replaced by the localized "Stale" hint and the tooltip / aria disclosing the staleness, rather than
//     presenting an aged latency as live.
//
// Everything below is framework-free so the whole contract is covered by the JVM unit gate without a Compose
// host.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/ConnectionSegment — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName`
// is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.connectionsegment

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.apihealth.ApiHealthStatus

/**
 * Canonical registry metadata for the ConnectionSegment surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`ConnectionSegment`); [ID]
 * is the stable `viewModel` key the host binds the surface with.
 */
object ConnectionSegmentRegistration {
    /** Stable surface id (also the `viewModel` key the host binds the surface with). */
    const val ID: String = "connection-segment"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ConnectionSegment"
}

/**
 * The two visual variants of the web `ConnectionSegment`, mirroring its `iconOnly` prop:
 *  - [Full] the dot + icon + "API" label + a latency / offline / stale suffix;
 *  - [IconOnly] the bare dot + icon, for the densest status-bar placements (web `iconOnly`).
 */
enum class ConnectionSegmentVariant { Full, IconOnly }

/**
 * The PII-free projection of the shared API-health poll the segment renders — it carries no vehicle id and no
 * request payload, only the coarse health tier and its timing. Folded from
 * [io.teslasync.shared.core.presentation.apihealth.ApiHealthState] by [ConnectionSegmentSource].
 *
 * @property status the coarse health tier (web `useApiHealth().status`).
 * @property latencyMs the most recent measured round-trip in whole milliseconds, or `null` if never measured
 *   (web `latencyMs`).
 * @property lastCheckedAtMillis epoch-millisecond stamp of the last completed probe (parsed from the shared
 *   model's ISO `lastCheckedAt`), or `null` when no probe has completed; drives the freshness / stale fold.
 */
data class ConnectionSnapshot(
    val status: ApiHealthStatus,
    val latencyMs: Long?,
    val lastCheckedAtMillis: Long?,
) {
    companion object {
        /** The initial, pre-collection snapshot: a cold start before any probe completes (web `!data`). */
        fun unknown(): ConnectionSnapshot =
            ConnectionSnapshot(
                status = ApiHealthStatus.UNKNOWN,
                latencyMs = null,
                lastCheckedAtMillis = null,
            )
    }
}

/**
 * Localized labels the surface folds into its output. Built from `stringResource` at the render boundary
 * (tests pass a deterministic instance), keeping [ConnectionSegmentProjection] a pure, locale-stable function.
 * Every string resolves through the P1/S10 catalog.
 *
 * @property short the short label shown beside the icon (web `t('statusBar.connection.short', 'API')`).
 * @property online / [degraded] / [offline] / [connecting] the per-tier state labels (web `stateLabel`).
 * @property tooltip the tooltip lead-in (web `t('statusBar.connection.tooltip', 'API connection')`).
 * @property aria the accessibility lead-in (web `t('statusBar.connection.aria', 'API connection status')`).
 * @property stale the freshness hint shown when an up tier's probe has aged past the window.
 */
data class ConnectionSegmentStrings(
    val short: String,
    val online: String,
    val degraded: String,
    val offline: String,
    val connecting: String,
    val tooltip: String,
    val aria: String,
    val stale: String,
)

/**
 * The fully-resolved render state the composable paints — the native mirror of everything the web
 * `ConnectionSegment` folds together (the tier, the latency, whether each suffix shows) before returning its
 * JSX. Pure, so the composable only resolves colours + localized strings from it.
 *
 * @property status the health tier (drives colour + icon + state label).
 * @property variant the visual variant the host requested (drives label-vs-icon-only layout).
 * @property latencyMs the last measured round-trip, or `null` (web `latencyMs`).
 * @property stale whether an up tier's last probe has aged past the freshness window (carried for the stale
 *   suffix + the tooltip / aria disclosure).
 */
data class ConnectionRender(
    val status: ApiHealthStatus,
    val variant: ConnectionSegmentVariant,
    val latencyMs: Long?,
    val stale: Boolean,
) {
    /** The offline tier (web `status === 'offline'`) — the failed-probe error surface. */
    val isOffline: Boolean get() = status == ApiHealthStatus.OFFLINE

    /** The cold-start tier (web `status === 'unknown'`) — the loading / empty surface. */
    val isUnknown: Boolean get() = status == ApiHealthStatus.UNKNOWN

    /**
     * Whether a measured latency should colour the tooltip / aria — the verbatim web gate
     * `latencyMs != null && status !== 'offline'` (the offline tier hides its failed-probe latency; the
     * unknown tier has no latency at all).
     */
    val hasMeasuredLatency: Boolean get() = latencyMs != null && !isOffline

    /** Whether the Full variant shows the "· {latency}ms" suffix (web ok / degraded with a fresh measurement). */
    val showLatencySuffix: Boolean get() = !isOffline && !isUnknown && latencyMs != null && !stale

    /** Whether the Full variant shows the "· Stale" suffix instead of a now-aged latency (the freshness fold). */
    val showStaleSuffix: Boolean get() = stale && !isOffline && !isUnknown

    /** Whether the Full variant shows the "· Offline" suffix (web `status === 'offline'`). */
    val showOfflineSuffix: Boolean get() = isOffline
}

/**
 * Pure projection of a [ConnectionSnapshot] into the [ConnectionRender] plus the tooltip / aria / label
 * derivations — the native mirror of every decision the web `ConnectionSegment` makes between its hook and the
 * rendered link. Framework-free so the whole contract is covered by the JVM unit gate without a Compose host.
 */
object ConnectionSegmentProjection {
    /**
     * An up tier's probe older than this many milliseconds is treated as stale (the poll has stopped
     * refreshing). Three poll intervals (the shared store's cadence is 15s), so ordinary polling jitter never
     * trips it — only a genuinely suspended poll does.
     */
    const val DEFAULT_STALE_WINDOW_MS: Long = 45_000L

    private const val LATENCY_UNIT = "ms"
    private const val EMPTY_VALUE = "\u2014"
    private const val SEPARATOR = " \u00b7 "

    /**
     * Folds the [snapshot] for [variant] at wall-clock [nowMs] into the render state, deriving staleness from
     * the last probe's age against [staleWindowMs]. Pure: the composable resolves only colours + localized
     * strings from the result.
     */
    fun render(
        snapshot: ConnectionSnapshot,
        variant: ConnectionSegmentVariant,
        nowMs: Long,
        staleWindowMs: Long = DEFAULT_STALE_WINDOW_MS,
    ): ConnectionRender =
        ConnectionRender(
            status = snapshot.status,
            variant = variant,
            latencyMs = snapshot.latencyMs,
            stale = isStale(snapshot, nowMs, staleWindowMs),
        )

    /**
     * Whether the [snapshot]'s last probe has aged past [staleWindowMs]. Staleness is only meaningful for an up
     * tier (ok / degraded) with a known probe time: a failed (offline) or never-probed (unknown) tier is its
     * own surface and is never additionally "stale".
     */
    fun isStale(
        snapshot: ConnectionSnapshot,
        nowMs: Long,
        staleWindowMs: Long = DEFAULT_STALE_WINDOW_MS,
    ): Boolean {
        val upTier = snapshot.status == ApiHealthStatus.OK || snapshot.status == ApiHealthStatus.DEGRADED
        val checkedAt = snapshot.lastCheckedAtMillis
        return upTier && checkedAt != null && nowMs - checkedAt >= staleWindowMs
    }

    /** The localized state label for a tier (web `stateLabel[status]`). */
    fun stateLabel(
        status: ApiHealthStatus,
        strings: ConnectionSegmentStrings,
    ): String =
        when (status) {
            ApiHealthStatus.OK -> strings.online
            ApiHealthStatus.DEGRADED -> strings.degraded
            ApiHealthStatus.OFFLINE -> strings.offline
            ApiHealthStatus.UNKNOWN -> strings.connecting
        }

    /** The latency chip text — "{latencyMs}ms", or an em dash when never measured (web `latencyLabel`). */
    fun latencyLabel(latencyMs: Long?): String = if (latencyMs != null) "$latencyMs$LATENCY_UNIT" else EMPTY_VALUE

    /**
     * The tooltip text — the verbatim web composition `${tooltip} · ${stateLabel}` plus a ` · {latency}` when a
     * measured latency is shown (`latencyMs != null && status !== 'offline'`), extended with a trailing
     * ` · {stale}` when an up tier's probe has aged so the disclosure is honest rather than presenting an old
     * measurement as live.
     */
    fun tooltipText(
        render: ConnectionRender,
        strings: ConnectionSegmentStrings,
    ): String {
        val parts = mutableListOf(strings.tooltip, stateLabel(render.status, strings))
        if (render.hasMeasuredLatency) parts += latencyLabel(render.latencyMs)
        if (render.stale) parts += strings.stale
        return parts.joinToString(SEPARATOR)
    }

    /**
     * The spoken (TalkBack) label — the verbatim web `aria-label` composition `${aria}: ${stateLabel}` plus a
     * ` (${latency})` when a measured latency is shown, extended with a trailing `, {stale}` when the up tier's
     * probe has aged. A pure function so the a11y contract is unit-tested off-device.
     */
    fun spokenLabel(
        render: ConnectionRender,
        strings: ConnectionSegmentStrings,
    ): String {
        val base = "${strings.aria}: ${stateLabel(render.status, strings)}"
        val withLatency = if (render.hasMeasuredLatency) "$base (${latencyLabel(render.latencyMs)})" else base
        return if (render.stale) "$withLatency, ${strings.stale}" else withLatency
    }
}

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface
 * [ConnectionSegmentRegistration.SLUG] (P1/S11) — never a vehicle id, latency, or request payload, so a
 * diagnostics line can never leak anything about the user's session. Kept free of Compose so it is unit-tested
 * with a recording [Logger]; the ViewModel calls it once per surface open.
 */
fun recordConnectionSegmentOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to ConnectionSegmentRegistration.SLUG))
}
