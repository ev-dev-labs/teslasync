package io.teslasync.android.featureviews.drivehighlightslide

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.data.UnitPreferences
import io.teslasync.android.ui.theme.TeslaSyncTheme
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [DriveHighlightSlideContent] across every state the
 * surface renders: the empty state (`drive == null` → the localized "No drive data for this year" line), the
 * populated metric state (label + route + distance/duration/efficiency + date), the populated imperial state
 * (the `mi` / `Wh/mi` unit labels), and the non-positive-efficiency fallback (`—`). Also asserts the content
 * renders under reduced motion (the entrance animations collapse to their final state, so every label is
 * present immediately). Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers
 * the pure projection logic, this covers render + a11y. Mirrors the web spec
 * (web/src/features/analytics/components/review/DriveHighlightSlide.tsx).
 */
class DriveHighlightSlideUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val drive =
        DriveHighlight(
            driveId = 1,
            date = "2026-03-14",
            distanceKm = 100.0,
            durationMin = 90.0,
            startAddress = "San Francisco, CA",
            endAddress = "Los Angeles, CA",
            efficiencyWhKm = 150.0,
        )

    private fun milesFormatter(): UnitFormatter {
        val settings = buildJsonObject { put("unit_of_length", "mi") }
        return UnitFormatter(UnitPreferences.fromSettings(settings))
    }

    private fun setContent(
        drive: DriveHighlight?,
        label: String = "Longest Drive",
        emoji: String = "\uD83C\uDFC6",
        formatter: UnitFormatter = UnitFormatter.default(),
        reduceMotion: Boolean? = null,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides reduceMotion) {
                    DriveHighlightSlideContent(drive = drive, label = label, emoji = emoji, formatter = formatter)
                }
            }
        }
    }

    @Test
    fun emptyStateRendersTheNoDriveDataMessage() {
        setContent(drive = null)
        compose.onNodeWithText("No drive data for this year").assertIsDisplayed()
    }

    @Test
    fun metricContentRendersLabelRouteAndAllStats() {
        setContent(drive = drive)
        // Web CSS `uppercase` label.
        compose.onNodeWithText("LONGEST DRIVE").assertIsDisplayed()
        // Route endpoints (full text is in the semantics tree even when visually truncated).
        compose.onNodeWithText("San Francisco, CA").assertIsDisplayed()
        compose.onNodeWithText("Los Angeles, CA").assertIsDisplayed()
        // Distance / duration / efficiency + their unit captions, and the date.
        compose.onNodeWithText("100").assertIsDisplayed()
        compose.onNodeWithText("km").assertIsDisplayed()
        compose.onNodeWithText("1h 30m").assertIsDisplayed()
        compose.onNodeWithText("duration").assertIsDisplayed()
        compose.onNodeWithText("150").assertIsDisplayed()
        compose.onNodeWithText("Wh/km").assertIsDisplayed()
        compose.onNodeWithText("2026-03-14").assertIsDisplayed()
    }

    @Test
    fun imperialContentRendersMilesAndWhPerMile() {
        setContent(drive = drive, label = "Most Efficient", emoji = "\u26A1", formatter = milesFormatter())
        // 100 km -> 62 mi; 150 Wh/km -> 241 Wh/mi.
        compose.onNodeWithText("62").assertIsDisplayed()
        compose.onNodeWithText("mi").assertIsDisplayed()
        compose.onNodeWithText("241").assertIsDisplayed()
        compose.onNodeWithText("Wh/mi").assertIsDisplayed()
    }

    @Test
    fun nonPositiveEfficiencyRendersTheEmDashFallback() {
        setContent(drive = drive.copy(efficiencyWhKm = 0.0))
        // Web `efficiency_wh_km > 0 ? ... : '—'`; the unit caption is still shown.
        compose.onNodeWithText("\u2014").assertIsDisplayed()
        compose.onNodeWithText("Wh/km").assertIsDisplayed()
    }

    @Test
    fun contentRendersUnderReducedMotion() {
        // With reduced motion the emoji/label/card entrance collapse to their final state, so the label
        // (and stats) are present immediately rather than mid-animation.
        setContent(drive = drive, reduceMotion = true)
        compose.onNodeWithText("LONGEST DRIVE").assertIsDisplayed()
        compose.onNodeWithText("100").assertIsDisplayed()
    }
}
