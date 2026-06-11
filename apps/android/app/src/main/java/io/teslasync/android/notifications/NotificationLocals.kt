package io.teslasync.android.notifications

import androidx.compose.runtime.staticCompositionLocalOf

/**
 * Ambient [DeepLinkRouter] for the navigation shell to observe notification-tap deep links (P3/A6).
 * Null by default so Compose previews and the headless shell that have no push graph simply do not
 * route deep links; the real app provides it from the push container.
 */
val LocalDeepLinkRouter = staticCompositionLocalOf<DeepLinkRouter?> { null }

/**
 * Ambient [ForegroundBannerSink] for the app shell to render foreground push banners (P3/A6). Null by
 * default (see [LocalDeepLinkRouter]); the real app provides it from the push container.
 */
val LocalForegroundBannerSink = staticCompositionLocalOf<ForegroundBannerSink?> { null }
