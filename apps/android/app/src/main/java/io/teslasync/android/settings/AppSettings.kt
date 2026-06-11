package io.teslasync.android.settings

import io.teslasync.android.components.ui.ThemeMode
import io.teslasync.android.components.ui.UiDensity

/**
 * Device-local app preferences (P3/A8) — the Android-native counterpart of the web client-side
 * settings. These live on the device (not the server `/settings` document): appearance (theme mode,
 * Material You dynamic color, high contrast, information density), accessibility (reduced motion,
 * haptics), the per-app [languageTag] (BCP-47, null = follow the system), and the diagnostics-sharing
 * opt-in ([shareDiagnostics], ADR-016, default OFF). Pure data so the persistence round-trip and the
 * settings controller are fully unit-tested.
 */
data class AppSettings(
    val themeMode: ThemeMode = ThemeMode.System,
    val dynamicColor: Boolean = false,
    val highContrast: Boolean = false,
    val density: UiDensity = UiDensity.Comfortable,
    val reduceMotion: Boolean = false,
    val haptics: Boolean = true,
    val languageTag: String? = null,
    val shareDiagnostics: Boolean = false,
) {
    companion object {
        /** The defaults: follow the system, brand palette, comfortable density, motion + haptics on, diagnostics off. */
        val Default = AppSettings()
    }
}

/**
 * Stable, locale-independent wire tokens for the enum preferences so the persisted form never depends
 * on enum ordinal/name churn (P3/A8). Pure and total — unit-tested both directions.
 */
object AppSettingsTokens {
    fun themeModeToWire(mode: ThemeMode): String =
        when (mode) {
            ThemeMode.System -> "system"
            ThemeMode.Light -> "light"
            ThemeMode.Dark -> "dark"
        }

    fun themeModeFromWire(wire: String?): ThemeMode =
        when (wire?.trim()?.lowercase()) {
            "light" -> ThemeMode.Light
            "dark" -> ThemeMode.Dark
            else -> ThemeMode.System
        }

    fun densityToWire(density: UiDensity): String =
        when (density) {
            UiDensity.Compact -> "compact"
            UiDensity.Comfortable -> "comfortable"
            UiDensity.Spacious -> "spacious"
        }

    fun densityFromWire(wire: String?): UiDensity =
        when (wire?.trim()?.lowercase()) {
            "compact" -> UiDensity.Compact
            "spacious" -> UiDensity.Spacious
            else -> UiDensity.Comfortable
        }
}
