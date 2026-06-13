package io.teslasync.android.sharedsurfaces.breadcrumbs

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [BreadcrumbsContent] / [Breadcrumbs] across every branch
 * the web component renders (web/src/components/layout/Breadcrumbs.tsx): the wide trail (every label + the Home
 * link), the compact responsive collapse (middle label hidden), the link-crumb and Home-link navigation
 * callbacks, the localized "Breadcrumb" landmark label, and the degenerate-trail guard that renders nothing.
 * Also covers the one-shot PII-safe `view.opened` diagnostic (P1/S11). Runs under `connectedAndroidTest`; the
 * `testReleaseUnitTest` gate covers the pure [classify] + diagnostics logic and the a11y-label builder.
 */
class BreadcrumbsUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── Wide viewport: every label + the Home link render ─────────────────────────────────────────────

    @Test
    fun wideTrailRendersEveryLabelAndHomeLink() {
        setTrail(width = 720, items = SAMPLE_TRAIL, onNavigate = {})

        compose.onNodeWithContentDescription("Dashboard").assertIsDisplayed()
        compose.onNodeWithText("Vehicles", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Model 3", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Battery", useUnmergedTree = true).assertIsDisplayed()
    }

    // ── Compact viewport: the interior label collapses (web `hidden sm:inline`) ────────────────────────

    @Test
    fun compactTrailCollapsesTheMiddleEntry() {
        setTrail(width = 320, items = SAMPLE_TRAIL, onNavigate = {})

        compose.onNodeWithText("Vehicles", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Battery", useUnmergedTree = true).assertIsDisplayed()
        // The interior "Model 3" label is replaced by the aria-hidden collapsed indicator, so it is absent.
        compose.onNodeWithText("Model 3", useUnmergedTree = true).assertDoesNotExist()
    }

    // ── Navigation is delegated to the parent via onNavigate (web `<PrefetchLink to=href>`) ────────────

    @Test
    fun tappingALinkCrumbNavigatesWithItsHref() {
        var navigated: String? = null
        setTrail(width = 720, items = SAMPLE_TRAIL, onNavigate = { navigated = it })

        compose.onNodeWithText("Vehicles", useUnmergedTree = true).assertHasClickAction().performClick()
        assertEquals("/vehicles", navigated)
    }

    @Test
    fun tappingHomeNavigatesToTheHomeHref() {
        var navigated: String? = null
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(Modifier.width(720.dp)) {
                    BreadcrumbsContent(items = SAMPLE_TRAIL, onNavigate = { navigated = it }, homeHref = "/fleet")
                }
            }
        }

        val home = compose.onNodeWithContentDescription("Dashboard")
        home.assertHasClickAction().performClick()
        assertEquals("/fleet", navigated)
    }

    // ── Degenerate trail renders nothing (web `if (items.length <= 1) return null`) ────────────────────

    @Test
    fun singleSegmentTrailRendersNothing() {
        setTrail(width = 720, items = listOf(BreadcrumbItem("Vehicles", "/vehicles")), onNavigate = {})

        compose.onNodeWithText("Vehicles", useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithContentDescription("Breadcrumb").assertDoesNotExist()
    }

    // ── Accessibility: the container exposes the localized landmark label ──────────────────────────────

    @Test
    fun trailExposesTheBreadcrumbLandmarkLabel() {
        setTrail(width = 720, items = SAMPLE_TRAIL, onNavigate = {})
        compose.onNodeWithContentDescription("Breadcrumb").assertExists()
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) ────────────────────────────────────────

    @Test
    fun mountingTheStatefulSurfaceEmitsViewOpenedOnce() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(Modifier.width(720.dp)) {
                    Breadcrumbs(items = SAMPLE_TRAIL, onNavigate = {}, logger = logger)
                }
            }
        }
        compose.waitForIdle()

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "Breadcrumbs"), fields)
    }

    private fun setTrail(
        width: Int,
        items: List<BreadcrumbItem>,
        onNavigate: (String) -> Unit,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(Modifier.width(width.dp)) {
                    BreadcrumbsContent(items = items, onNavigate = onNavigate)
                }
            }
        }
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

    private companion object {
        private val SAMPLE_TRAIL =
            listOf(
                BreadcrumbItem("Vehicles", "/vehicles"),
                BreadcrumbItem("Model 3", "/vehicles/1"),
                BreadcrumbItem("Battery"),
            )
    }
}
