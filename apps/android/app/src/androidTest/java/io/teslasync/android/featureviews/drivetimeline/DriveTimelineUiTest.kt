package io.teslasync.android.featureviews.drivetimeline

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [DriveTimelineContent] across every state the surface
 * renders: the finished drive (the green-flagged start time, the muted duration, and the red-flagged end
 * time) and the in-progress drive (the localized "In progress" copy in place of an end time). Each legend
 * cell is merged into one localized TalkBack label ("Start, …" / "Duration, …" / "End, …"), so the assertions
 * here double as the per-state snapshot and the a11y-label coverage: every cell exposes both its label and its
 * value to accessibility services. Also asserts the content renders under reduced motion (the [FadeIn]
 * entrance collapses to its final state, so every label is present immediately). The times are pinned to a
 * fixed UTC zone + US locale so the wall-clock assertions are deterministic. Runs under `connectedAndroidTest`;
 * the offline gate's `testReleaseUnitTest` covers the pure projection logic, this covers render + a11y.
 * Mirrors the web spec (web/src/features/driving/components/drive-detail/DriveTimeline.tsx).
 */
class DriveTimelineUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val finishedDrive =
        DriveTimelineDrive(
            startTs = "2026-03-14T09:15:00Z",
            endTs = "2026-03-14T11:45:00Z",
            durationS = 9000,
        )

    private val liveDrive =
        DriveTimelineDrive(
            startTs = "2026-03-14T07:42:00Z",
            endTs = null,
            durationS = 720,
        )

    private fun setContent(
        drive: DriveTimelineDrive,
        reduceMotion: Boolean? = null,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides reduceMotion) {
                    DriveTimelineContent(drive = drive, locale = Locale.US, zoneId = ZoneId.of("UTC"))
                }
            }
        }
    }

    @Test
    fun finishedDriveRendersStartDurationAndEndWithAccessibilityLabels() {
        setContent(drive = finishedDrive)

        // Each cell exposes its localized label and its value to accessibility services.
        compose.onNodeWithContentDescription("Start", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("9:15", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Duration", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("2h 30m", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("End", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("11:45", substring = true).assertIsDisplayed()
    }

    @Test
    fun inProgressDriveRendersTheInProgressCopyInPlaceOfAnEndTime() {
        setContent(drive = liveDrive)

        // Web `drive.endTs ? formatTime(endTs) : t('driveDetail.inProgress')` — the live branch.
        compose.onNodeWithContentDescription("In progress", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("7:42", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("12m", substring = true).assertIsDisplayed()
    }

    @Test
    fun contentRendersUnderReducedMotion() {
        // With reduced motion the FadeIn entrance collapses to its final state, so the labels and values are
        // present immediately rather than mid-animation.
        setContent(drive = finishedDrive, reduceMotion = true)

        compose.onNodeWithContentDescription("Start", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("2h 30m", substring = true).assertIsDisplayed()
    }
}
