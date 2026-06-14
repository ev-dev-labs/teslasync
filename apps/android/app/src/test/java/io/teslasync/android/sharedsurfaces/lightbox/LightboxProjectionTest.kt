package io.teslasync.android.sharedsurfaces.lightbox

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Exercises the pure [LightboxProjection] + [LightboxViewerState] interaction maths — the parity-critical
 * navigation / zoom / pan / decode transitions the web component owns (web/src/components/ui/Lightbox.tsx),
 * plus the empty / freshness / query-error folds the shell adds. No Compose, no Android: runs in the
 * :android:testReleaseUnitTest gate.
 */
class LightboxProjectionTest {
    private val delta = 0.0001f

    private fun gallery(count: Int = 3): LightboxGallery =
        LightboxGallery(List(count) { LightboxSlide(src = "img-$it", alt = "alt-$it", caption = "cap-$it") })

    // ── initial / clamp (web safeInitialIndex) ───────────────────────────────────────────────────────────

    @Test
    fun initialViewerStateClampsInitialIndexIntoRange() {
        assertEquals(2, LightboxProjection.initialViewerState(LightboxGallery(gallery().slides, initialIndex = 9)).index)
        assertEquals(0, LightboxProjection.initialViewerState(LightboxGallery(gallery().slides, initialIndex = -3)).index)
    }

    @Test
    fun initialViewerStateStartsUnzoomedUnpannedUndecoded() {
        val state = LightboxProjection.initialViewerState(gallery())
        assertEquals(LightboxRegistration.MIN_ZOOM, state.zoom, delta)
        assertEquals(0f, state.panX, delta)
        assertEquals(0f, state.panY, delta)
        assertFalse(state.decoded)
    }

    @Test
    fun emptyGalleryClampsToIndexZeroAndIsEmpty() {
        val empty = LightboxGallery(emptyList())
        assertEquals(0, empty.safeInitialIndex)
        assertTrue(LightboxProjection.isEmpty(empty))
        assertFalse(LightboxProjection.isEmpty(gallery()))
    }

    // ── navigation (web goPrev/goNext/goFirst/goLast) ────────────────────────────────────────────────────

    @Test
    fun navigationClampsToGalleryBounds() {
        val start = LightboxProjection.initialViewerState(gallery())
        assertEquals(0, LightboxProjection.goPrev(start, 3).index)
        assertEquals(1, LightboxProjection.goNext(start, 3).index)
        assertEquals(2, LightboxProjection.goLast(start, 3).index)
        val last = LightboxProjection.goLast(start, 3)
        assertEquals(2, LightboxProjection.goNext(last, 3).index)
        assertEquals(0, LightboxProjection.goFirst(last, 3).index)
    }

    @Test
    fun navigatingToANewImageResetsZoomPanAndDecoded() {
        val zoomedPanned = LightboxViewerState(index = 0, zoom = 3f, panX = 40f, panY = -20f, decoded = true)
        val next = LightboxProjection.goNext(zoomedPanned, 3)
        assertEquals(1, next.index)
        assertEquals(LightboxRegistration.MIN_ZOOM, next.zoom, delta)
        assertEquals(0f, next.panX, delta)
        assertEquals(0f, next.panY, delta)
        assertFalse(next.decoded)
    }

    @Test
    fun navigatingToTheSameIndexIsANoOpThatPreservesState() {
        val zoomed = LightboxViewerState(index = 1, zoom = 2f, panX = 10f, decoded = true)
        assertSame(zoomed, LightboxProjection.goTo(zoomed, 1, 3))
    }

    @Test
    fun atFirstAndAtLastTrackTheBounds() {
        assertTrue(LightboxProjection.atFirst(LightboxViewerState(index = 0)))
        assertFalse(LightboxProjection.atFirst(LightboxViewerState(index = 1)))
        assertTrue(LightboxProjection.atLast(LightboxViewerState(index = 2), total = 3))
        assertFalse(LightboxProjection.atLast(LightboxViewerState(index = 1), total = 3))
    }

    @Test
    fun currentSlideClampsAnOutOfRangeIndex() {
        val g = gallery()
        assertEquals("img-2", LightboxProjection.currentSlide(g, LightboxViewerState(index = 9))?.src)
        assertNull(LightboxProjection.currentSlide(LightboxGallery(emptyList()), LightboxViewerState(index = 0)))
    }

    // ── zoom (web zoomIn/zoomOut/zoomReset, 1×–5× / 0.5× step) ────────────────────────────────────────────

    @Test
    fun zoomInStepsByHalfAndCapsAtMax() {
        var state = LightboxViewerState(index = 0)
        repeat(20) { state = LightboxProjection.zoomIn(state) }
        assertEquals(LightboxRegistration.MAX_ZOOM, state.zoom, delta)
        assertFalse(state.canZoomIn)
        assertEquals(500, state.zoomPercent)
    }

