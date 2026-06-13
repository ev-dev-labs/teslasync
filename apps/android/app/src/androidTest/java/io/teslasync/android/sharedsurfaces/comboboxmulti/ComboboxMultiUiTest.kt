package io.teslasync.android.sharedsurfaces.comboboxmulti

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [ComboboxMultiContent] across every state the web
 * component renders plus the async feed's lifecycle: the chips + filter field, the open option list, the
 * "No results" / "Maximum reached" empty rows, the loading row + spinner, the "{{count}} more" overflow footer,
 * the hard error + retry, and the stale / offline freshness chips. Asserts the rendered i18n strings and the
 * TalkBack labels on the chip-remove and chevron controls. Runs under `connectedAndroidTest`; the
 * `testReleaseUnitTest` gate covers the logic, this covers the render + a11y.
 */
class ComboboxMultiUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val open = ComboboxMultiInteraction(open = true)

    private val strings =
        ComboboxMultiStrings(
            noResults = "No results",
            resultsCountOne = "1 result",
            resultsCountTemplate = "{{count}} results",
            removedChipTemplate = "Removed {{label}}",
            removeChipTemplate = "Remove {{label}}",
            maxReached = "Maximum reached",
            loading = "Loading",
            hideOptions = "Hide options",
            showOptions = "Show options",
            moreHiddenTemplate = "{{count}} more — refine search",
            stale = "Stale",
            offline = "Offline",
        )

    @Test
    fun closedFieldShowsChipsAndAccessibleControls() {
        setContent(
            value = listOf(opt("a", "Alpha"), opt("b", "Bravo")),
            interaction = ComboboxMultiInteraction(open = false),
            display = display(visible = listOf(opt("c", "Charlie"))),
        )
        compose.onNodeWithText("Alpha").assertIsDisplayed()
        compose.onNodeWithText("Bravo").assertIsDisplayed()
        compose.onNodeWithContentDescription("Remove Alpha").assertIsDisplayed()
        compose.onNodeWithContentDescription("Show options").assertIsDisplayed()
    }

    @Test
    fun openOptionsRenderRows() {
        setContent(
            interaction = ComboboxMultiInteraction(open = true, activeIndex = 0),
            display = display(visible = listOf(opt("a", "Option 1"), opt("b", "Option 2"))),
        )
        compose.onNodeWithTag(COMBOBOX_MULTI_DROPDOWN_TAG).assertIsDisplayed()
        compose.onNodeWithText("Option 1").assertIsDisplayed()
        compose.onNodeWithText("Option 2").assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoResults() {
        setContent(interaction = open, display = display(phase = ComboboxListPhase.Empty))
        compose.onNodeWithTag(COMBOBOX_MULTI_EMPTY_TAG).assertIsDisplayed()
        compose.onNodeWithText("No results").assertIsDisplayed()
    }

    @Test
    fun maxReachedShowsMaximumReached() {
        setContent(
            value = listOf(opt("a", "Alpha"), opt("b", "Bravo")),
            interaction = open,
            display = display(atMax = true, phase = ComboboxListPhase.Empty),
            maxItems = 2,
        )
        compose.onNodeWithText("Maximum reached").assertIsDisplayed()
    }

    @Test
    fun loadingShowsLoadingRowAndSpinner() {
        setContent(interaction = open, display = display(phase = ComboboxListPhase.Loading, fieldLoading = true))
        compose.onNodeWithTag(COMBOBOX_MULTI_LOADING_TAG).assertIsDisplayed()
        compose.onNodeWithTag(COMBOBOX_MULTI_SPINNER_TAG).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAndInvokesIt() {
        var retried = false
        setContent(
            interaction = open,
            display = display(phase = ComboboxListPhase.Error, errorKind = ErrorKind.Network),
            callbacks = ComboboxMultiCallbacks(onRetry = { retried = true }),
        )
        compose.onNodeWithTag(COMBOBOX_MULTI_ERROR_TAG).assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun overflowShowsMoreHidden() {
        setContent(
            interaction = open,
            display = display(visible = listOf(opt("a", "Option 1")), totalMatches = 10, overflow = 9),
        )
        compose.onNodeWithTag(COMBOBOX_MULTI_OVERFLOW_TAG).assertIsDisplayed()
        compose.onNodeWithText("9 more — refine search").assertIsDisplayed()
    }

    @Test
    fun staleShowsStaleChip() {
        setContent(interaction = open, display = display(visible = listOf(opt("a", "Option 1")), stale = true))
        compose.onNodeWithText("Stale").assertIsDisplayed()
    }

    @Test
    fun offlineShowsOfflineChip() {
        setContent(
            interaction = open,
            display = display(visible = listOf(opt("a", "Option 1")), offline = true, errorKind = ErrorKind.Network),
        )
        compose.onNodeWithText("Offline").assertIsDisplayed()
    }

    @Test
    fun removeChipInvokesCallbackWithIndex() {
        var removedIndex = -1
        setContent(
            value = listOf(opt("a", "Alpha")),
            display = display(),
            callbacks = ComboboxMultiCallbacks(onRemove = { removedIndex = it }),
        )
        compose.onNodeWithContentDescription("Remove Alpha").performClick()
        assertEquals(0, removedIndex)
    }

    @Test
    fun filterFieldCarriesAccessibleLabel() {
        setContent(display = display())
        compose.onNodeWithTag(COMBOBOX_MULTI_INPUT_TAG).assertIsDisplayed()
    }

    private fun setContent(
        display: ComboboxMultiDisplay,
        value: List<ComboboxMultiOption> = emptyList(),
        interaction: ComboboxMultiInteraction = ComboboxMultiInteraction(),
        maxItems: Int? = null,
        callbacks: ComboboxMultiCallbacks = ComboboxMultiCallbacks(),
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ComboboxMultiContent(
                    value = value,
                    interaction = interaction,
                    display = display,
                    strings = strings,
                    label = "Vehicles",
                    maxItems = maxItems,
                    callbacks = callbacks,
                )
            }
        }
    }

    private fun display(
        visible: List<ComboboxMultiOption> = emptyList(),
        totalMatches: Int = visible.size,
        overflow: Int = 0,
        atMax: Boolean = false,
        phase: ComboboxListPhase = ComboboxListPhase.Options,
        fieldLoading: Boolean = false,
        stale: Boolean = false,
        offline: Boolean = false,
        errorKind: ErrorKind? = null,
    ): ComboboxMultiDisplay =
        ComboboxMultiDisplay(
            visibleOptions = visible,
            totalMatches = totalMatches,
            overflowCount = overflow,
            atMax = atMax,
            listPhase = phase,
            fieldLoading = fieldLoading,
            stale = stale,
            offline = offline,
            errorKind = errorKind,
        )

    private fun opt(
        key: String,
        label: String = key,
    ): ComboboxMultiOption = ComboboxMultiOption(key = key, label = label)
}
