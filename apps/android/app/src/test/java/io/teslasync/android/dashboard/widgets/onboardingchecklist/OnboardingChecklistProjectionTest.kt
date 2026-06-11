package io.teslasync.android.dashboard.widgets.onboardingchecklist

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.notifications.AlertRule
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the pure checklist model + adapter helpers — the
 * [OnboardingChecklistProjection] (`useChecklistTasks` + `shouldHideChecklist` port), the
 * [resolveThemeId] / [aggregateNetwork] cache-then-network fold, and the [buildChecklistResource]
 * projection. No Compose, no coroutines; runs in the `:android:testReleaseUnitTest` gate.
 */
class OnboardingChecklistProjectionTest {
    private val themeJson = Json.parseToJsonElement("""{"theme":"tesla-red","mode":"dark"}""")

    private fun strings(): OnboardingChecklistStrings =
        OnboardingChecklistStrings(
            title = "Get started",
            dismiss = "Dismiss",
            completeMessage = "All set",
            dismissedTitle = "Hidden",
            dismissedMessage = "Restart or remove this widget.",
            restart = "Restart checklist",
            emptyMessage = "No setup steps available right now.",
            offlineLabel = "offline",
            refreshingLabel = "updating",
            progress = { done, total -> "$done/$total complete" },
            formatRelative = { "" },
            tasks =
                OnboardingTaskId.entries.associateWith {
                    OnboardingTaskCopy("T:${it.slug}", "D:${it.slug}", "C:${it.slug}")
                },
        )

    // A test fixture builder mirroring the nine-field web checklist input surface; the wide parameter
    // list is intrinsic to the model under test, so LongParameterList is suppressed for the fixture only.
    @Suppress("LongParameterList")
    private fun inputs(
        vehicleCount: Int = 0,
        alertRuleCount: Int = 0,
        channelCount: Int = 0,
        themeId: String = OnboardingChecklistProjection.DEFAULT_THEME_ID,
        commandPaletteDiscovered: Boolean = false,
        webPushGranted: Boolean = false,
        customizeDashboardCompleted: Boolean = false,
        dismissed: Boolean = false,
        completedAt: Long? = null,
    ) = OnboardingChecklistInputs(
        vehicleCount = vehicleCount,
        alertRuleCount = alertRuleCount,
        channelCount = channelCount,
        themeId = themeId,
        commandPaletteDiscovered = commandPaletteDiscovered,
        webPushGranted = webPushGranted,
        customizeDashboardCompleted = customizeDashboardCompleted,
        dismissed = dismissed,
        completedAt = completedAt,
    )

    private fun allCompleteInputs(completedAt: Long? = null) =
        inputs(
            vehicleCount = 1,
            alertRuleCount = 1,
            channelCount = 1,
            themeId = "tesla-red",
            commandPaletteDiscovered = true,
            webPushGranted = true,
            customizeDashboardCompleted = true,
            completedAt = completedAt,
        )

    // ---- per-task completion --------------------------------------------------------

    @Test
    fun eachTaskCompletePredicateMatchesItsSource() {
        assertTrue(OnboardingChecklistProjection.isComplete(OnboardingTaskId.ConnectVehicle, inputs(vehicleCount = 1)))
        assertFalse(OnboardingChecklistProjection.isComplete(OnboardingTaskId.ConnectVehicle, inputs(vehicleCount = 0)))
        assertTrue(OnboardingChecklistProjection.isComplete(OnboardingTaskId.PickTheme, inputs(themeId = "matrix-green")))
        assertFalse(OnboardingChecklistProjection.isComplete(OnboardingTaskId.PickTheme, inputs(themeId = "neon-cyan")))
        assertTrue(OnboardingChecklistProjection.isComplete(OnboardingTaskId.FirstAlert, inputs(alertRuleCount = 3)))
        assertTrue(OnboardingChecklistProjection.isComplete(OnboardingTaskId.NotificationChannel, inputs(channelCount = 1)))
        assertTrue(OnboardingChecklistProjection.isComplete(OnboardingTaskId.CommandPalette, inputs(commandPaletteDiscovered = true)))
        assertTrue(OnboardingChecklistProjection.isComplete(OnboardingTaskId.EnablePush, inputs(webPushGranted = true)))
        assertTrue(
            OnboardingChecklistProjection.isComplete(
                OnboardingTaskId.CustomizeDashboard,
                inputs(customizeDashboardCompleted = true),
            ),
        )
    }

