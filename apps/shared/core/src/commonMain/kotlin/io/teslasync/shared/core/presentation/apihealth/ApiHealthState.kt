package io.teslasync.shared.core.presentation.apihealth

import io.teslasync.shared.core.data.repo.ApiHealthProbe

/**
 * Coarse-grained API-health bucket surfaced to the footer status indicator — the cross-platform
 * analogue of the web `ApiHealthStatus` union (web/src/api/hooks/useApiHealth.ts).
 *
 * The tiers are chosen so the indicator turns yellow ([DEGRADED]) before something is truly
 * broken, matching the web thresholds verbatim:
 *  - [OK]       — 2xx response under [ApiHealth.DEGRADED_LATENCY_MS];
 *  - [DEGRADED] — 2xx response at/over that threshold (server is slow but up);
 *  - [OFFLINE]  — non-2xx, transport failure, or no response within the probe deadline;
 *  - [UNKNOWN]  — no probe has completed yet.
 */
public enum class ApiHealthStatus {
    OK,
    DEGRADED,
    OFFLINE,
    UNKNOWN,
}

/**
 * The footer-bar view of API health — the platform-agnostic port of the web `ApiHealthState`
 * interface. SI/raw values only: [latencyMs] is whole milliseconds and [lastCheckedAt] is the
 * verbatim ISO-8601 stamp from the probe; any locale/relative-time rendering is a display-layer
 * concern (S5), never done here.
 *
 * @property status coarse health bucket (see [ApiHealthStatus]).
 * @property latencyMs most recent measured round-trip in milliseconds, or `null` if never measured.
 * @property lastCheckedAt ISO-8601 timestamp of the last completed probe, or `null`.
 */
public data class ApiHealthState(
    public val status: ApiHealthStatus,
    public val latencyMs: Long?,
    public val lastCheckedAt: String?,
)

/**
 * Pure, side-effect-free derivation from a raw [ApiHealthProbe] to the displayed
 * [ApiHealthState], extracted so the KMP state holder, its golden vectors, and the future
 * Windows C# port all bucket identically (ADR-004). Mirrors the web hook's `bucket()` plus its
 * `if (!data) unknown` composition exactly.
 */
public object ApiHealth {
    /** Round-trip at/over this many milliseconds downgrades a 2xx probe to [ApiHealthStatus.DEGRADED]. */
    public const val DEGRADED_LATENCY_MS: Long = 500

    /** The state before any probe has completed — the web hook's `!data` branch. */
    public val UNKNOWN: ApiHealthState =
        ApiHealthState(status = ApiHealthStatus.UNKNOWN, latencyMs = null, lastCheckedAt = null)

    /**
     * Buckets a completed [probe] into a coarse status. A failed probe is always
     * [ApiHealthStatus.OFFLINE] regardless of how fast it failed; an `ok` probe is
     * [ApiHealthStatus.DEGRADED] at/over [DEGRADED_LATENCY_MS] and [ApiHealthStatus.OK] below it.
     */
    public fun bucket(probe: ApiHealthProbe): ApiHealthStatus =
        when {
            !probe.ok -> ApiHealthStatus.OFFLINE
            probe.latencyMs >= DEGRADED_LATENCY_MS -> ApiHealthStatus.DEGRADED
            else -> ApiHealthStatus.OK
        }

    /**
     * Composes the displayed state from the latest [probe], or [UNKNOWN] when none has completed
     * (`probe == null`) — the verbatim web `if (!data) { status: 'unknown', ... }` branch.
     */
    public fun deriveState(probe: ApiHealthProbe?): ApiHealthState =
        if (probe == null) {
            UNKNOWN
        } else {
            ApiHealthState(
                status = bucket(probe),
                latencyMs = probe.latencyMs,
                lastCheckedAt = probe.checkedAt,
            )
        }
}
