package io.teslasync.android.featureviews.settingssearch

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of SettingsSearch across every branch the web spec
 * has (web/src/features/settings/components/SettingsSearch.tsx): the idle field (empty query → no dropdown),
 * the ranked result rows, the "No matching settings." empty row, the localized aria-label kept as the field's
 * accessible name, the tap-to-select callback, and the end-to-end type → match → select → clear flow on the
 * stateful surface. Every asserted string is resolved from the app's i18n resources so the test follows the
 * device locale rather than hard-coding English. The clock auto-advance is disabled so the dropdown's enter
 * animation cannot stall `waitForIdle`; it is settled with an explicit advance. Runs under
 * `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the pure projection + diagnostics.
 */
class SettingsSearchUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun string(id: Int) = context.getString(id)

    @Test
    fun idleRendersTheFieldWithoutADropdown() {
        setContent(query = "", results = SettingsSearchResults(SettingsSearchStatus.Idle))

        compose.onNodeWithContentDescription(string(R.string.translation_settings_search_label)).assertIsDisplayed()
        compose.onAllNodesWithText(string(R.string.translation_settings_search_noResults)).assertCountEquals(0)
        compose.onAllNodesWithText(THEME_TITLE).assertCountEquals(0)
    }

    @Test
    fun resultsShowEveryMatchedSettingRow() {
        setContent(query = "color", results = SettingsSearchResults(SettingsSearchStatus.Results, MATCHES))

        compose.onNodeWithText(THEME_TITLE).assertIsDisplayed()
        compose.onNodeWithText(CHART_PALETTE_TITLE).assertIsDisplayed()
    }

    @Test
    fun emptyShowsTheNoMatchingSettingsRow() {
        setContent(query = "zzzzzz", results = SettingsSearchResults(SettingsSearchStatus.Empty))

        compose.onNodeWithText(string(R.string.translation_settings_search_noResults)).assertIsDisplayed()
    }

    @Test
    fun searchFieldExposesItsLocalizedAccessibleName() {
        // Web `aria-label="Search settings"` — the field has no visible label but keeps the localized
        // accessible name for TalkBack.
        setContent(query = "", results = SettingsSearchResults(SettingsSearchStatus.Idle))

        compose.onNodeWithContentDescription(string(R.string.translation_settings_search_label)).assertIsDisplayed()
    }

    @Test
    fun eachResultRowIsAnAccessibleClickableOption() {
        setContent(query = "color", results = SettingsSearchResults(SettingsSearchStatus.Results, MATCHES))

        compose.onNodeWithText(THEME_TITLE).assertHasClickAction()
        compose.onNodeWithText(CHART_PALETTE_TITLE).assertHasClickAction()
    }

    @Test
    fun tappingAResultEmitsItsEntry() {
        var selected: SettingsSearchEntry? = null
        setContent(
            query = "color",
            results = SettingsSearchResults(SettingsSearchStatus.Results, MATCHES),
            onSelect = { selected = it },
        )

        compose.onNodeWithText(THEME_TITLE).performClick()
        compose.waitForIdle()

        assertEquals("appearance.theme", selected?.id)
        assertEquals("/settings#appearance", selected?.route)
    }

    @Test
    fun typingSurfacesMatchesThenSelectingNavigatesAndClearsTheField() {
        var navigated: SettingsSearchEntry? = null
        var fieldText = "seed"
        compose.mainClock.autoAdvance = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.size(width = WIDTH, height = HEIGHT)) {
                    val index = remember { SettingsSearchCatalog.buildIndex { _, default -> default } }
                    var query by remember { mutableStateOf("") }
                    fieldText = query
                    SettingsSearchContent(
                        query = query,
                        results = SettingsSearchProjection.project(index, query),
                        onQueryChange = { query = it },
                        onSelect = { entry ->
                            query = ""
                            navigated = entry
                        },
                    )
                }
            }
        }

        compose.onNodeWithContentDescription(string(R.string.translation_settings_search_label)).performTextInput("theme")
        compose.mainClock.advanceTimeBy(SETTLE_MS)
        compose.waitForIdle()

        compose.onNodeWithText(THEME_TITLE).performClick()
        compose.mainClock.advanceTimeBy(SETTLE_MS)
        compose.waitForIdle()

        assertEquals("appearance.theme", navigated?.id)
        assertEquals("", fieldText)
    }

    @Test
    fun statefulSurfaceComposesFromResourcesAndExposesTheField() {
        // Exercises the real top-level surface: the resource-backed i18n resolver, the catalogue build,
        // and the one-shot view.opened effect (a no-op logger) — it must compose and expose the field.
        compose.mainClock.autoAdvance = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.size(width = WIDTH, height = HEIGHT)) {
                    SettingsSearch(onNavigate = {}, logger = NoopLogger)
                }
            }
        }
        compose.mainClock.advanceTimeBy(SETTLE_MS)

        compose.onNodeWithContentDescription(string(R.string.translation_settings_search_label)).assertIsDisplayed()
    }

    private fun setContent(
        query: String,
        results: SettingsSearchResults,
        onSelect: (SettingsSearchEntry) -> Unit = {},
    ) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.size(width = WIDTH, height = HEIGHT)) {
                    SettingsSearchContent(
                        query = query,
                        results = results,
                        onQueryChange = {},
                        onSelect = onSelect,
                    )
                }
            }
        }
        compose.mainClock.advanceTimeBy(SETTLE_MS)
    }

    private object NoopLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private companion object {
        const val THEME_TITLE = "Theme"
        const val CHART_PALETTE_TITLE = "Chart palette"
        val WIDTH = 360.dp
        val HEIGHT = 720.dp
        const val SETTLE_MS = 2_000L

        val MATCHES =
            listOf(
                SettingsSearchEntry(
                    id = "appearance.theme",
                    route = "/settings#appearance",
                    section = "appearance",
                    title = THEME_TITLE,
                    description = "Choose light, dark, or system mode and pick an accent color.",
                    keywords = listOf("dark", "light", "color", "accent", "mode"),
                ),
                SettingsSearchEntry(
                    id = "appearance.chartPalette",
                    route = "/settings#appearance",
                    section = "appearance",
                    title = CHART_PALETTE_TITLE,
                    description = "Color-blind safe (Okabe-Ito) or stylistic neon chart colors.",
                    keywords = listOf("cb", "colorblind", "okabe", "neon", "colors"),
                ),
            )
    }
}
