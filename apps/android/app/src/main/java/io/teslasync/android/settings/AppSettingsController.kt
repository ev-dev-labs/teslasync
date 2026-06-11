package io.teslasync.android.settings

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import io.teslasync.android.components.ui.ThemeMode
import io.teslasync.android.components.ui.UiDensity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * Observable holder for the device-local [AppSettings] (P3/A8) — the Android-native analogue of the
 * web settings store. Built once in the app DI graph ([io.teslasync.android.auth.AuthContainer]) and
 * reached from Compose via [LocalAppSettings]. It loads the persisted settings on [start], exposes them
 * as Compose snapshot state (so the app root re-derives theme/density/motion/haptics on change), and
 * persists every mutation. The two cross-cutting side effects are applied here: the diagnostics-sharing
 * consent (ADR-016) is forwarded to the shared `Diagnostics` via [onDiagnosticsConsentChanged]; the
 * per-app language is applied at the UI boundary by [PerAppLanguage] (it needs an Activity to recreate).
 */
@Stable
class AppSettingsController(
    private val store: AppSettingsStore,
    private val scope: CoroutineScope,
    private val onDiagnosticsConsentChanged: (Boolean) -> Unit = {},
) {
    /** The current device-local settings; mutating any property recomposes the app root. */
    var settings: AppSettings by mutableStateOf(AppSettings.Default)
        private set

    private var loaded = false

    /** Loads the persisted settings and applies the initial diagnostics consent. Idempotent. */
    fun start() {
        if (loaded) return
        loaded = true
        scope.launch {
            val persisted = store.load()
            settings = persisted
            onDiagnosticsConsentChanged(persisted.shareDiagnostics)
        }
    }

    fun setThemeMode(mode: ThemeMode) = update { it.copy(themeMode = mode) }

    fun setDynamicColor(enabled: Boolean) = update { it.copy(dynamicColor = enabled) }

    fun setHighContrast(enabled: Boolean) = update { it.copy(highContrast = enabled) }

    fun setDensity(density: UiDensity) = update { it.copy(density = density) }

    fun setReduceMotion(enabled: Boolean) = update { it.copy(reduceMotion = enabled) }

    fun setHaptics(enabled: Boolean) = update { it.copy(haptics = enabled) }

    /** Records the selected per-app language (normalized to a supported tag, or null = follow system). */
    fun setLanguage(tag: String?) = update { it.copy(languageTag = AppLanguage.normalize(tag)) }

    /** Records (and applies, via the consent seam) the diagnostics-sharing opt-in (ADR-016). */
    fun setShareDiagnostics(enabled: Boolean) = update(applyConsent = true) { it.copy(shareDiagnostics = enabled) }

    private fun update(
        applyConsent: Boolean = false,
        transform: (AppSettings) -> AppSettings,
    ) {
        val next = transform(settings)
        if (next == settings) return
        settings = next
        if (applyConsent) onDiagnosticsConsentChanged(next.shareDiagnostics)
        scope.launch { store.save(next) }
    }
}

/** Ambient settings controller so any descendant (the settings screen, the app root) can read/update. */
val LocalAppSettings = staticCompositionLocalOf<AppSettingsController?> { null }
