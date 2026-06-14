package io.teslasync.android.sharedsurfaces.statusbar

import io.teslasync.shared.core.data.repo.Resource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the [StatusBarPrefsStore] — the native port of the web container's `localStorage`-backed
 * external store (`cachedPrefs` + `setStatusBarPrefs`). Covers the pre-hydrate loading state, the
 * defaults fallback (web `DEFAULTS`), a stored value, the write-through + broadcast on a preference change,
 * and the read-failure paths (a hard error with no cache, and the offline/last-known surface when a prior
 * value exists). Synchronous: no Android, no coroutines.
 */
class StatusBarPrefsStoreTest {
    private class ControllablePersistence(
        var stored: StatusBarPreferences? = null,
        var failRead: Boolean = false,
    ) : StatusBarPrefsPersistence {
        override fun read(): StatusBarPreferences? {
            if (failRead) error("read")
            return stored
        }

        override fun write(prefs: StatusBarPreferences) {
            stored = prefs
        }
    }

    @Test
    fun feedStartsLoadingBeforeHydrate() {
        val store = StatusBarPrefsStore(InMemoryStatusBarPrefsPersistence(), clock = { STAMP })
        val value = store.preferences().value
        assertTrue(value is Resource.Loading)
        assertNull(value.cached)
    }

    @Test
    fun hydrateWithNoStoredValueResolvesToDefaults() {
        val store = StatusBarPrefsStore(InMemoryStatusBarPrefsPersistence(), clock = { STAMP })
        store.hydrate()

        val value = store.preferences().value
        assertTrue(value is Resource.Success)
        assertEquals(StatusBarRegistration.DEFAULTS, (value as Resource.Success).data)
        assertFalse(value.stale)
    }

    @Test
    fun hydrateWithStoredValueResolvesToIt() {
        val stored = StatusBarPreferences(enabled = false, iconOnly = true)
        val store = StatusBarPrefsStore(InMemoryStatusBarPrefsPersistence(stored), clock = { STAMP })
        store.hydrate()

        val value = store.preferences().value
        assertTrue(value is Resource.Success)
        assertEquals(stored, (value as Resource.Success).data)
    }

    @Test
    fun setEnabledPersistsAndBroadcasts() {
        val persistence = ControllablePersistence(stored = StatusBarRegistration.DEFAULTS)
        val store = StatusBarPrefsStore(persistence, clock = { STAMP })
        store.hydrate()

        store.setEnabled(false)

        assertEquals(false, persistence.stored?.enabled)
        val value = store.preferences().value
        assertTrue(value is Resource.Success)
        assertEquals(false, (value as Resource.Success).data.enabled)
    }

    @Test
    fun setIconOnlyPersistsAndBroadcasts() {
        val persistence = ControllablePersistence(stored = StatusBarRegistration.DEFAULTS)
        val store = StatusBarPrefsStore(persistence, clock = { STAMP })
        store.hydrate()

        store.setIconOnly(true)

        assertEquals(true, persistence.stored?.iconOnly)
        assertEquals(true, (store.preferences().value as Resource.Success).data.iconOnly)
    }

    @Test
    fun readFailureWithNoCacheIsHardError() {
        val store = StatusBarPrefsStore(ControllablePersistence(failRead = true), clock = { STAMP })
        store.hydrate()

        val value = store.preferences().value
        assertTrue(value is Resource.Error)
        assertNull(value.cached)
    }

    @Test
    fun readFailureAfterSuccessKeepsCachedAndFlagsOffline() {
        val persistence = ControllablePersistence(stored = StatusBarRegistration.DEFAULTS)
        val store = StatusBarPrefsStore(persistence, clock = { STAMP })
        store.hydrate()
        assertTrue(store.preferences().value is Resource.Success)

        persistence.failRead = true
        store.hydrate()

        val value = store.preferences().value
        assertTrue(value is Resource.Error)
        assertEquals(StatusBarRegistration.DEFAULTS, value.cached)
        assertTrue(value.stale)
    }

    private companion object {
        const val STAMP = 1_700_000_000_000L
    }
}
