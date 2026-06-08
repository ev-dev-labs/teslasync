package io.teslasync.shared.core.presentation.system

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/*
 * The wire shapes of the rate-limit status feed — the cross-platform port of the web
 * `useSystem` hook domain's response types (web/src/api/types.ts: `RateLimitStatusResponse`,
 * `ScopeBudget`), which mirror the Go handler in `internal/api/ratelimit`. Keys arrive
 * snake_case from `GET /api/v1/system/rate-limits`; they are matched verbatim via @SerialName so
 * the cached payload round-trips unchanged.
 *
 * None of these fields is display-unit-bearing — `current`/`limit` are scope-native counts in the
 * same unit (the web `fmtNumber` renders either), `windowSeconds` is a raw seconds count surfaced
 * as a label, and `severity` is a backend enum — so there is no SI conversion at this layer; any
 * display formatting is the render boundary's job (S5).
 */

/**
 * One rate-limit scope row (web `ScopeBudget`), as returned in [RateLimitStatusResponse.scopes].
 *
 * @property id stable scope identifier (see the backend `RateLimitScope*` constants).
 * @property name human-readable label rendered next to the bar.
 * @property current observed usage in the same unit as [limit].
 * @property limit per-window cap; floats so fractional bucket states round-trip without loss.
 * @property windowSeconds sliding-window length in seconds; zero means a token-bucket snapshot.
 * @property resetAt optional ISO-8601 UTC instant at which the bucket fully refills (token-bucket
 *   scopes only); `null` for continuously-rolling sliding-window scopes.
 * @property severity colour band the panel renders (`ok` | `warn` | `critical`).
 * @property detail operator-facing footnote shown under the row; empty when the backend omits it.
 */
@Serializable
public data class ScopeBudget(
    val id: String,
    val name: String,
    val current: Double = 0.0,
    val limit: Double = 0.0,
    @SerialName("window_seconds") val windowSeconds: Int = 0,
    @SerialName("reset_at") val resetAt: String? = null,
    val severity: String,
    val detail: String = "",
)

/**
 * The `GET /system/rate-limits` envelope (web `RateLimitStatusResponse`).
 *
 * @property generatedAt ISO-8601 UTC instant the snapshot was composed (web `generated_at`).
 * @property scopes the per-scope budget rows; empty when no dependency (Tesla client, counters)
 *   is wired, exactly as the backend omits a row rather than fabricating fake data.
 */
@Serializable
public data class RateLimitStatusResponse(
    @SerialName("generated_at") val generatedAt: String = "",
    val scopes: List<ScopeBudget> = emptyList(),
)
