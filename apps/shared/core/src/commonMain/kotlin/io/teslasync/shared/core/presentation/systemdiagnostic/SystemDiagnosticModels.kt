package io.teslasync.shared.core.presentation.systemdiagnostic

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/*
 * The wire shapes of the aggregated self-test — the cross-platform port of the web
 * `DiagnosticReport` / `DiagnosticCheck` interfaces (web/src/api/types.ts), which mirror the Go
 * handler structs in `internal/api/diagnostic/handler.go`. Keys arrive snake_case from
 * `POST /api/v1/system/diagnostic`; they are matched verbatim via @SerialName so the decoded
 * payload round-trips unchanged.
 *
 * No field is display-unit-bearing — [DiagnosticCheck.durationMs] is a raw milliseconds count the
 * render boundary labels, the statuses are backend enums, and the stamps are ISO strings — so there
 * is no SI conversion at this layer; any display formatting is the render boundary's job (S5).
 */

/**
 * One probe result inside a [DiagnosticReport] — the cross-platform port of the web
 * `DiagnosticCheck` interface, mirroring the Go `diagnostic.DiagnosticCheck` struct.
 *
 * @property id stable check identifier (e.g. `tesla_token`, `signal_log_freshness`).
 * @property name human-readable label rendered next to the status chip.
 * @property status the per-check outcome (`ok` | `warn` | `fail`, web `DiagnosticCheckStatus`).
 * @property detail operator-facing description of what the probe observed; empty when the backend
 *   omits it (the web formatter renders the `detail:` line only when non-empty).
 * @property remediation optional fix-it hint; `null`/absent when the check passed or has no advice
 *   (the Go field is `omitempty`, so the key may be missing on the wire entirely).
 * @property durationMs how long the probe took, in milliseconds (web `duration_ms`).
 */
@Serializable
public data class DiagnosticCheck(
    val id: String = "",
    val name: String = "",
    val status: String = "",
    val detail: String = "",
    val remediation: String? = null,
    @SerialName("duration_ms") val durationMs: Long = 0,
)

/**
 * The `POST /system/diagnostic` envelope — the cross-platform port of the web `DiagnosticReport`
 * interface, mirroring the Go `diagnostic.DiagnosticReport` struct.
 *
 * @property generatedAt ISO-8601 UTC instant the report was composed (web `generated_at`).
 * @property overallStatus the rolled-up fleet-of-checks verdict (`ok` | `degraded` | `down`, web
 *   `DiagnosticOverallStatus`).
 * @property checks the per-dependency probe results, in the order the orchestrator ran them.
 */
@Serializable
public data class DiagnosticReport(
    @SerialName("generated_at") val generatedAt: String = "",
    @SerialName("overall_status") val overallStatus: String = "",
    val checks: List<DiagnosticCheck> = emptyList(),
)
