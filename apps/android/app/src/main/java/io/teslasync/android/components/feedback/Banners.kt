package io.teslasync.android.components.feedback

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import io.teslasync.android.components.ui.TeslaGlyphs

/*
 * Thin, opinionated wrappers over [AlertBanner] mirroring the web status-banner family
 * (`OfflineBanner`, `LiveStaleDataBanner`, `TeslaReauthBanner`, `RateLimitBanner`,
 * `MaintenanceBanner`, `ImpersonationBanner`, `BrowserCompatBanner`, `NewVersionBanner`,
 * `EditConflictBanner`, `TimeMachineBanner`, `DraftRecoveryBanner`, `CookieConsentBanner`). Each
 * pre-fills the right tone, glyph, copy, and actions so pages drop one element in and get the
 * correct, never-blank status surface.
 */

/** Connectivity-lost banner — mirrors web `OfflineBanner`. */
@Composable
fun OfflineBanner(
    modifier: Modifier = Modifier,
    message: String = "You're offline. Some data may be out of date.",
    onRetry: (() -> Unit)? = null,
) {
    AlertBanner(
        message = message,
        modifier = modifier,
        tone = Tone.Warning,
        title = "Offline",
        icon = FeedbackGlyphs.WifiOff,
        action = onRetry?.let { BannerAction("Retry", it) },
    )
}

/** ">2 min since live data updated" banner — mirrors web `LiveStaleDataBanner`. */
@Composable
fun LiveStaleDataBanner(
    modifier: Modifier = Modifier,
    staleForLabel: String? = null,
    onReconnect: (() -> Unit)? = null,
) {
    val detail = staleForLabel?.let { "Live data hasn't updated in $it." } ?: "Live data has stopped updating."
    AlertBanner(
        message = "$detail Attempting to reconnect…",
        modifier = modifier,
        tone = Tone.Warning,
        title = "Live data stale",
        icon = FeedbackGlyphs.WifiOff,
        action = onReconnect?.let { BannerAction("Reconnect", it) },
    )
}

/** Tesla Fleet token expiry banner — mirrors web `TeslaReauthBanner`. */
@Composable
fun TeslaReauthBanner(
    onReconnect: () -> Unit,
    modifier: Modifier = Modifier,
    message: String = "Your Tesla connection expired. Reconnect to resume live data.",
) {
    AlertBanner(
        message = message,
        modifier = modifier,
        tone = Tone.Warning,
        title = "Tesla connection expired",
        icon = FeedbackGlyphs.Bolt,
        action = BannerAction("Reconnect", onReconnect),
    )
}

/** Rate-limit / upstream-breaker cooldown banner — mirrors web `RateLimitBanner`. */
@Composable
fun RateLimitBanner(
    remaining: Int,
    modifier: Modifier = Modifier,
    upstreamDown: Boolean = false,
    onRetry: (() -> Unit)? = null,
    onDismiss: (() -> Unit)? = null,
) {
    val message =
        if (upstreamDown) {
            "Tesla upstream unavailable — retry in ${remaining}s."
        } else {
            "Too many requests — pausing for ${remaining}s."
        }
    val retry = onRetry?.takeIf { retryEnabled(remaining) }
    AlertBanner(
        message = message,
        modifier = modifier,
        tone = Tone.Warning,
        title = if (upstreamDown) "Upstream unavailable" else "Rate limited",
        icon = if (upstreamDown) TeslaGlyphs.Octagon else FeedbackGlyphs.Clock,
        action = retry?.let { BannerAction("Retry now", it) },
        onClose = onDismiss,
    )
}

/** Scheduled-maintenance notice — mirrors web `MaintenanceBanner`. */
@Composable
fun MaintenanceBanner(
    modifier: Modifier = Modifier,
    message: String = "Scheduled maintenance is in progress. Some features may be unavailable.",
) {
    AlertBanner(
        message = message,
        modifier = modifier,
        tone = Tone.Info,
        title = "Maintenance",
        icon = FeedbackGlyphs.Wrench,
    )
}

