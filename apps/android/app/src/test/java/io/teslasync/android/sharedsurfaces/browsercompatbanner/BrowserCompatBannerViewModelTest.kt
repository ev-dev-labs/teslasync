package io.teslasync.android.sharedsurfaces.browsercompatbanner

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests [BrowserCompatBannerViewModel] against the detection + sticky-dismissal seam — covering the contract the
 * view depends on, the native mirror of the web component's local-state behaviour
 * (web/src/components/feedback/BrowserCompatBanner.tsx + its __tests__): the surface resolves to Active only when
 * a capability is missing AND the warning was not dismissed; a persisted dismissal keeps it hidden across a
 * re-open (the web "stays hidden across remounts"); [BrowserCompatBannerViewModel.dismiss] persists the choice
 * and collapses the surface; and the one-shot `view.opened` fires exactly once with the surface slug (never a
 * capability list). Runs in :android:testReleaseUnitTest.
 */
class BrowserCompatBannerViewModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    @Test
    fun surfaceIsActiveWhenACapabilityIsMissingAndNotDismissed() {
        val source = browserCompatSource(listOf(RequiredCapability.WebView, RequiredCapability.CustomTabs))
        val model = BrowserCompatBannerViewModel(source, RecordingLogger())

        val surface = model.surface.value
        assertTrue(surface is BrowserCompatSurface.Active)
        surface as BrowserCompatSurface.Active
        assertEquals("Android System WebView, Chrome Custom Tabs", surface.features)
    }

    @Test
    fun surfaceIsHiddenWhenNoCapabilityIsMissing() {
        // Web "renders nothing when no features are missing".
        val model = BrowserCompatBannerViewModel(browserCompatSource(emptyList()), RecordingLogger())
        assertEquals(BrowserCompatSurface.Hidden, model.surface.value)
    }

    @Test
    fun surfaceIsHiddenWhenAlreadyDismissed() {
        // Web "stays hidden across remounts after dismissal (simulated reload)".
        val source = browserCompatSource(listOf(RequiredCapability.WebView), dismissed = true)
        val model = BrowserCompatBannerViewModel(source, RecordingLogger())
        assertEquals(BrowserCompatSurface.Hidden, model.surface.value)
    }

    @Test
    fun dismissPersistsTheChoiceAndHidesTheBanner() {
        // Web "surfaces a dismiss control that hides the banner and persists the choice".
        val source = browserCompatSource(listOf(RequiredCapability.WebView))
        val model = BrowserCompatBannerViewModel(source, RecordingLogger())
        assertTrue(model.surface.value is BrowserCompatSurface.Active)

        model.dismiss()

        assertEquals(BrowserCompatSurface.Hidden, model.surface.value)
        assertTrue("the dismissal is persisted to the store", source.isDismissed())

        // A fresh holder over the same (now-dismissed) store stays hidden even with the same missing set.
        val remounted = BrowserCompatBannerViewModel(source, RecordingLogger())
        assertEquals(BrowserCompatSurface.Hidden, remounted.surface.value)
    }

    @Test
    fun bannerReappearsWhenTheDismissalWasNeverPersisted() {
        // Web "reappears once localStorage is cleared (user resets the browser)".
        val source = browserCompatSource(listOf(RequiredCapability.GooglePlayServices), dismissed = false)
        val model = BrowserCompatBannerViewModel(source, RecordingLogger())
        assertFalse(source.isDismissed())
        assertTrue(model.surface.value is BrowserCompatSurface.Active)
    }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() {
        val logger = RecordingLogger()
        val model = BrowserCompatBannerViewModel(browserCompatSource(listOf(RequiredCapability.WebView)), logger)

        model.recordViewOpened()
        model.recordViewOpened()

        val opened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals("BrowserCompatBanner", opened.first().fields["surface"])
        assertTrue("diagnostics carry only the surface slug", opened.first().fields.keys == setOf("surface"))
    }
}