    // ---- projection -----------------------------------------------------------------

    @Test
    fun projectBuildsEverySevenTaskInWebOrderWithLocalizedCopy() {
        val data = OnboardingChecklistProjection.project(inputs(), strings(), nowMs = 0L)
        assertEquals(7, data.totalCount)
        assertEquals(
            listOf(
                "connect-vehicle",
                "pick-theme",
                "first-alert",
                "notification-channel",
                "try-command-palette",
                "enable-push",
                "customize-dashboard",
            ),
            data.tasks.map { it.id },
        )
        val connect = data.tasks.first()
        assertEquals("T:connect-vehicle", connect.title)
        assertEquals("C:connect-vehicle", connect.ctaLabel)
        assertEquals("/tesla-account", connect.ctaTo)
        assertEquals(COMMAND_PALETTE_CTA, data.tasks[4].ctaTo)
    }

    @Test
    fun projectTalliesCompletionAndRoundsPercentage() {
        // 3 of 7 complete → 43%.
        val data =
            OnboardingChecklistProjection.project(
                inputs(vehicleCount = 1, alertRuleCount = 1, commandPaletteDiscovered = true),
                strings(),
                nowMs = 0L,
            )
        assertEquals(3, data.completeCount)
        assertEquals(43, data.progressPct)
        assertFalse(data.allComplete)
    }

    @Test
    fun projectReportsAllCompleteAtHundredPercent() {
        val data = OnboardingChecklistProjection.project(allCompleteInputs(), strings(), nowMs = 0L)
        assertEquals(7, data.completeCount)
        assertEquals(100, data.progressPct)
        assertTrue(data.allComplete)
    }

    @Test
    fun projectHidesWhenDismissed() {
        val data = OnboardingChecklistProjection.project(inputs(dismissed = true), strings(), nowMs = 0L)
        assertTrue(data.hidden)
    }

    // ---- shouldHide -----------------------------------------------------------------

    @Test
    fun shouldHideHonoursTheCelebrationWindow() {
        val completedAt = 1_000_000L
        val withinWindow = completedAt + OnboardingChecklistProjection.CELEBRATION_WINDOW_MS - 1
        val pastWindow = completedAt + OnboardingChecklistProjection.CELEBRATION_WINDOW_MS + 1
        assertFalse(OnboardingChecklistProjection.shouldHide(false, allComplete = true, completedAt, withinWindow))
        assertTrue(OnboardingChecklistProjection.shouldHide(false, allComplete = true, completedAt, pastWindow))
        // Not complete → never auto-hidden regardless of any stale stamp.
        assertFalse(OnboardingChecklistProjection.shouldHide(false, allComplete = false, completedAt, pastWindow))
    }

    // ---- resolveThemeId -------------------------------------------------------------

    @Test
    fun resolveThemeIdReadsTheSettingsThemeOrDefaults() {
        assertEquals("tesla-red", resolveThemeId(themeJson))
        assertEquals(OnboardingChecklistProjection.DEFAULT_THEME_ID, resolveThemeId(null))
        assertEquals(OnboardingChecklistProjection.DEFAULT_THEME_ID, resolveThemeId(Json.parseToJsonElement("{}")))
        assertEquals(OnboardingChecklistProjection.DEFAULT_THEME_ID, resolveThemeId(Json.parseToJsonElement("""{"theme":""}""")))
        assertEquals(OnboardingChecklistProjection.DEFAULT_THEME_ID, resolveThemeId(Json.parseToJsonElement("""{"theme":null}""")))
    }

    // ---- aggregateNetwork -----------------------------------------------------------

