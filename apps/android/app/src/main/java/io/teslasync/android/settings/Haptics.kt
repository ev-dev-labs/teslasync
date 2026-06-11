package io.teslasync.android.settings

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback

/**
 * Whether in-app haptic feedback is enabled (P3/A8). Provided at the app root from
 * [AppSettings.haptics]; defaults on so previews and un-provided trees still feel responsive. The
 * settings controls and any future tactile interaction gate their feedback on this.
 */
val LocalHapticsEnabled = staticCompositionLocalOf { true }

/**
 * Performs a [type] haptic only when the user has haptics enabled ([LocalHapticsEnabled]) — the single
 * seam interactive controls call so the preference is honored in one place (P3/A8). Returns a callback
 * so callers wire it straight into `onCheckedChange`/`onClick`.
 */
@Composable
fun rememberAppHaptic(): (HapticFeedbackType) -> Unit {
    val enabled = LocalHapticsEnabled.current
    val haptics = LocalHapticFeedback.current
    return { type -> if (enabled) haptics.performHapticFeedback(type) }
}
