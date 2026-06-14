package io.teslasync.android.sharedsurfaces.themeprovider

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Off-device verification of the local-selection store + its persistence boundary — the native analogue of
 * the web provider's synchronous `localStorage` cache. Covers the defaults applied before any persisted
 * value, hydrating from a stored selection at construction (web reads `localStorage` on init), a write
 * persisting + broadcasting the new value, and the best-effort write contract (a persistence failure still
 * applies in-session, exactly as the web setter swallows `localStorage` errors). No Android, no coroutines.
 */
class ThemeSelectionStoreTest {
    @Test
    fun defaultsWhenNothingHasBeenPersisted() {
        val store = ThemeSelectionStore(InMemoryThemeSelectionPersistence())
        assertEquals(ThemeProviderRegistration.DEFAULTS, store.selection.value)
    }

    @Test
    fun hydratesFromThePersistedSelectionAtConstruction() {
        val saved = ThemeSelection(ThemeId.RoyalPurple, ModeId.Nord, "#111111", "#222222")
        val store = ThemeSelectionStore(InMemoryThemeSelectionPersistence(saved))
        assertEquals(saved, store.selection.value)
    }

    @Test
    fun persistWritesThroughAndBroadcastsTheNewValue() {
        val persistence = InMemoryThemeSelectionPersistence()
        val store = ThemeSelectionStore(persistence)
        val next = ThemeSelection(ThemeId.SolarAmber, ModeId.Sunset, "#abcabc", "#defdef")

        store.persist(next)

        assertEquals(next, store.selection.value)
        assertEquals(next, persistence.read())
    }

    @Test
    fun persistAppliesInSessionEvenWhenTheWriteFails() {
        val store = ThemeSelectionStore(ThrowingPersistence)
        val next = ThemeSelection(ThemeId.MatrixGreen, ModeId.Oled, "#0f0f0f", "#1f1f1f")

        store.persist(next)

        assertEquals(next, store.selection.value)
    }

    private object ThrowingPersistence : ThemeSelectionPersistence {
        override fun read(): ThemeSelection? = null

        override fun write(selection: ThemeSelection): Unit = error("disk full")
    }
}
