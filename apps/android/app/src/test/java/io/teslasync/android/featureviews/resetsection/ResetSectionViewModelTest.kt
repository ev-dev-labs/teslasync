package io.teslasync.android.featureviews.resetsection

import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiEvent
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.settingsreset.SettingsResetResult
import io.teslasync.shared.core.presentation.settingsreset.SettingsResetSectionResult
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [ResetSectionViewModel] over a controllable [InMemoryResetSectionSource], covering the confirm-then-run
 * machine (request → confirm → success/failure toast → dialog closed), the per-section vs global routing, the
 * busy guard, and the PII-safe `view.opened` / reset diagnostics (P1/S11 — surface slug only). Runs in the
 * :android:testReleaseUnitTest gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ResetSectionViewModelTest {
    @Test
    fun requestSectionOpensThePerSectionDialog() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(InMemoryResetSectionSource())
            vm.requestSection(row(ResetSectionId.Geofences))
            val state = vm.state.value
            assertTrue(state.isSectionDialogOpen)
            assertEquals(ResetSectionId.Geofences, state.pendingSection?.id)
        }

    @Test
    fun requestAllOpensTheDangerZoneDialog() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(InMemoryResetSectionSource())
            vm.requestAll()
            assertTrue(vm.state.value.isAllDialogOpen)
        }

    @Test
    fun dismissClosesAnOpenDialog() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(InMemoryResetSectionSource())
            vm.requestSection(row(ResetSectionId.Automations))
            vm.dismiss()
            assertEquals(ResetDialog.None, vm.state.value.dialog)
        }

    @Test
    fun confirmSectionRunsTheMutationRaisesSuccessAndClosesTheDialog() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                InMemoryResetSectionSource(
                    sectionOutcome = {
                        Result.success(
                            SettingsResetResult(reset = 4, sections = listOf(SettingsResetSectionResult("geofences", 4))),
                        )
                    },
                )
            val vm = viewModel(source)
            val events = collectEvents(vm)

            vm.requestSection(row(ResetSectionId.Geofences))
            vm.confirm()
            advanceUntilIdle()

            assertEquals(listOf("geofences"), source.sectionCalls)
            assertEquals(ResetDialog.None, vm.state.value.dialog)
            assertFalse(vm.state.value.busy)
            val message = events.filterIsInstance<UiEvent.Message>().single()
            assertEquals(SUCCESS_DETAIL_KEY, message.messageKey)
            assertEquals(UiEvent.Severity.Success, message.severity)
            assertEquals(listOf("4", "1"), message.args)
        }

    @Test
    fun confirmAllRunsTheGlobalMutationAndRaisesSuccess() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                InMemoryResetSectionSource(
                    allOutcome = {
                        Result.success(
                            SettingsResetResult(
                                reset = 9,
                                sections =
                                    listOf(
                                        SettingsResetSectionResult("alert_rules", 5),
                                        SettingsResetSectionResult("geofences", 4),
                                    ),
                            ),
                        )
                    },
                )
            val vm = viewModel(source)
            val events = collectEvents(vm)

            vm.requestAll()
            vm.confirm()
            advanceUntilIdle()

            assertEquals(1, source.allCalls)
            assertEquals(ResetDialog.None, vm.state.value.dialog)
            val message = events.filterIsInstance<UiEvent.Message>().single()
            assertEquals(SUCCESS_DETAIL_KEY, message.messageKey)
            assertEquals(listOf("9", "2"), message.args)
        }

    @Test
    fun confirmFailureRaisesAnErrorToastAndStillClosesTheDialog() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                InMemoryResetSectionSource(sectionOutcome = { Result.failure(IllegalStateException("boom")) })
            val vm = viewModel(source)
            val events = collectEvents(vm)

            vm.requestSection(row(ResetSectionId.AlertRules))
            vm.confirm()
            advanceUntilIdle()

            assertEquals(ResetDialog.None, vm.state.value.dialog)
            assertFalse(vm.state.value.busy)
            val message = events.filterIsInstance<UiEvent.Message>().single()
            assertEquals(ERROR_KEY, message.messageKey)
            assertEquals(UiEvent.Severity.Error, message.severity)
        }

    @Test
    fun confirmWithNoOpenDialogRunsNothing() =
        runTest(UnconfinedTestDispatcher()) {
            val source = InMemoryResetSectionSource()
            val vm = viewModel(source)
            vm.confirm()
            advanceUntilIdle()
            assertTrue(source.sectionCalls.isEmpty())
            assertEquals(0, source.allCalls)
        }

    @Test
    fun onAppearEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(InMemoryResetSectionSource(), logger)

            vm.onAppear()
            vm.onAppear()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "ResetSection"), opened.single().second)
        }

    @Test
    fun confirmLogsThePiiSafeResetDiagnostic() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(InMemoryResetSectionSource(), logger)

            vm.requestSection(row(ResetSectionId.Geofences))
            vm.confirm()
            advanceUntilIdle()

            val logged = logger.events.filter { it.first == "settingsReset.section" }
            assertEquals(1, logged.size)
            assertEquals(mapOf("surface" to "ResetSection"), logged.single().second)
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────

    private fun TestScope.viewModel(
        source: ResetSectionSource,
        logger: Logger = NoopLogger,
    ): ResetSectionViewModel = ResetSectionViewModel(source, logger, backgroundScope)

    private fun TestScope.collectEvents(vm: ResetSectionViewModel): List<UiEvent> {
        val events = mutableListOf<UiEvent>()
        backgroundScope.launch { vm.events.collect { events += it } }
        return events
    }

    private fun row(id: ResetSectionId): ResetSectionRow = ResetSectionRow(id, id.wire, "desc")

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }
}
