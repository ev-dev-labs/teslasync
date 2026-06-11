package io.teslasync.android.settings

import io.teslasync.android.components.ui.ThemeMode
import io.teslasync.android.components.ui.UiDensity
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** JVM unit tests for the [AppSettingsController] — load, mutation persistence, and the consent seam. */
@OptIn(ExperimentalCoroutinesApi::class)
class AppSettingsControllerTest {
    @Test
    fun startLoadsPersistedSettingsAndAppliesInitialConsent() =
        runTest {
            val store = InMemoryAppSettingsStore(AppSettings.Default.copy(themeMode = ThemeMode.Dark, shareDiagnostics = true))
            var consent: Boolean? = null
            val controller = AppSettingsController(store, this@runTest, onDiagnosticsConsentChanged = { consent = it })

            controller.start()
            advanceUntilIdle()

            assertEquals(ThemeMode.Dark, controller.settings.themeMode)
            assertEquals(true, consent)
        }

    @Test
    fun mutationsUpdateStateAndPersist() =
        runTest {
            val store = InMemoryAppSettingsStore()
            val controller = AppSettingsController(store, this@runTest)
            controller.start()
            advanceUntilIdle()

            controller.setThemeMode(ThemeMode.Light)
            controller.setDensity(UiDensity.Compact)
            controller.setReduceMotion(true)
            controller.setHaptics(false)
            advanceUntilIdle()

            assertEquals(ThemeMode.Light, controller.settings.themeMode)
            assertEquals(UiDensity.Compact, controller.settings.density)
            assertTrue(controller.settings.reduceMotion)
            assertFalse(controller.settings.haptics)
            assertEquals(controller.settings, store.load())
        }

    @Test
    fun diagnosticsToggleForwardsConsentBothWays() =
        runTest {
            val store = InMemoryAppSettingsStore()
            val consents = mutableListOf<Boolean>()
            val controller = AppSettingsController(store, this@runTest, onDiagnosticsConsentChanged = { consents += it })
            controller.start()
            advanceUntilIdle()

            controller.setShareDiagnostics(true)
            controller.setShareDiagnostics(false)
            advanceUntilIdle()

            // start() applies the initial (false), then the opt-in (true), then the opt-out (false).
            assertEquals(listOf(false, true, false), consents)
            assertFalse(controller.settings.shareDiagnostics)
        }

    @Test
    fun languageIsNormalizedToASupportedTagOrSystem() =
        runTest {
            val controller = AppSettingsController(InMemoryAppSettingsStore(), this@runTest)
            controller.start()
            advanceUntilIdle()

            controller.setLanguage("ar-EG")
            assertEquals("ar", controller.settings.languageTag)
            controller.setLanguage("fr")
            assertEquals(null, controller.settings.languageTag)
        }
}
