package io.teslasync.android.featureviews.vehiclephotogallery

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the VehiclePhotoGallery's pure logic — the native analogue of the web component's
 * per-photo derivations (web/src/features/vehicles/components/VehiclePhotoGallery.tsx): the photo →
 * (key, src, position, total, alt, caption) projection with its preserved order, the 1-based position + total
 * the "Open photo {{index}} of {{total}}" label interpolates, the stable list key (web `${photo.src}-${i}`),
 * the empty guard (web `photos.length === 0`), and the PII-safe `view.opened` diagnostic. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class VehiclePhotoGalleryProjectionTest {
    private fun photo(
        src: String,
        alt: String = "alt-$src",
        caption: String? = null,
    ): VehiclePhoto = VehiclePhoto(src = src, alt = alt, caption = caption)

    // ── Projection ──────────────────────────────────────────────────────────────

    @Test
    fun projectMapsPhotosPreservingOrderWithOneBasedPositionsAndTotal() {
        val result =
            VehiclePhotoGalleryProjection.project(
                listOf(photo("a"), photo("b"), photo("c")),
            )

        assertFalse(result.isEmpty)
        assertEquals(listOf("a", "b", "c"), result.slides.map { it.src })
        assertEquals(listOf(1, 2, 3), result.slides.map { it.position })
        assertEquals(listOf(3, 3, 3), result.slides.map { it.total })
    }

    @Test
    fun projectReturnsEmptyResultForNoPhotos() {
        val result = VehiclePhotoGalleryProjection.project(emptyList())

        assertTrue(result.isEmpty)
        assertTrue(result.slides.isEmpty())
    }

    @Test
    fun projectKeysEachSlideBySrcAndIndex() {
        val result =
            VehiclePhotoGalleryProjection.project(
                listOf(photo("front.jpg"), photo("front.jpg"), photo("rear.jpg")),
            )

        // Web `key={`${photo.src}-${i}`}` — duplicate srcs stay distinct via the index suffix.
        assertEquals(
            listOf("front.jpg-0", "front.jpg-1", "rear.jpg-2"),
            result.slides.map { it.key },
        )
    }

    @Test
    fun projectPreservesAltAndCaption() {
        val result =
            VehiclePhotoGalleryProjection.project(
                listOf(
                    photo("a", alt = "Front three-quarter", caption = "Front"),
                    photo("b", alt = "Driver side", caption = null),
                ),
            )

        assertEquals("Front three-quarter", result.slides[0].alt)
        assertEquals("Front", result.slides[0].caption)
        assertEquals("Driver side", result.slides[1].alt)
        assertNull(result.slides[1].caption)
    }

    // ── Diagnostics (P1/S11 view.opened contract) ───────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordVehiclePhotoGalleryOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "VehiclePhotoGallery"), fields)
    }

    @Test
    fun registrationExposesStableIdAndSlug() {
        assertEquals("vehicle-photo-gallery", VehiclePhotoGalleryRegistration.ID)
        assertEquals("VehiclePhotoGallery", VehiclePhotoGalleryRegistration.SLUG)
    }

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }
}