    @Test
    fun zoomInOneStepIsOnePointFive() {
        val state = LightboxProjection.zoomIn(LightboxViewerState(index = 0))
        assertEquals(1.5f, state.zoom, delta)
        assertEquals(150, state.zoomPercent)
        assertTrue(state.isZoomed)
        assertTrue(state.canZoomOut)
    }

    @Test
    fun zoomOutFloorsAtOneAndClearsPanWhenItReachesOne() {
        val panned = LightboxViewerState(index = 0, zoom = 1.5f, panX = 30f, panY = 12f)
        val out = LightboxProjection.zoomOut(panned)
        assertEquals(LightboxRegistration.MIN_ZOOM, out.zoom, delta)
        assertEquals(0f, out.panX, delta)
        assertEquals(0f, out.panY, delta)
        assertFalse(out.isZoomed)
        assertFalse(out.canZoomOut)
    }

    @Test
    fun zoomOutAboveOneKeepsThePan() {
        val panned = LightboxViewerState(index = 0, zoom = 3f, panX = 30f, panY = 12f)
        val out = LightboxProjection.zoomOut(panned)
        assertEquals(2.5f, out.zoom, delta)
        assertEquals(30f, out.panX, delta)
        assertEquals(12f, out.panY, delta)
    }

    @Test
    fun zoomResetReturnsToOneAndClearsPan() {
        val state = LightboxViewerState(index = 0, zoom = 4f, panX = 50f, panY = 50f)
        val reset = LightboxProjection.zoomReset(state)
        assertEquals(LightboxRegistration.MIN_ZOOM, reset.zoom, delta)
        assertEquals(0f, reset.panX, delta)
        assertEquals(0f, reset.panY, delta)
    }

    @Test
    fun resetEnabledWhenZoomedOrPanned() {
        assertFalse(LightboxViewerState(index = 0).resetEnabled)
        assertTrue(LightboxViewerState(index = 0, zoom = 1.5f).resetEnabled)
        assertTrue(LightboxViewerState(index = 0, panX = 5f).resetEnabled)
    }

    // ── pan (web handlePointerMove; only while zoomed) ───────────────────────────────────────────────────

    @Test
    fun panAccumulatesOnlyWhileZoomed() {
        val unzoomed = LightboxViewerState(index = 0)
        assertSame(unzoomed, LightboxProjection.pan(unzoomed, 10f, 10f))

        val zoomed = LightboxViewerState(index = 0, zoom = 2f, panX = 5f, panY = 5f)
        val panned = LightboxProjection.pan(LightboxProjection.pan(zoomed, 10f, 20f), -3f, -4f)
        assertEquals(12f, panned.panX, delta)
        assertEquals(21f, panned.panY, delta)
    }

    // ── decode (web onLoad/onError → setDecoded) ─────────────────────────────────────────────────────────

    @Test
    fun markDecodedIsIdempotent() {
        val decoded = LightboxProjection.markDecoded(LightboxViewerState(index = 0))
        assertTrue(decoded.decoded)
        assertSame(decoded, LightboxProjection.markDecoded(decoded))
    }

    // ── freshness fold ───────────────────────────────────────────────────────────────────────────────────

    @Test
    fun freshnessFoldsLiveStaleAndOffline() {
        val g = gallery()
        assertEquals(LightboxFreshness.Live, LightboxProjection.freshness(UiState(UiPhase.Content, data = g)))
        assertEquals(LightboxFreshness.Stale, LightboxProjection.freshness(UiState(UiPhase.Content, data = g, stale = true)))
        assertEquals(
            LightboxFreshness.Offline,
            LightboxProjection.freshness(UiState(UiPhase.Content, data = g, stale = true, errorKind = ErrorKind.Network)),
        )
    }

    // ── query-error bucket ───────────────────────────────────────────────────────────────────────────────

    @Test
    fun queryErrorKindMapsTheTaxonomy() {
        assertEquals(QueryErrorKind.Waiting, kindFor(ErrorKind.CircuitOpen))
        assertEquals(QueryErrorKind.Network, kindFor(ErrorKind.Network))
        assertEquals(QueryErrorKind.Network, kindFor(ErrorKind.Timeout))
        assertEquals(QueryErrorKind.Unauthorized, kindFor(ErrorKind.Http, status = 401))
        assertEquals(QueryErrorKind.Unauthorized, kindFor(ErrorKind.Http, status = 403))
        assertEquals(QueryErrorKind.NotFound, kindFor(ErrorKind.Http, status = 404))
        assertEquals(QueryErrorKind.ServerError, kindFor(ErrorKind.Http, status = 500))
        assertEquals(QueryErrorKind.ServerError, kindFor(ErrorKind.Unknown))
    }

    private fun kindFor(
        kind: ErrorKind,
        status: Int? = null,
    ): QueryErrorKind = LightboxProjection.queryErrorKind(UiState<LightboxGallery>(UiPhase.Error, errorKind = kind, httpStatus = status))
}
