package io.teslasync.android.notifications

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * A foreground in-app banner raised for a push that arrived while the app is active (P3/A6, ADR-009).
 * [deepLinkUri] is the `teslasync://app/...` target a tap on the banner opens.
 */
data class PushBanner(
    val severity: BannerSeverity,
    val title: String,
    val body: String,
    val deepLinkUri: String?,
)

/**
 * The sink the dispatcher publishes a foreground [PushBanner] to (P3/A6). The Compose shell observes
 * [banner] and renders the most recent one; a fake collects it in unit tests.
 */
interface ForegroundBannerSink {
    /** The current banner to show, or null when none. */
    val banner: StateFlow<PushBanner?>

    /** Publishes [banner] as the current foreground banner. */
    fun publish(banner: PushBanner)

    /** Clears the current banner (after it is shown / dismissed). */
    fun dismiss()
}

/** The default [ForegroundBannerSink] backed by a hot [StateFlow]. */
class DefaultForegroundBannerSink : ForegroundBannerSink {
    private val mutableBanner = MutableStateFlow<PushBanner?>(null)

    override val banner: StateFlow<PushBanner?> = mutableBanner.asStateFlow()

    override fun publish(banner: PushBanner) {
        mutableBanner.value = banner
    }

    override fun dismiss() {
        mutableBanner.value = null
    }
}
