package io.teslasync.android.sharedsurfaces.typography

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the Typography surface across every branch the web module
 * renders (web/src/components/ui/Typography.tsx): all thirteen composed roles, the four heading levels (with the
 * platform heading announcement and the `as` opt-out), the granular size / weight / color / monospace axes, the
 * variant-wins-over-granular precedence, the error role's assertive live region (web `role="alert"`), the convenience
 * wrappers, and the one-shot PII-safe `view.opened` diagnostic. Runs under `connectedAndroidTest`; the
 * `testReleaseUnitTest` gate covers the pure model + diagnostics off-device.
 *
 * The web module is purely presentational, so the generic data states (loading / empty / error / stale / offline) do
 * not apply (see TypographyModel.kt) — the surface's real states are the role / level / axis branches asserted here.
 */
class TypographyUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── Per-state: every composed role renders its text (the web typography.role set) ──────────────────────────

    @Test
    fun allThirteenRolesRenderTheirText() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Column {
                    HeadingContent(level = HeadingLevel.Page) { Text(PAGE) }
                    HeadingContent(level = HeadingLevel.Section) { Text(SECTION) }
                    HeadingContent(level = HeadingLevel.Panel) { Text(PANEL) }
                    HeadingContent(level = HeadingLevel.Sub) { Text(SUB) }
                    TypographyTextContent(variant = TypographyRole.Body) { Text(BODY) }
                    TypographyTextContent(variant = TypographyRole.BodySm) { Text(BODY_SM) }
                    TypographyTextContent(variant = TypographyRole.Caption) { Text(CAPTION) }
                    TypographyTextContent(variant = TypographyRole.Label) { Text(LABEL) }
                    TypographyTextContent(variant = TypographyRole.MetricValue) { Text(METRIC_VALUE) }
                    TypographyTextContent(variant = TypographyRole.MetricLabel) { Text(METRIC_LABEL) }
                    TypographyTextContent(variant = TypographyRole.Code) { Text(CODE) }
                    TypographyTextContent(variant = TypographyRole.Helper) { Text(HELPER) }
                    TypographyTextContent(variant = TypographyRole.Error) { Text(ERROR) }
                }
            }
        }

        listOf(
            PAGE,
            SECTION,
            PANEL,
            SUB,
            BODY,
            BODY_SM,
            CAPTION,
            LABEL,
            METRIC_VALUE,
            METRIC_LABEL,
            CODE,
            HELPER,
            ERROR,
        ).forEach { text ->
            compose.onNodeWithText(text).assertExists("role text '$text' must render")
        }
    }

    // ── Accessibility: headings announce as headings (web h1–h4); the `as` escape hatch can clear it ───────────

    @Test
    fun headingExposesTheHeadingSemantic() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                HeadingContent(level = HeadingLevel.Page) { Text(PAGE) }
            }
        }
        compose.onNodeWithText(PAGE).assertIsDisplayed().assert(hasHeading())
    }

    @Test
    fun headingSemanticCanBeClearedForTheAsEscapeHatch() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                HeadingContent(level = HeadingLevel.Page, headingSemantics = false) { Text(PAGE) }
            }
        }
        compose.onNodeWithText(PAGE).assertIsDisplayed().assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.Heading))
    }

    // ── Accessibility: the error role announces assertively (web role="alert") ─────────────────────────────────

    @Test
    fun errorTextAnnouncesAssertively() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ErrorText(text = ERROR, logger = RecordingLogger())
            }
        }
        compose.onNodeWithText(ERROR).assertIsDisplayed()
        compose
            .onNodeWithTag(TYPOGRAPHY_TEST_TAG)
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Assertive))
    }

    // ── Granular path + precedence (web `variant ? role : size/weight/color/mono`) ─────────────────────────────

    @Test
    fun granularAxesRenderTheirText() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Column {
                    TypographyTextContent(
                        size = TypographySize.Xl3,
                        weight = TypographyWeight.Bold,
                        color = TypographyColor.Secondary,
                    ) { Text(GRANULAR) }
                    TypographyTextContent(mono = true) { Text(MONO) }
                }
            }
        }
        compose.onNodeWithText(GRANULAR).assertIsDisplayed()
        compose.onNodeWithText(MONO).assertIsDisplayed()
    }

    @Test
    fun variantRendersEvenWhenGranularAxesAreAlsoSupplied() {
        // Web: when `variant` is set, size/weight/color are ignored — the text still renders at the role.
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                TypographyTextContent(
                    variant = TypographyRole.Body,
                    size = TypographySize.Xl3,
                    weight = TypographyWeight.Regular,
                ) { Text(BODY) }
            }
        }
        compose.onNodeWithText(BODY).assertIsDisplayed()
    }

    // ── Convenience wrappers render their text (web role exports) ───────────────────────────────────────────────

    @Test
    fun convenienceWrappersRenderTheirText() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Column {
                    PageTitle(text = PAGE, logger = RecordingLogger())
                    SectionTitle(text = SECTION, logger = RecordingLogger())
                    MetricValue(text = METRIC_VALUE, logger = RecordingLogger())
                    MetricLabel(text = METRIC_LABEL, logger = RecordingLogger())
                    Caption(text = CAPTION, logger = RecordingLogger())
                    HelperText(text = HELPER, logger = RecordingLogger())
                    TypographyLabel(text = LABEL, logger = RecordingLogger())
                    Code(text = CODE, logger = RecordingLogger())
                }
            }
        }
        listOf(PAGE, SECTION, METRIC_VALUE, METRIC_LABEL, CAPTION, HELPER, LABEL, CODE).forEach { text ->
            compose.onNodeWithText(text).assertExists("wrapper text '$text' must render")
        }
    }

    // ── Diagnostics: one-shot view.opened with only the surface slug (no text leak) ────────────────────────────

    @Test
    fun mountingEmitsViewOpenedOnceWithOnlyTheSlug() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Heading(text = SECTION, level = HeadingLevel.Section, logger = logger)
            }
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().level)
        assertEquals(mapOf("surface" to "Typography"), opened.single().fields)
        assertTrue("the rendered text must never leak", logger.records.none { it.fields.containsValue(SECTION) })
    }

    private fun hasHeading(): SemanticsMatcher = SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading)

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
        const val PAGE = "Fleet overview"
        const val SECTION = "Battery health"
        const val PANEL = "Charging sessions"
        const val SUB = "Last 30 days"
        const val BODY = "Range estimate updated"
        const val BODY_SM = "Synced from the vehicle"
        const val CAPTION = "Synced 2 minutes ago"
        const val LABEL = "State of charge"
        const val METRIC_VALUE = "342 km"
        const val METRIC_LABEL = "Estimated range"
        const val CODE = "vehicle_id=42"
        const val HELPER = "Values reflect the last sync"
        const val ERROR = "Could not reach the vehicle"
        const val GRANULAR = "Granular sized text"
        const val MONO = "monospaced text"
    }
}
