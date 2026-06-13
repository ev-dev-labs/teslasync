package io.teslasync.android.sharedsurfaces.browsercompatbanner

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the BrowserCompatBanner's pure logic — the native mirror of every decision the web
 * component makes (web/src/components/feedback/BrowserCompatBanner.tsx + web/src/lib/browserCompat.ts): the
 * capability taxonomy, the `detectMissingFeatures` reduction, the comma-joined feature list, and the
 * `dismissed || missing.length === 0` → render-nothing classification. Because the composable is a thin render
 * layer over [classify] + [joinFeatures], the per-branch assertions here double as the surface's per-state
 * snapshot. Runs in the :android:testReleaseUnitTest gate.
 */
class BrowserCompatBannerModelTest {
    // ── capability taxonomy (web literal feature identifiers) ────────────────────────────────────────

    @Test
    fun requiredCapabilityLabelsAreStableIdentifiers() {
        assertEquals("Android System WebView", RequiredCapability.WebView.label)
        assertEquals("Google Play Services", RequiredCapability.GooglePlayServices.label)
        assertEquals("Chrome Custom Tabs", RequiredCapability.CustomTabs.label)
    }

    // ── joinFeatures (web `missing.join(', ')`) ──────────────────────────────────────────────────────

    @Test
    fun joinFeaturesProducesACommaSeparatedListInDeclarationOrder() {
        assertEquals("", joinFeatures(emptyList()))
        assertEquals("Android System WebView", joinFeatures(listOf(RequiredCapability.WebView)))
        assertEquals(
            "Android System WebView, Chrome Custom Tabs",
            joinFeatures(listOf(RequiredCapability.WebView, RequiredCapability.CustomTabs)),
        )
    }

    // ── missingCapabilities (web `detectMissingFeatures` reduction) ──────────────────────────────────

    @Test
    fun missingCapabilitiesIsEmptyWhenEveryProbePasses() {
        assertEquals(
            emptyList<RequiredCapability>(),
            missingCapabilities(hasWebView = true, hasPlayServices = true, hasCustomTabs = true),
        )
    }

    @Test
    fun missingCapabilitiesListsEveryAbsentCapabilityInDeclarationOrder() {
        assertEquals(
            listOf(
                RequiredCapability.WebView,
                RequiredCapability.GooglePlayServices,
                RequiredCapability.CustomTabs,
            ),
            missingCapabilities(hasWebView = false, hasPlayServices = false, hasCustomTabs = false),
        )
    }

    @Test
    fun missingCapabilitiesReportsOnlyTheFailingProbes() {
        assertEquals(
            listOf(RequiredCapability.GooglePlayServices),
            missingCapabilities(hasWebView = true, hasPlayServices = false, hasCustomTabs = true),
        )
    }

    // ── classify: the per-state snapshot (web `if (dismissed || missing.length === 0) return null`) ──

    @Test
    fun classifyHidesWhenNoCapabilitiesAreMissing() {
        // Web "renders nothing when no features are missing".
        assertEquals(BrowserCompatSurface.Hidden, classify(emptyList(), dismissed = false))
    }

    @Test
    fun classifyHidesWhenDismissedEvenWithMissingCapabilities() {
        // Web "stays hidden across remounts after dismissal" — a persisted dismissal wins over detection.
        assertEquals(
            BrowserCompatSurface.Hidden,
            classify(listOf(RequiredCapability.WebView), dismissed = true),
        )
    }

    @Test
    fun classifyShowsActiveWithTheJoinedFeatureListWhenMissingAndNotDismissed() {
        // Web "renders the warning banner with the missing feature names".
        val surface = classify(listOf(RequiredCapability.WebView, RequiredCapability.CustomTabs), dismissed = false)
        assertTrue(surface is BrowserCompatSurface.Active)
        surface as BrowserCompatSurface.Active
        assertEquals(listOf(RequiredCapability.WebView, RequiredCapability.CustomTabs), surface.missing)
        assertEquals("Android System WebView, Chrome Custom Tabs", surface.features)
    }

    // ── accessibility label (TalkBack announcement) ──────────────────────────────────────────────────

    @Test
    fun accessibilityLabelMergesTitleAndBody() {
        val label =
            bannerAccessibilityLabel(
                "Your browser is missing required features",
                "TeslaSync needs Android System WebView to work correctly. Update it.",
            )
        assertEquals(
            "Your browser is missing required features. " +
                "TeslaSync needs Android System WebView to work correctly. Update it.",
            label,
        )
    }
}
