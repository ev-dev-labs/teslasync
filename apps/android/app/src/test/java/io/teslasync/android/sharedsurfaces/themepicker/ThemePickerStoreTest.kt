// Off-device unit tests for the ThemePreferenceStore — the cache-then-network selection feed the surface
// binds to (the web `ThemeProvider`'s persistence + `/settings` mirror). Drives the store synchronously over
// in-memory persistence: the pre-hydrate loading state, the defaults/stored hydrate paths, the read-failure
// degradations (hard error vs offline/last-known), and the persist-and-broadcast writes (including the
// custom-colour theme pin and best-effort write failures). Framework-free; runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.themepicker

import io.teslasync.shared.core.data.repo.Resource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ThemePickerStoreTest {
    /** Persistence whose read can be toggled to fail after a successful hydrate (offline simulation). */
    private class TogglePersistence(
        var value: ThemeSelection?,
        var failRead: Boolean = false,
    ) : ThemePreferencePersistence {
        override fun read(): ThemeSelection? {
            if (failRead) error("read failed")
            return value
        }

        override fun write(selection: ThemeSelection) {
            value = selection
        }
    }

    private fun store(persistence: ThemePreferencePersistence): ThemePreferenceStore = ThemePreferenceStore(persistence, clock = { STAMP })

    @Test
    fun startsLoadingBeforeHydrate() {
        val resource = store(InMemoryThemePreferencePersistence()).selection().value
        assertTrue(resource is Resource.Loading)
        assertNull(resource.cached)
    }

    @Test
    fun hydrateWithNoStoredValueResolvesToDefaults() {
        val store = store(InMemoryThemePreferencePersistence())
        store.hydrate()
        val resource = store.selection().value
        assertTrue(resource is Resource.Success)
        assertEquals(ThemePickerRegistration.DEFAULTS, (resource as Resource.Success).data)
    }

    @Test
    fun hydrateWithStoredValueResolvesToIt() {
        val stored = ThemeSelection("tesla-red", "light", 0xFF112233, 0xFF445566)
        val store = store(InMemoryThemePreferencePersistence(stored))
        store.hydrate()
        assertEquals(stored, (store.selection().value as Resource.Success).data)
    }

    @Test
    fun hydrateReadFailureWithNoCacheIsHardError() {
        val store = store(InMemoryThemePreferencePersistence(failRead = true))
        store.hydrate()
        val resource = store.selection().value
        assertTrue(resource is Resource.Error)
        assertNull(resource.cached)
    }

    @Test
    fun hydrateReadFailureWithCacheKeepsLastKnownAndFlagsStale() {
        val persistence = TogglePersistence(ThemeSelection("matrix-green", "oled", 0xFF0, 0xFF1))
        val store = store(persistence)
        store.hydrate()
        assertTrue(store.selection().value is Resource.Success)

        persistence.failRead = true
        store.hydrate()
        val resource = store.selection().value
        assertTrue(resource is Resource.Error)
        assertEquals("matrix-green", resource.cached?.themeId)
        assertTrue(resource.stale)
    }

    @Test
    fun setThemePersistsAndBroadcasts() {
        val persistence = InMemoryThemePreferencePersistence(ThemePickerRegistration.DEFAULTS)
        val store = store(persistence)
        store.hydrate()

        store.setTheme("royal-purple")

        val resource = store.selection().value
        assertEquals("royal-purple", (resource as Resource.Success).data.themeId)
        assertEquals("royal-purple", persistence.read()?.themeId)
    }

    @Test
    fun setModePersistsAndBroadcasts() {
        val store = store(InMemoryThemePreferencePersistence(ThemePickerRegistration.DEFAULTS))
        store.hydrate()

        store.setMode("nord")

        assertEquals("nord", (store.selection().value as Resource.Success).data.modeId)
    }

    @Test
    fun setCustomColorsPinsTheCustomThemeAndStoresColours() {
        val store = store(InMemoryThemePreferencePersistence(ThemePickerRegistration.DEFAULTS))
        store.hydrate()

        store.setCustomColors(primary = 0xFFAABBCC, accent = 0xFF334455)

        val selection = (store.selection().value as Resource.Success).data
        assertEquals(ThemePickerRegistration.CUSTOM_THEME_ID, selection.themeId)
        assertEquals(0xFFAABBCC, selection.customPrimary)
        assertEquals(0xFF334455, selection.customAccent)
    }

    @Test
    fun writeFailureStillAppliesTheChangeInSession() {
        val persistence = InMemoryThemePreferencePersistence(ThemePickerRegistration.DEFAULTS, failWrite = true)
        val store = store(persistence)
        store.hydrate()

        store.setMode("midnight")

        assertEquals("midnight", (store.selection().value as Resource.Success).data.modeId)
    }

    private companion object {
        const val STAMP = 1_700_000_000_000L
    }
}
