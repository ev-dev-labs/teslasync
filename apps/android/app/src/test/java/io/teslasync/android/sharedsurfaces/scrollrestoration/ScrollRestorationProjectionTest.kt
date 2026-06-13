package io.teslasync.android.sharedsurfaces.scrollrestoration

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the ScrollRestoration surface's pure logic — the native mirror of every decision
 * the web component makes in its helpers and its `useLayoutEffect` body
 * (web/src/components/layout/ScrollRestoration.tsx): the `keyFor(pathname, search)` keying, the `readSaved`
 * finite/validity guard, and the POP-restore / PUSH-reset branches. It also exercises the
 * [ScrollPositionStore] save/restore round-trip — the in-memory `sessionStorage` analogue (the data adapter:
 * a cached offset projected back into a restore decision). Because the composable is a thin controller over
 * these, the per-branch assertions here double as the surface's state "snapshot". Runs in the
 * :android:testReleaseUnitTest gate.
 */
class ScrollRestorationProjectionTest {
    private val projection = ScrollRestorationProjection

    // ── keyFor (web `keyFor(pathname, search)`) ─────────────────────────────────────────────────────

    @Test
    fun keyForComposesPrefixRouteAndArguments() {
        assertEquals(
            "teslasync.scroll:dashboard?tab=energy",
            projection.keyFor("dashboard", "?tab=energy"),
        )
    }

    @Test
    fun keyForIsStableForTheSameLocationAndDistinctAcrossLocations() {
        val a1 = projection.keyFor("drives", "?id=12")
        val a2 = projection.keyFor("drives", "?id=12")
        val b = projection.keyFor("drives", "?id=34")
        assertEquals("the same location resolves to the same key", a1, a2)
        assertNotEquals("different arguments resolve to different keys", a1, b)
    }

    // ── normalizeOffset (web `readSaved` `Number.isFinite` guard) ────────────────────────────────────

    @Test
    fun normalizeOffsetAcceptsTopAndPositiveOffsets() {
        assertEquals(ScrollRestorationProjection.TOP, projection.normalizeOffset(0))
        assertEquals(640, projection.normalizeOffset(640))
    }

    @Test
    fun normalizeOffsetRejectsNegativeAndNullAsAbsent() {
        assertNull("a negative offset is corrupt and treated as absent", projection.normalizeOffset(-1))
        assertNull(projection.normalizeOffset(-9999))
        assertNull(projection.normalizeOffset(null))
    }

    // ── sanitizeForSave (web `writeSaved` storing a sane value) ──────────────────────────────────────

    @Test
    fun sanitizeForSaveClampsNegativeToTopAndLeavesNonNegativeUnchanged() {
        assertEquals(ScrollRestorationProjection.TOP, projection.sanitizeForSave(-5))
        assertEquals(0, projection.sanitizeForSave(0))
        assertEquals(512, projection.sanitizeForSave(512))
    }

    // ── restoreTarget (web `useLayoutEffect` body) ───────────────────────────────────────────────────

    @Test
    fun popRestoresTheSavedOffset() {
        assertEquals(300, projection.restoreTarget(NavigationType.Pop, 300))
    }

    @Test
    fun popWithNoSavedEntryResolvesToTheTop() {
        // The "empty" branch: a never-scrolled / first-visited destination friendly-defaults to the top.
        assertEquals(ScrollRestorationProjection.TOP, projection.restoreTarget(NavigationType.Pop, null))
    }

    @Test
    fun popWithACorruptNegativeOffsetResolvesToTheTop() {
        assertEquals(ScrollRestorationProjection.TOP, projection.restoreTarget(NavigationType.Pop, -42))
    }

    @Test
    fun pushAlwaysResetsToTheTopEvenWithASavedOffset() {
        assertEquals(ScrollRestorationProjection.TOP, projection.restoreTarget(NavigationType.Push, 900))
    }

    @Test
    fun replaceAlwaysResetsToTheTopEvenWithASavedOffset() {
        assertEquals(ScrollRestorationProjection.TOP, projection.restoreTarget(NavigationType.Replace, 900))
    }

    // ── fromRouterValue (web string-typed `useNavigationType()`) ─────────────────────────────────────

    @Test
    fun fromRouterValueMapsTheThreeReactRouterConstants() {
        assertEquals(NavigationType.Pop, projection.fromRouterValue("POP"))
        assertEquals(NavigationType.Push, projection.fromRouterValue("PUSH"))
        assertEquals(NavigationType.Replace, projection.fromRouterValue("REPLACE"))
    }

    @Test
    fun fromRouterValueIsCaseInsensitiveAndTrims() {
        assertEquals(NavigationType.Pop, projection.fromRouterValue("  pop "))
        assertEquals(NavigationType.Replace, projection.fromRouterValue("Replace"))
    }

    @Test
    fun fromRouterValueFallsBackToPushForUnknownOrAbsentValues() {
        assertEquals(NavigationType.Push, projection.fromRouterValue(null))
        assertEquals(NavigationType.Push, projection.fromRouterValue(""))
        assertEquals(NavigationType.Push, projection.fromRouterValue("forward"))
    }

    // ── ScrollPositionStore (the in-memory `sessionStorage` analogue) ────────────────────────────────

    @Test
    fun storeRoundTripsASavedOffset() {
        val store = ScrollPositionStore()
        val key = projection.keyFor("charging", "?id=7")
        store.save(key, 250)
        assertEquals(250, store.restore(key))
    }

    @Test
    fun storeReturnsNullForAnUnsavedKey() {
        val store = ScrollPositionStore()
        assertNull(store.restore(projection.keyFor("vehicles", "")))
    }

    @Test
    fun storeOverwritesAnExistingOffset() {
        val store = ScrollPositionStore()
        val key = projection.keyFor("vehicles", "")
        store.save(key, 100)
        store.save(key, 380)
        assertEquals(380, store.restore(key))
        assertEquals("an overwrite does not add a second entry", 1, store.size)
    }

    @Test
    fun storeClampsANegativeSaveToTheTopOnTheRoundTrip() {
        val store = ScrollPositionStore()
        val key = projection.keyFor("locations", "")
        store.save(key, -120)
        assertEquals(ScrollRestorationProjection.TOP, store.restore(key))
    }

    @Test
    fun storeCountsDistinctLocationsAndClearsThemAll() {
        val store = ScrollPositionStore()
        store.save(projection.keyFor("a", ""), 10)
        store.save(projection.keyFor("b", ""), 20)
        store.save(projection.keyFor("c", ""), 30)
        assertEquals(3, store.size)

        store.clear()
        assertEquals(0, store.size)
        assertNull(store.restore(projection.keyFor("a", "")))
    }

    @Test
    fun storeAndProjectionComposeIntoAPopRestoreEndToEnd() {
        // The full adapter path: a cached offset → restore decision on POP, and a top reset on PUSH.
        val store = ScrollPositionStore()
        val key = projection.keyFor("analytics", "?range=30d")
        store.save(key, 540)

        assertEquals(540, projection.restoreTarget(NavigationType.Pop, store.restore(key)))
        assertTrue(projection.restoreTarget(NavigationType.Push, store.restore(key)) == ScrollRestorationProjection.TOP)
    }
}
