// Off-device accessibility verification of the Lightbox surface — the localized control labels every
// interactive affordance (close, prev/next, zoom out/in/reset) carries for TalkBack (web `aria-label`s), plus
// the templated counter / zoom-level readouts (web `lightbox.counter` / `lightbox.zoomPercent`). The pure
// label model is covered here so presence is asserted without a Compose host; the on-device UI test
// additionally asserts the labels are attached to the live nodes. Runs in the :android:testReleaseUnitTest
// gate (the a11y label test the prompt requires).
package io.teslasync.android.sharedsurfaces.lightbox

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LightboxA11yTest {
    private fun strings(): LightboxStrings =
        LightboxStrings(
            close = "Close image viewer",
            previous = "Previous image",
            next = "Next image",
            zoomOut = "Zoom out",
            zoomIn = "Zoom in",
            zoomReset = "Reset zoom",
            loading = "Loading",
            empty = "No data available",
            error = "Failed to load data",
            stale = "Stale",
            offline = "Offline",
            retry = "Retry",
            counter = { current, total -> "$current / $total" },
            zoomPercent = { value -> "$value%" },
        )

    @Test
    fun everyInteractiveControlHasANonBlankLabel() {
        assertTrue(strings().hasAccessibilityLabels)
    }

    @Test
    fun aBlankControlLabelIsRejected() {
        assertFalse(strings().copy(close = "").hasAccessibilityLabels)
        assertFalse(strings().copy(previous = " ").hasAccessibilityLabels)
        assertFalse(strings().copy(zoomReset = "").hasAccessibilityLabels)
    }

    @Test
    fun counterFormatsTheCurrentAndTotal() {
        assertEquals("1 / 3", strings().counter(1, 3))
        assertEquals("3 / 3", strings().counter(3, 3))
    }

    @Test
    fun zoomLevelFormatsAPercentage() {
        assertEquals("100%", strings().zoomPercent(100))
        assertEquals("250%", strings().zoomPercent(250))
    }
}
