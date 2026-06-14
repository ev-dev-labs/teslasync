// Off-device verification of the VersionSegment pure model + projection — the web component's inline
// derivations (web/src/components/layout/status-bar/VersionSegment.tsx): the app-version / SHA / platform /
// uptime resolution, the JSON provenance reads, the dot + freshness selection, and the button + modal render
// projection (rows, update banner, phase, freshness chips). Runs in the :android:testReleaseUnitTest gate.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.versionsegment

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class VersionSegmentModelTest {
    private fun strings(): VersionSegmentStrings =
        VersionSegmentStrings(
            tooltipWord = "TeslaSync version",
            ariaWord = "TeslaSync version",
            updateAvailable = "Update available",
            unseenAria = "unseen changelog",
            appVersionLabel = "App version",
            commitLabel = "Commit",
            chartLabel = "Helm chart",
            goLabel = "Go runtime",
            platformLabel = "Platform",
            uptimeRowLabel = "Server uptime",
            modalTitle = "About this build",
            updateBannerTitle = "A newer release is available",
            whatsNew = "What's new",
            releaseNotes = "Release notes",
            close = "Close",
            loading = "Loading",
            stale = "Stale",
            offline = "You're offline",
            retry = "Retry",
            errorMessage = "Failed to load data",
            emptyMessage = "No data available",
        )

    @Suppress("LongParameterList")
    private fun versionJson(
        appVersion: String? = null,
        uptimeSeconds: Long? = null,
        chartVersion: String? = null,
        goVersion: String? = null,
        os: String? = null,
        arch: String? = null,
    ): JsonElement =
        buildJsonObject {
            appVersion?.let { put("app_version", it) }
            uptimeSeconds?.let { put("uptime_seconds", it) }
            chartVersion?.let { put("chart_version", it) }
            goVersion?.let { put("go_version", it) }
            os?.let { put("os", it) }
            arch?.let { put("arch", it) }
        }

    private fun content(json: JsonElement): UiState<JsonElement> = UiState(UiPhase.Content, data = json)

    // ── uptimeLabel (web uptimeLabel) ────────────────────────────────────────────────────────────────────────

    @Test
    fun uptimeLabelIsNullForMissingOrNonPositive() {
        assertNull(VersionSegmentProjection.uptimeLabel(null))
        assertNull(VersionSegmentProjection.uptimeLabel(0L))
        assertNull(VersionSegmentProjection.uptimeLabel(-5L))
    }

    @Test
    fun uptimeLabelFormatsMinutesHoursAndDays() {
        assertEquals("5m", VersionSegmentProjection.uptimeLabel(5L * 60L))
        assertEquals("2h 30m", VersionSegmentProjection.uptimeLabel(2L * 3_600L + 30L * 60L))
        assertEquals("3d 2h", VersionSegmentProjection.uptimeLabel(3L * 86_400L + 2L * 3_600L))
    }

    // ── appVersion / SHA resolution (web resolution order) ───────────────────────────────────────────────────

    @Test
    fun appVersionPrefersTheServerValue() {
        assertEquals("0.9.0", VersionSegmentProjection.resolveAppVersion("0.9.0", "0.1.0"))
    }

    @Test
    fun appVersionFallsBackWhenServerIsUnknownOrBlank() {
        assertEquals("0.1.0", VersionSegmentProjection.resolveAppVersion("unknown", "0.1.0"))
        assertEquals("0.1.0", VersionSegmentProjection.resolveAppVersion(null, "0.1.0"))
        assertEquals("0.1.0", VersionSegmentProjection.resolveAppVersion("", "0.1.0"))
    }

    @Test
    fun appVersionFallsBackToDevAsTheWorstCase() {
        assertEquals(DEV_VERSION, VersionSegmentProjection.resolveAppVersion(null, ""))
    }

    @Test
    fun shaIsNullWhenItIsTheDevFallback() {
        assertNull(VersionSegmentProjection.resolveSha("dev"))
        assertNull(VersionSegmentProjection.resolveSha(""))
        assertEquals("abc1234", VersionSegmentProjection.resolveSha("abc1234"))
    }

    // ── platform join (web [os, arch].filter(Boolean).join('/')) ─────────────────────────────────────────────

    @Test
    fun platformJoinsPresentParts() {
        assertEquals("linux/amd64", VersionSegmentProjection.platformText("linux", "amd64"))
        assertEquals("linux", VersionSegmentProjection.platformText("linux", null))
        assertEquals("amd64", VersionSegmentProjection.platformText("", "amd64"))
        assertNull(VersionSegmentProjection.platformText(null, ""))
    }

    // ── JSON provenance reads (web untyped reads) ────────────────────────────────────────────────────────────

    @Test
    fun parseVersionReadsTheWebFieldNames() {
        val fields =
            VersionSegmentProjection.parseVersion(
                versionJson(
                    appVersion = "0.9.0",
                    uptimeSeconds = 7_200L,
                    chartVersion = "0.9.0",
                    goVersion = "go1.25.0",
                    os = "linux",
                    arch = "amd64",
                ),
            )
        assertEquals("0.9.0", fields?.appVersion)
        assertEquals(7_200L, fields?.uptimeSeconds)
        assertEquals("go1.25.0", fields?.goVersion)
        assertEquals("amd64", fields?.arch)
    }

    @Test
    fun parseVersionIsNullForANonObjectAndSparseForAnEmptyObject() {
        assertNull(VersionSegmentProjection.parseVersion(null))
        val sparse = VersionSegmentProjection.parseVersion(buildJsonObject { })
        assertNull("a missing key collapses to null, exactly like the web `?? fallback`", sparse?.appVersion)
        assertNull(sparse?.uptimeSeconds)
    }

    // ── dot selection (web amber/cyan precedence) ────────────────────────────────────────────────────────────

    @Test
    fun dotPrefersUpdateThenUnseen() {
        assertEquals(SegmentDot.Update, VersionSegmentProjection.selectDot(updateAvailable = true, hasUnseen = true))
        assertEquals(SegmentDot.Unseen, VersionSegmentProjection.selectDot(updateAvailable = false, hasUnseen = true))
        assertEquals(SegmentDot.None, VersionSegmentProjection.selectDot(updateAvailable = false, hasUnseen = false))
    }

    // ── freshness (cache-then-network split) ─────────────────────────────────────────────────────────────────

    @Test
    fun freshnessReflectsTheFeedLifecycle() {
        assertEquals(SegmentFreshness.Fresh, VersionSegmentProjection.freshnessOf(content(versionJson())))
        val staleState = UiState(UiPhase.Content, data = versionJson(), stale = true, refreshing = true)
        assertEquals(SegmentFreshness.Stale, VersionSegmentProjection.freshnessOf(staleState))
        val offlineState = UiState(UiPhase.Content, data = versionJson(), stale = true, errorKind = ErrorKind.Network)
        assertEquals(SegmentFreshness.Offline, VersionSegmentProjection.freshnessOf(offlineState))
    }

    // ── button render ────────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun buttonRendersVersionShaAndUpdateDot() {
        val button =
            VersionSegmentProjection.buildButton(
                fields = VersionSegmentProjection.parseVersion(versionJson(appVersion = "0.9.0")),
                update = UpdateCheckInfo(updateAvailable = true),
                changelog = ChangelogStatus.None,
                state = content(versionJson(appVersion = "0.9.0")),
                build = BuildIdentity("0.1.0", "abc1234"),
            )
        assertEquals("v0.9.0", button.versionText)
        assertEquals("abc1234", button.shaText)
        assertEquals(SegmentDot.Update, button.dot)
        assertEquals(SegmentFreshness.Fresh, button.freshness)
    }

    @Test
    fun buttonFallsBackToBuildVersionAndHidesDevSha() {
        val button =
            VersionSegmentProjection.buildButton(
                fields = null,
                update = UpdateCheckInfo.None,
                changelog = ChangelogStatus(hasUnseen = true, newCount = 2),
                state = UiState.loading(),
                build = BuildIdentity("0.1.0", "dev"),
            )
        assertEquals("v0.1.0", button.versionText)
        assertNull(button.shaText)
        assertEquals(SegmentDot.Unseen, button.dot)
    }

    // ── modal render ─────────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun modalRowsAlwaysLeadWithBuildIdentity() {
        val modal =
            VersionSegmentProjection.buildModal(
                fields = null,
                update = UpdateCheckInfo.None,
                state = UiState.loading(),
                strings = strings(),
                build = BuildIdentity("0.1.0", "abc1234"),
            )
        assertEquals(ModalPhase.Loading, modal.phase)
        assertEquals("App version", modal.rows[0].label)
        assertEquals("v0.1.0", modal.rows[0].value)
        assertEquals("Commit", modal.rows[1].label)
        assertEquals("abc1234", modal.rows[1].value)
        assertEquals("the loading chrome message is surfaced", "Loading", modal.chromeMessage)
    }

    @Test
    fun modalAddsTheConditionalRowsWhenPresent() {
        val modal =
            VersionSegmentProjection.buildModal(
                fields =
                    VersionSegmentProjection.parseVersion(
                        versionJson(chartVersion = "0.9.0", goVersion = "go1.25.0", os = "linux", arch = "amd64", uptimeSeconds = 7_200L),
                    ),
                update = UpdateCheckInfo.None,
                state = content(versionJson()),
                strings = strings(),
                build = BuildIdentity("0.1.0", "abc1234"),
            )
        val labels = modal.rows.map { it.label }
        assertTrue(labels.containsAll(listOf("App version", "Commit", "Helm chart", "Go runtime", "Platform", "Server uptime")))
        assertEquals("v0.9.0", modal.rows.first { it.label == "Helm chart" }.value)
        assertEquals("linux/amd64", modal.rows.first { it.label == "Platform" }.value)
        assertEquals("2h 0m", modal.rows.first { it.label == "Server uptime" }.value)
        assertNull("a content phase has no chrome message", modal.chromeMessage)
    }

    @Test
    fun modalHidesTheChartRowWhenUnknown() {
        val modal =
            VersionSegmentProjection.buildModal(
                fields = VersionSegmentProjection.parseVersion(versionJson(chartVersion = "unknown")),
                update = UpdateCheckInfo.None,
                state = content(versionJson()),
                strings = strings(),
                build = BuildIdentity("0.1.0", "abc1234"),
            )
        assertFalse("the `unknown` chart sentinel hides the row, exactly like the web guard", modal.rows.any { it.label == "Helm chart" })
    }

    @Test
    fun modalSurfacesTheUpdateBannerWithTheLatestTag() {
        val modal =
            VersionSegmentProjection.buildModal(
                fields = VersionSegmentProjection.parseVersion(versionJson()),
                update = UpdateCheckInfo(updateAvailable = true, latest = "0.2.0", message = "Security fixes."),
                state = content(versionJson()),
                strings = strings(),
                build = BuildIdentity("0.1.0", "abc1234"),
            )
        assertEquals("A newer release is available: v0.2.0", modal.updateBanner?.title)
        assertEquals("Security fixes.", modal.updateBanner?.message)
    }

    @Test
    fun bannerOmitsTheTagAndMessageWhenAbsent() {
        val banner = VersionSegmentProjection.buildBanner(UpdateCheckInfo(updateAvailable = true), strings())
        assertEquals("A newer release is available", banner.title)
        assertNull(banner.message)
    }

    @Test
    fun modalReportsOfflineWithRetryOverCachedRows() {
        val offlineState = UiState(UiPhase.Content, data = versionJson(), stale = true, errorKind = ErrorKind.Network)
        val modal =
            VersionSegmentProjection.buildModal(
                fields = VersionSegmentProjection.parseVersion(versionJson()),
                update = UpdateCheckInfo.None,
                state = offlineState,
                strings = strings(),
                build = BuildIdentity("0.1.0", "abc1234"),
            )
        assertEquals(ModalPhase.Content, modal.phase)
        assertTrue(modal.offline)
        assertFalse(modal.stale)
        assertTrue(modal.canRetry)
    }

    @Test
    fun modalReportsHardErrorWithRetryAndChromeMessage() {
        val errorState = UiState<JsonElement>(UiPhase.Error, errorKind = ErrorKind.Network)
        val modal =
            VersionSegmentProjection.buildModal(
                fields = null,
                update = UpdateCheckInfo.None,
                state = errorState,
                strings = strings(),
                build = BuildIdentity("0.1.0", "abc1234"),
            )
        assertEquals(ModalPhase.Error, modal.phase)
        assertEquals("Failed to load data", modal.chromeMessage)
        assertTrue(modal.canRetry)
        assertEquals("the build identity is still shown on a hard error", "v0.1.0", modal.rows[0].value)
    }
}
