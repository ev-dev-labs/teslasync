package io.teslasync.android.sharedsurfaces.lightbox

import io.teslasync.shared.core.data.repo.Resource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the [LightboxGalleryStore] — the cache-then-network feed the surface's single (host-supplied)
 * data source is delivered through. Covers the pre-fetch loading state, a resolved gallery, an empty
 * gallery, and the load-failure paths (a hard error with no cache, and the offline/last-known surface when a
 * prior gallery exists). Synchronous: no Android, no coroutines. Runs in the :android:testReleaseUnitTest
 * gate (the adapter unit test the prompt requires).
 */
class LightboxGalleryStoreTest {
    private class ControllableProvider(
        var gallery: LightboxGallery,
        var failLoad: Boolean = false,
    ) : LightboxGalleryProvider {
        var loadCalls: Int = 0

        override fun load(): LightboxGallery {
            loadCalls++
            if (failLoad) error("load")
            return gallery
        }
    }

    private fun gallery(count: Int = 3): LightboxGallery = LightboxGallery(List(count) { LightboxSlide(src = "img-$it", alt = "alt-$it") })

    @Test
    fun feedStartsLoadingBeforeRefresh() {
        val store = LightboxGalleryStore(InMemoryLightboxGalleryProvider(gallery()), clock = { STAMP })
        val value = store.gallery().value
        assertTrue(value is Resource.Loading)
        assertNull(value.cached)
    }

    @Test
    fun refreshResolvesToTheProvidedGallery() {
        val store = LightboxGalleryStore.of(gallery())
        store.refresh()

        val value = store.gallery().value
        assertTrue(value is Resource.Success)
        assertEquals(3, (value as Resource.Success).data.total)
        assertFalse(value.stale)
    }

    @Test
    fun refreshResolvesAnEmptyGallery() {
        val store = LightboxGalleryStore.of(LightboxGallery(emptyList()))
        store.refresh()

        val value = store.gallery().value
        assertTrue(value is Resource.Success)
        assertTrue((value as Resource.Success).data.slides.isEmpty())
    }

    @Test
    fun loadFailureWithNoCacheIsHardError() {
        val provider = ControllableProvider(gallery(), failLoad = true)
        val store = LightboxGalleryStore(provider, clock = { STAMP })
        store.refresh()

        val value = store.gallery().value
        assertTrue(value is Resource.Error)
        assertNull(value.cached)
    }

    @Test
    fun loadFailureAfterSuccessKeepsCachedAndFlagsOffline() {
        val provider = ControllableProvider(gallery())
        val store = LightboxGalleryStore(provider, clock = { STAMP })
        store.refresh()
        assertTrue(store.gallery().value is Resource.Success)

        provider.failLoad = true
        store.refresh()

        val value = store.gallery().value
        assertTrue(value is Resource.Error)
        assertEquals(3, value.cached?.total)
        assertTrue(value.stale)
    }

    @Test
    fun refreshOverACachedGalleryReReadsTheProvider() {
        val provider = ControllableProvider(gallery())
        val store = LightboxGalleryStore(provider, clock = { STAMP })
        store.refresh()
        store.refresh()
        assertEquals(2, provider.loadCalls)
    }

    private companion object {
        const val STAMP = 1_700_000_000_000L
    }
}
