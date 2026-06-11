package io.teslasync.android.featureviews.timestamptool

import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [TimestampToolContent] across the states the web tool
 * renders (web/src/features/admin/components/devtools/tools/TimestampTool.tsx): the always-present live clock +
 * "Now" button + the two labeled inputs, the unix conversion rows (shown only when the input parses), the iso
 * conversion rows (likewise), and the no-rows state when neither input parses. Also asserts the accessible
 * labels every interactive element exposes to TalkBack. Runs under `connectedAndroidTest`; the offline
 * `testReleaseUnitTest` gate covers the projection logic, this covers render + a11y.
 */
class TimestampToolUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val labels =
        TimestampToolLabels(
            title = "Timestamp",
            description = "Convert unix and ISO timestamps",
            now = "Now",
            unixTimestamp = "Unix Timestamp",
            isoTimestamp = "Iso Timestamp",
            iso = "Iso",
            local = "Local",
            relative = "Relative",
            unix = "Unix",
        )
    private val clock = LiveClock(unixSeconds = "1700000000", iso = "2023-11-14T22:13:20.000Z")
    private val unixConversion =
        UnixConversion(iso = "2023-11-14T22:13:20.000Z", local = "Nov 14, 2023, 10:13 PM", relative = "1h ago")
    private val isoConversion =
        IsoConversion(unix = "1704067200", local = "Jan 1, 2024, 12:00 AM", relative = "2m ago")

    private fun setContent(
        unix: UnixConversion? = null,
        iso: IsoConversion? = null,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                TimestampToolContent(
                    labels = labels,
                    liveClock = clock,
                    unixInput = "",
                    isoInput = "",
                    unixConversion = unix,
                    isoConversion = iso,
                    onNowClick = {},
                    onUnixChange = {},
                    onIsoChange = {},
                )
            }
        }
    }

    @Test
    fun liveClockNowButtonAndLabeledInputsAlwaysRender() {
        setContent()
        compose.onNodeWithText("Timestamp").assertIsDisplayed()
        compose.onNodeWithText(labels.description).assertIsDisplayed()
        compose.onNodeWithText("Now").assertIsDisplayed()
        // The live clock shows the current unix seconds and ISO string.
        compose.onNodeWithText("1700000000", substring = true).assertIsDisplayed()
        compose.onNodeWithText("2023-11-14T22:13:20.000Z", substring = true).assertIsDisplayed()
        // Both fields are labeled (accessible).
        compose.onNodeWithText("Unix Timestamp").assertIsDisplayed()
        compose.onNodeWithText("Iso Timestamp").assertIsDisplayed()
    }

    @Test
    fun unixConversionRowsRenderWhenTheInputParses() {
        setContent(unix = unixConversion)
        compose.onNodeWithText(unixConversion.local, substring = true).assertIsDisplayed()
        compose.onNodeWithText(unixConversion.relative, substring = true).assertIsDisplayed()
        // The row merges its label and value into one TalkBack node, so "Relative" is reachable.
        compose.onNodeWithText("Relative", substring = true).assertIsDisplayed()
    }

    @Test
    fun isoConversionRowsRenderWhenTheInputParses() {
        setContent(iso = isoConversion)
        compose.onNodeWithText(isoConversion.unix, substring = true).assertIsDisplayed()
        compose.onNodeWithText(isoConversion.local, substring = true).assertIsDisplayed()
        compose.onNodeWithText(isoConversion.relative, substring = true).assertIsDisplayed()
    }

    @Test
    fun conversionRowsAreHiddenWhenNeitherInputParses() {
        setContent()
        // Web parity: the conversion blocks are gated behind `{fromUnix && …}` / `{fromIso && …}`.
        compose.onNodeWithText("Local", substring = true).assertDoesNotExist()
        compose.onNodeWithText(unixConversion.relative, substring = true).assertDoesNotExist()
        compose.onNodeWithText(isoConversion.relative, substring = true).assertDoesNotExist()
    }

    @Test
    fun interactiveElementsExposeAccessibleLabels() {
        setContent()
        // The "Now" action and the two inputs carry TalkBack-readable labels; the card title/description too.
        compose.onNodeWithText("Now").assertIsDisplayed()
        compose.onNodeWithText("Unix Timestamp").assertIsDisplayed()
        compose.onNodeWithText("Iso Timestamp").assertIsDisplayed()
        compose.onNodeWithText("Timestamp").assertIsDisplayed()
        compose.onNodeWithText(labels.description).assertIsDisplayed()
    }
}