    @Test
    fun aggregateNetworkFoldsCountsThemeAndFreshness() {
        val aggregate =
            aggregateNetwork(
                vehicles = Resource.Success(emptyList(), 10L, false),
                alertRules = Resource.Success(listOf(AlertRule(id = 1L), AlertRule(id = 2L)), 20L, false),
                channels = Resource.Success(emptyList(), 30L, false),
                settings = Resource.Success(themeJson, 40L, false),
            )
        assertEquals(0, aggregate.vehicleCount)
        assertEquals(2, aggregate.alertRuleCount)
        assertEquals(0, aggregate.channelCount)
        assertEquals("tesla-red", aggregate.themeId)
        assertFalse(aggregate.coldStart)
        assertFalse(aggregate.refreshing)
        assertFalse(aggregate.stale)
        assertNull(aggregate.error)
        assertEquals(40L, aggregate.fetchedAt)
    }

    @Test
    fun aggregateNetworkIsColdStartOnlyWhenEveryFeedIsLoadingWithNoCache() {
        val cold =
            aggregateNetwork(
                Resource.Loading(null, null, false),
                Resource.Loading(null, null, false),
                Resource.Loading(null, null, false),
                Resource.Loading(null, null, false),
            )
        assertTrue(cold.coldStart)

        val refreshing =
            aggregateNetwork(
                Resource.Loading(emptyList(), 5L, false),
                Resource.Loading(null, null, false),
                Resource.Loading(null, null, false),
                Resource.Loading(null, null, false),
            )
        assertFalse(refreshing.coldStart)
        assertTrue(refreshing.refreshing)
    }

    @Test
    fun aggregateNetworkSurfacesStaleAndError() {
        val error = ApiError.Network()
        val aggregate =
            aggregateNetwork(
                Resource.Success(emptyList(), 10L, true),
                Resource.Error(emptyList(), 8L, true, error),
                Resource.Success(emptyList(), 30L, false),
                Resource.Success(themeJson, 40L, false),
            )
        assertTrue(aggregate.stale)
        assertSame(error, aggregate.error)
    }

    // ---- buildChecklistResource -----------------------------------------------------

    private fun prefs() = ChecklistPrefsSnapshot(false, false, false, dismissed = false, completedAt = null)

    @Test
    fun buildResourceIsContentlessLoadingOnColdStart() {
        val aggregate =
            NetworkAggregate(0, 0, 0, "neon-cyan", coldStart = true, refreshing = false, stale = false, error = null, fetchedAt = null)
        val resource = buildChecklistResource(aggregate, prefs())
        assertTrue(resource is Resource.Loading)
        assertNull(resource.cached)
    }

    @Test
    fun buildResourceKeepsInputsAsOfflineErrorWhenAFeedFailed() {
        val error = ApiError.Timeout()
        val aggregate =
            NetworkAggregate(1, 0, 0, "neon-cyan", coldStart = false, refreshing = false, stale = true, error = error, fetchedAt = 9L)
        val resource = buildChecklistResource(aggregate, prefs())
        assertTrue(resource is Resource.Error)
        assertEquals(1, resource.cached?.vehicleCount)
        assertTrue(resource.stale)
    }

    @Test
    fun buildResourceFlagsRefreshOverCachedInputs() {
        val aggregate =
            NetworkAggregate(0, 1, 0, "neon-cyan", coldStart = false, refreshing = true, stale = false, error = null, fetchedAt = 9L)
        val resource = buildChecklistResource(aggregate, prefs())
        assertTrue(resource is Resource.Loading)
        assertEquals(1, resource.cached?.alertRuleCount)
    }

    @Test
    fun buildResourceIsSuccessWhenEverythingResolved() {
        val aggregate =
            NetworkAggregate(2, 1, 1, "tesla-red", coldStart = false, refreshing = false, stale = false, error = null, fetchedAt = 40L)
        val resource = buildChecklistResource(aggregate, ChecklistPrefsSnapshot(true, true, true, dismissed = false, completedAt = 7L))
        assertTrue(resource is Resource.Success)
        val data = requireNotNull(resource.cached)
        assertEquals(2, data.vehicleCount)
        assertEquals("tesla-red", data.themeId)
        assertTrue(data.commandPaletteDiscovered)
        assertEquals(7L, data.completedAt)
    }
}
