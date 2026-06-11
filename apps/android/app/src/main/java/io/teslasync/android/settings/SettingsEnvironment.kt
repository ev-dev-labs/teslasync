package io.teslasync.android.settings

import androidx.compose.runtime.staticCompositionLocalOf

/**
 * App-level capabilities the settings screen needs that live outside the [AppSettingsController]
 * (P3/A8). Provided at the app root from the DI container so the globally-registered settings page host
 * stays parameter-free. Currently the offline-cache clear (ADR-013); the screen wraps the suspend call
 * in its own coroutine scope.
 */
class SettingsEnvironment(
    val clearOfflineCache: suspend () -> Unit,
)

/** Ambient settings environment (null in previews / before the app provides it). */
val LocalSettingsEnvironment = staticCompositionLocalOf<SettingsEnvironment?> { null }
