package io.teslasync.android.settings

import io.teslasync.android.components.ui.ThemeMode
import io.teslasync.android.components.ui.UiDensity
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/** JVM unit tests for the framework-free settings model, token serialization, and store round-trip. */
@OptIn(ExperimentalCoroutinesApi::class)
class AppSettingsTest {
    @Test
    fun defaultsFollowSystemBrandPaletteMotionOnDiagnosticsOff() {
        val defaults = AppSettings.Default
        assertEquals(ThemeMode.System, defaults.themeMode)
        assertEquals(UiDensity.Comfortable, defaults.density)
        assertEquals(false, defaults.dynamicColor)
        assertEquals(false, defaults.reduceMotion)
        assertEquals(true, defaults.haptics)
        assertEquals(null, defaults.languageTag)
        assertEquals(false, defaults.shareDiagnostics)
    }

    @Test
    fun themeModeTokensRoundTrip() {
        ThemeMode.entries.forEach { mode ->
            assertEquals(mode, AppSettingsTokens.themeModeFromWire(AppSettingsTokens.themeModeToWire(mode)))
        }
        assertEquals(ThemeMode.System, AppSettingsTokens.themeModeFromWire("garbage"))
        assertEquals(ThemeMode.System, AppSettingsTokens.themeModeFromWire(null))
    }

    @Test
    fun densityTokensRoundTrip() {
        UiDensity.entries.forEach { density ->
            assertEquals(density, AppSettingsTokens.densityFromWire(AppSettingsTokens.densityToWire(density)))
        }
        assertEquals(UiDensity.Comfortable, AppSettingsTokens.densityFromWire("garbage"))
    }

    @Test
    fun inMemoryStoreRoundTripsEveryField() =
        runTest {
            val store = InMemoryAppSettingsStore()
            val saved =
                AppSettings(
                    themeMode = ThemeMode.Dark,
                    dynamicColor = true,
                    highContrast = true,
                    density = UiDensity.Compact,
                    reduceMotion = true,
                    haptics = false,
                    languageTag = "ar",
                    shareDiagnostics = true,
                )
            store.save(saved)
            assertEquals(saved, store.load())
        }
}
