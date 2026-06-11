package io.teslasync.android.notifications

/**
 * The severity of a notification's in-app banner / channel importance (P3/A6). Derived from the push
 * `category` (when present) or the [NotificationKind], it sets the banner accent and informs the
 * Android channel importance.
 */
enum class BannerSeverity {
    /** Informational — the default. */
    Info,

    /** A warning the user should notice but that is not urgent. */
    Warning,

    /** Urgent — alerts, security and incidents that may break through quiet hours. */
    Critical,
}

/** Maps a wire `category` string and a [NotificationKind] to a [BannerSeverity] (tolerant, total). */
object BannerSeverities {
    /** Resolves the severity from an optional [category] string, falling back to the [kind]'s severity. */
    fun of(
        category: String?,
        kind: NotificationKind,
    ): BannerSeverity =
        when (category?.trim()?.lowercase()) {
            "critical", "alert", "security", "error" -> BannerSeverity.Critical
            "warning", "warn" -> BannerSeverity.Warning
            "info", "informational" -> BannerSeverity.Info
            else -> severityOf(kind)
        }

    private fun severityOf(kind: NotificationKind): BannerSeverity =
        when (kind) {
            NotificationKind.Alert, NotificationKind.SystemIncident, NotificationKind.ReauthNeeded -> BannerSeverity.Critical
            NotificationKind.CommandResult -> BannerSeverity.Warning
            else -> BannerSeverity.Info
        }
}
