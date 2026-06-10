package io.teslasync.android.components.datadisplay

/*
 * Canonical alert/notification severity + normalization — the Android counterpart of the web
 * lib/tokens severity helpers. Pure logic so SeverityBadge, StatusDot, and the FSM badge
 * resolve a single source of truth and the color mapping stays in DataDisplayColors.
 */

/** Canonical severity. Wire values are normalized onto this set via [normalizeSeverity]. */
enum class Severity { Info, Warn, Critical, Success }

/**
 * Maps any incoming wire-level severity string (including the legacy `warning`, `error`,
 * `fatal`, `ok` aliases) onto the canonical [Severity]. Unknown / null values fall back to
 * [Severity.Info] so the UI never crashes on a typo.
 */
fun normalizeSeverity(raw: String?): Severity {
    val value = raw?.trim()?.lowercase()
    if (value.isNullOrEmpty()) return Severity.Info
    return when (value) {
        "warning", "warn" -> Severity.Warn
        "error", "fatal", "critical" -> Severity.Critical
        "ok", "success" -> Severity.Success
        "info" -> Severity.Info
        else -> Severity.Info
    }
}