/** Admin "viewing as another user" banner — mirrors web `ImpersonationBanner`. */
@Composable
fun ImpersonationBanner(
    userLabel: String,
    onExit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    AlertBanner(
        message = "You are viewing TeslaSync as $userLabel.",
        modifier = modifier,
        tone = Tone.Warning,
        title = "Impersonating",
        icon = FeedbackGlyphs.Users,
        action = BannerAction("Exit", onExit),
    )
}

/** Unsupported-device/platform notice — mirrors web `BrowserCompatBanner`. */
@Composable
fun BrowserCompatBanner(
    modifier: Modifier = Modifier,
    message: String = "Your device may not support all features. Update for the best experience.",
    onDismiss: (() -> Unit)? = null,
) {
    AlertBanner(
        message = message,
        modifier = modifier,
        tone = Tone.Warning,
        title = "Compatibility",
        icon = FeedbackGlyphs.Browser,
        onClose = onDismiss,
    )
}

/**
 * New-app-version available banner — mirrors web `NewVersionBanner`. Renders only when [latest]
 * is strictly newer than [current] (see [isNewerVersion]); otherwise nothing is shown.
 */
@Composable
fun NewVersionBanner(
    current: String,
    latest: String,
    onUpdate: () -> Unit,
    modifier: Modifier = Modifier,
    onDismiss: (() -> Unit)? = null,
) {
    if (!isNewerVersion(current, latest)) return
    AlertBanner(
        message = "Version $latest is available. Update to get the latest improvements.",
        modifier = modifier,
        tone = Tone.Info,
        title = "Update available",
        icon = FeedbackGlyphs.Rocket,
        action = BannerAction("Update", onUpdate),
        onClose = onDismiss,
    )
}

/** Optimistic-concurrency conflict banner — mirrors web `EditConflictBanner`. */
@Composable
fun EditConflictBanner(
    onReload: () -> Unit,
    modifier: Modifier = Modifier,
    onOverwrite: (() -> Unit)? = null,
) {
    AlertBanner(
        message = "This record changed since you opened it. Reload to see the latest, or overwrite with your changes.",
        modifier = modifier,
        tone = Tone.Danger,
        title = "Edit conflict",
        icon = TeslaGlyphs.Warning,
        action = BannerAction("Reload", onReload),
        secondaryAction = onOverwrite?.let { BannerAction("Overwrite", it) },
    )
}

/** Historical-snapshot ("time machine") banner — mirrors web `TimeMachineBanner`. */
@Composable
fun TimeMachineBanner(
    snapshotLabel: String,
    onExit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    AlertBanner(
        message = "Viewing a historical snapshot from $snapshotLabel. Live updates are paused.",
        modifier = modifier,
        tone = Tone.Info,
        title = "Time machine",
        icon = FeedbackGlyphs.Hourglass,
        action = BannerAction("Back to live", onExit),
    )
}

/** Recovered-draft banner — mirrors web `DraftRecoveryBanner`. */
@Composable
fun DraftRecoveryBanner(
    onRestore: () -> Unit,
    onDiscard: () -> Unit,
    modifier: Modifier = Modifier,
    savedAtLabel: String? = null,
) {
    val detail = savedAtLabel?.let { "We saved a draft of your changes from $it." } ?: "We saved a draft of your changes."
    AlertBanner(
        message = "$detail Restore it, or discard and start fresh.",
        modifier = modifier,
        tone = Tone.Info,
        title = "Draft recovered",
        icon = TeslaGlyphs.Edit,
        action = BannerAction("Restore", onRestore),
        secondaryAction = BannerAction("Discard", onDiscard),
    )
}

/** Cookie/consent notice — mirrors web `CookieConsentBanner`. */
@Composable
fun CookieConsentBanner(
    onAccept: () -> Unit,
    modifier: Modifier = Modifier,
    onDecline: (() -> Unit)? = null,
    message: String = "We use essential cookies to keep you signed in and remember your preferences.",
) {
    AlertBanner(
        message = message,
        modifier = modifier,
        tone = Tone.Info,
        title = "Cookies",
        icon = FeedbackGlyphs.Cookie,
        action = BannerAction("Accept", onAccept),
        secondaryAction = onDecline?.let { BannerAction("Decline", it) },
    )
}
