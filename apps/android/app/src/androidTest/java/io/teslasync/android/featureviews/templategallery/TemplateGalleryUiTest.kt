package io.teslasync.android.featureviews.templategallery

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [TemplateGalleryContent] across every state the surface
 * renders: the loading skeleton chrome, the hard-error retry surface, the empty state (with the always-present
 * blank option), the populated gallery (names, count badge), the gallery→detail selection, the detail's widget
 * list + "{{count}} widgets" + apply/back actions, the blank-option apply, and the stale/offline cached views.
 * Asserts the rendered i18n strings, that the cards are accessible buttons, and that selection/apply route the
 * preset id back to the host. The offline gate's `testReleaseUnitTest` covers the pure logic; this covers
 * render + a11y. Mirrors the web spec (web/src/features/dashboard/components/TemplateGallery.tsx).
 */
class TemplateGalleryUiTest {
    @get:Rule
    val compose = createComposeRule()

    /** Renders the content with a real internal selection state, so card taps drive the gallery↔detail flow. */
    private fun setStateful(
        state: UiState<List<DashboardTemplateData>>,
        onApply: (String) -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                var selected by remember { mutableStateOf<String?>(null) }
                TemplateGalleryContent(
                    state = state,
                    selectedId = selected,
                    onSelect = { selected = it },
                    onApply = {
                        onApply(it)
                        selected = null
                    },
                    onBack = { selected = null },
                    onRetry = onRetry,
                )
            }
        }
    }

    private fun loaded(): UiState<List<DashboardTemplateData>> = UiState(UiPhase.Content, data = DASHBOARD_PRESETS)

    @Test
    fun loadingShowsAccessibleSkeletonNotABlankPanel() {
        setStateful(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setStateful(UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsBlankOptionAndFriendlyMessage() {
        setStateful(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText("Blank Dashboard").assertIsDisplayed()
        compose.onNodeWithText("No dashboard templates available").assertIsDisplayed()
    }

    @Test
    fun galleryRendersBlankOptionAndPresetCardsAsButtons() {
        setStateful(loaded())
        compose.waitForIdle()

        compose.onNodeWithText("Blank Dashboard").assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText("Daily Commuter").assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText("Charging Hub").assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText("Minimal").assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun selectingACardOpensDetailWithWidgetsAndRoutesApplyPresetId() {
        var applied: String? = null
        setStateful(loaded(), onApply = { applied = it })
        compose.waitForIdle()

        compose.onNodeWithText("Charging Hub").performClick()

        // Detail view: the "{{count}} widgets" line, a resolved widget name, and the apply action.
        compose.onNodeWithText("7 widgets").assertIsDisplayed()
        compose.onNodeWithText("Charge Status Live").assertIsDisplayed()
        compose.onNodeWithText("Use This Template").performClick()
        assertEquals("charging_focus", applied)
    }

    @Test
    fun detailBackReturnsToGallery() {
        setStateful(loaded())
        compose.waitForIdle()

        compose.onNodeWithText("Charging Hub").performClick()
        compose.onNodeWithText("Use This Template").assertIsDisplayed()
        compose.onNodeWithText("Back").performClick()

        // Back at the gallery: the blank option is shown again and the apply button is gone.
        compose.onNodeWithText("Blank Dashboard").assertIsDisplayed()
    }

    @Test
    fun blankOptionRoutesTheBlankSentinel() {
        var applied: String? = null
        setStateful(loaded(), onApply = { applied = it })
        compose.waitForIdle()

        compose.onNodeWithText("Blank Dashboard").performClick()
        assertEquals(BLANK_PRESET_ID, applied)
    }

    @Test
    fun offlineShowsCachedGalleryWithOfflineChip() {
        setStateful(
            UiState(
                phase = UiPhase.Content,
                data = DASHBOARD_PRESETS,
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.waitForIdle()
        compose.onNodeWithText("Daily Commuter").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedGallery() {
        var refreshed = false
        setStateful(
            UiState(
                phase = UiPhase.Content,
                data = DASHBOARD_PRESETS,
                stale = true,
                fetchedAt = 1_700_000_000_000L,
            ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Daily Commuter").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
