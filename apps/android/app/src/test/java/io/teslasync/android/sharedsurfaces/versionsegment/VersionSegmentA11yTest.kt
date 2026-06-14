// Off-device accessibility verification of the VersionSegment surface — the merged tooltip + TalkBack label the
// composable renders for the footer button (web `aria-label` / tooltip composition). The pure builders are
// covered here so label presence is asserted without a Compose host; the on-device UI test additionally asserts
// the labels are attached to the live nodes. Runs in the :android:testReleaseUnitTest gate.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.versionsegment

import org.junit.Assert.assertEquals
import org.junit.Test

class VersionSegmentA11yTest {
    private val word = "TeslaSync version"

    // ── tooltip (web `{word} · v{appVersion}[ · {sha}][ · up {uptime}][ · {count} new release(s)]`) ───────────

    @Test
    fun tooltipShowsTheVersionWordAndVersion() {
        assertEquals(
            "TeslaSync version · v0.1.0",
            VersionSegmentProjection.tooltipLabel(word, appVersion = "0.1.0", sha = null, uptimeText = null, unseenHintText = null),
        )
    }

    @Test
    fun tooltipAppendsShaUptimeAndUnseenHintInOrder() {
        assertEquals(
            "TeslaSync version · v0.1.0 · abc1234 · up 3d 2h · 2 new release(s)",
            VersionSegmentProjection.tooltipLabel(
                word,
                appVersion = "0.1.0",
                sha = "abc1234",
                uptimeText = "up 3d 2h",
                unseenHintText = "2 new release(s)",
            ),
        )
    }

    // ── aria label (web `{word}: v{appVersion}[ ({sha})][, {unseenAria}]`) ───────────────────────────────────

    @Test
    fun ariaShowsTheBareVersionWhenNothingElseIsKnown() {
        assertEquals(
            "TeslaSync version: v0.1.0",
            VersionSegmentProjection.ariaLabel(word, appVersion = "0.1.0", sha = null, unseenAria = null),
        )
    }

    @Test
    fun ariaParenthesisesTheShaWhenPresent() {
        assertEquals(
            "TeslaSync version: v0.1.0 (abc1234)",
            VersionSegmentProjection.ariaLabel(word, appVersion = "0.1.0", sha = "abc1234", unseenAria = null),
        )
    }

    @Test
    fun ariaAppendsTheUnseenChangelogPhraseWhenThereAreUnseenEntries() {
        assertEquals(
            "TeslaSync version: v0.1.0 (abc1234), unseen changelog",
            VersionSegmentProjection.ariaLabel(word, appVersion = "0.1.0", sha = "abc1234", unseenAria = "unseen changelog"),
        )
    }

    @Test
    fun ariaAppendsTheUnseenPhraseEvenWithoutASha() {
        assertEquals(
            "TeslaSync version: v0.1.0, unseen changelog",
            VersionSegmentProjection.ariaLabel(word, appVersion = "0.1.0", sha = null, unseenAria = "unseen changelog"),
        )
    }
}
