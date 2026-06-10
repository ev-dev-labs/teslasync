package io.teslasync.shared.core.presentation.admin

/**
 * Operator input for the maintenance/degraded-mode override — the cross-platform port
 * of the web `MaintenanceUpdateInput` (web/src/types/admin.ts). Mirrors the web
 * mutation body for `POST /admin/maintenance`: [mode] is required; [message] defaults
 * to an empty string and [until] (an ISO-8601 instant, or `null` for "no end") are
 * optional, exactly as the web hook serialises them.
 *
 * @property mode one of `ok`, `degraded`, `maintenance` (validated server-side).
 * @property message human-readable banner text; empty string when omitted.
 * @property until ISO-8601 expiry instant, or `null` for an open-ended override.
 */
public data class MaintenanceUpdateInput(
    public val mode: String,
    public val message: String? = null,
    public val until: String? = null,
)
