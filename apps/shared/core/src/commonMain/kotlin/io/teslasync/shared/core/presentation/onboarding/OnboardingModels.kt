package io.teslasync.shared.core.presentation.onboarding

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The first-run onboarding gate contract returned by `GET /api/v1/onboarding/status` — the
 * cross-platform port of the web `OnboardingStatus` interface
 * (web/src/api/hooks/useOnboarding.ts), which mirrors the Go `onboardingStatusResponse`
 * (internal/api/onboarding/handler.go). The backend reports three independent anchors that ALL
 * must hold before TeslaSync considers an install "set up":
 *
 *  1. [teslaConnected] — a Tesla OAuth token has been stored;
 *  2. [vehicleCount]   — at least one vehicle row exists locally;
 *  3. [dataFlowing]    — telemetry has arrived within the last 24 hours.
 *
 * [isComplete] is the server-computed AND of all three (`tesla_connected && vehicle_count > 0 &&
 * data_flowing`); clients read it directly rather than re-implementing the gate, exactly as the
 * web hook prefers `is_complete` over recomputing the logic on the frontend. Keys arrive
 * snake_case and are matched verbatim via @SerialName so the cached payload round-trips unchanged.
 * Every field defaults to the "not set up yet" value so a partial / first-boot payload decodes to
 * the safe pessimistic gate rather than failing the contract read. None of these fields is
 * unit-bearing, so there is no SI conversion at this layer.
 *
 * @property teslaConnected whether a Tesla OAuth token has been stored.
 * @property vehicleCount number of locally known vehicle rows.
 * @property dataFlowing whether telemetry arrived within the last 24 hours.
 * @property isComplete the server-side AND of the three anchors — the gate value clients read.
 */
@Serializable
public data class OnboardingStatus(
    @SerialName("tesla_connected") public val teslaConnected: Boolean = false,
    @SerialName("vehicle_count") public val vehicleCount: Int = 0,
    @SerialName("data_flowing") public val dataFlowing: Boolean = false,
    @SerialName("is_complete") public val isComplete: Boolean = false,
)

/**
 * Pure, side-effect-free derivations ported from the web `useOnboardingStatus` hook, extracted so
 * the KMP state holder, its golden vectors, and the future Windows C# port all decide identically
 * (ADR-004).
 *
 * The one non-trivial client-side rule is the poll-stop decision — the verbatim web
 * `refetchInterval: (query) => query.state.data?.is_complete ? false : 30_000`: keep polling while
 * the gate has not completed (including before any status has resolved), and stop the moment
 * `is_complete` flips true. The 30-second cadence is fast enough for a vehicle sync (≤60s) and a
 * first signal batch (≤5min) to feel responsive without spamming the backend.
 */
public object Onboarding {
    /** The poll cadence while onboarding is in progress — the web `refetchInterval` 30s. */
    public const val POLL_INTERVAL_MILLIS: Long = 30_000

    /**
     * Whether the gate should keep polling given the current best-known [status]. Mirrors the web
     * `data?.is_complete ? false : 30_000`: a `null` status (nothing resolved yet) and any
     * non-complete status keep polling; only a completed status stops it. Locked by golden vectors
     * shared with the C# port.
     */
    public fun shouldPoll(status: OnboardingStatus?): Boolean = status?.isComplete != true
}
