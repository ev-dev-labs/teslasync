package io.teslasync.android.featureviews.notificationchannelsview

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel
import io.teslasync.shared.core.presentation.notifications.ChannelTestResult
import io.teslasync.shared.core.presentation.notifications.NotificationChannelInput
import io.teslasync.shared.core.presentation.notifications.NotificationStats
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [NotificationChannelsViewModel] over a controllable fake [NotificationChannelsViewSource], covering the
 * full cache-then-network state matrix the channel list can be in (loading / content / empty / hard error +
 * retry / stale-offline + retry), the always-content stats projection, every mutation's typed [ChannelToast]
 * (toggle / delete / per-card test / modal test), the save delegation, and the PII-safe `view.opened` + refresh
 * diagnostics. Mirrors the web component's hook behaviour
 * (web/src/features/notifications/components/NotificationChannelsView.tsx).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NotificationChannelsViewModelTest {
    private fun discord(
        id: Long,
        name: String = "Ops",
        enabled: Boolean = true,
    ): NotificationChannel = NotificationChannel.Discord(id = id, name = name, enabled = enabled, webhookUrl = "https://x")

    private val populated = listOf(discord(1))

    private class FakeSource(
        var channelEmissions: List<Resource<List<NotificationChannel>>>,
        var statEmissions: List<Resource<NotificationStats>> = listOf(Resource.Loading(null, null, false)),
    ) : NotificationChannelsViewSource {
        var toggleResult: Result<NotificationChannel> = Result.success(NotificationChannel.Discord(id = 1))
        var deleteResult: Result<Unit> = Result.success(Unit)
        var testResult: Result<ChannelTestResult> = Result.success(ChannelTestResult(success = true))
        var saveResult: Result<NotificationChannel> = Result.success(NotificationChannel.Discord(id = 1))
        val toggled = mutableListOf<Long>()
        val deleted = mutableListOf<Long>()
        val tested = mutableListOf<Long>()
        val saved = mutableListOf<NotificationChannelInput>()

        override fun channels(): Flow<Resource<List<NotificationChannel>>> = flow { channelEmissions.forEach { emit(it) } }

        override fun stats(): Flow<Resource<NotificationStats>> = flow { statEmissions.forEach { emit(it) } }

        override suspend fun saveChannel(input: NotificationChannelInput): Result<NotificationChannel> {
            saved += input
            return saveResult
        }

        override suspend fun deleteChannel(id: Long): Result<Unit> {
            deleted += id
            return deleteResult
        }

        override suspend fun toggleChannel(id: Long): Result<NotificationChannel> {
            toggled += id
            return toggleResult
        }

        override suspend fun testChannel(id: Long): Result<ChannelTestResult> {
            tested += id
            return testResult
        }
    }

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

    @Test
    fun loadingWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Loading(null, null, false))))
            backgroundScope.launch { vm.channels.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.channels.value.phase)
        }

    @Test
    fun contentWhenChannelsPresent() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.channels.collect {} }
            advanceUntilIdle()

            val state = vm.channels.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(populated, state.data)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun emptyWhenNoChannels() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(emptyList(), 100L, false))))
            backgroundScope.launch { vm.channels.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.channels.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(
                    listOf(Resource.Loading(null, null, false), Resource.Error(null, null, false, ApiError.Network())),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.channels.collect {} }
            advanceUntilIdle()

            val state = vm.channels.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCacheWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.channels.collect {} }
            advanceUntilIdle()
            assertEquals(populated, vm.channels.value.data)

            src.channelEmissions = listOf(Resource.Error(populated, 100L, true, ApiError.Timeout()))
            vm.retry()
            advanceUntilIdle()

            val state = vm.channels.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(populated, state.data)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun statsAlwaysContentEvenWhenAllZero() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(
                    channelEmissions = listOf(Resource.Success(populated, 100L, false)),
                    statEmissions = listOf(Resource.Success(NotificationStats(), 100L, false)),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.stats.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.stats.value.phase)
        }

    @Test
    fun toggleEnabledChannelRaisesDisabledToastAndRecordsCall() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.toggle(discord(7, enabled = true))
            advanceUntilIdle()

            assertEquals(listOf(7L), src.toggled)
            assertEquals(listOf<ChannelToast>(ChannelToast.Disabled), received)
        }

    @Test
    fun toggleDisabledChannelRaisesEnabledToast() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(populated, 100L, false))))
            val received = collectToasts(vm)

            vm.toggle(discord(8, enabled = false))
            advanceUntilIdle()

            assertEquals(listOf<ChannelToast>(ChannelToast.Enabled), received)
        }

    @Test
    fun toggleFailureRaisesToggleFailedToast() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            src.toggleResult = Result.failure(ApiError.Network())
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.toggle(discord(9, enabled = true))
            advanceUntilIdle()

            assertEquals(listOf<ChannelToast>(ChannelToast.ToggleFailed), received)
        }

    @Test
    fun deleteRaisesDeletedToastAndRecordsCall() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.delete(discord(5))
            advanceUntilIdle()

            assertEquals(listOf(5L), src.deleted)
            assertEquals(listOf<ChannelToast>(ChannelToast.Deleted), received)
        }

    @Test
    fun deleteFailureRaisesDeleteFailedToast() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            src.deleteResult = Result.failure(ApiError.Network())
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.delete(discord(5))
            advanceUntilIdle()

            assertEquals(listOf<ChannelToast>(ChannelToast.DeleteFailed), received)
        }

    @Test
    fun testFromCardSuccessRaisesNamePrefixedToastAndClearsSpinner() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.testFromCard(discord(3, name = "Ops Discord"))
            advanceUntilIdle()

            assertEquals(listOf(3L), src.tested)
            assertEquals(listOf<ChannelToast>(ChannelToast.TestSucceeded("Ops Discord")), received)
            assertNull(vm.testingChannelId.value)
        }

    @Test
    fun testFromCardServerFailureRaisesNamePrefixedFailureWithDetail() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            src.testResult = Result.success(ChannelTestResult(success = false, error = "boom"))
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.testFromCard(discord(3, name = "Ops"))
            advanceUntilIdle()

            assertEquals(listOf<ChannelToast>(ChannelToast.TestFailed("Ops", "boom")), received)
        }

    @Test
    fun testFromCardTransportFailureRaisesFailureWithoutDetail() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            src.testResult = Result.failure(ApiError.Network())
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.testFromCard(discord(3, name = "Ops"))
            advanceUntilIdle()

            assertEquals(listOf<ChannelToast>(ChannelToast.TestFailed("Ops", null)), received)
        }

    @Test
    fun saveDelegatesToSourceAndReturnsResult() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)
            val input = NotificationChannelInput.Discord(name = "New", enabled = true, webhookUrl = "https://x")

            val result = vm.save(input)

            assertTrue(result.isSuccess)
            assertEquals(listOf<NotificationChannelInput>(input), src.saved)
        }

    @Test
    fun testFromModalRaisesNamelessToastAndReturnsResult() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)
            val received = collectToasts(vm)

            val result = vm.testFromModal(2L)
            advanceUntilIdle()

            assertTrue(result.isSuccess)
            assertEquals(listOf(2L), src.tested)
            assertEquals(listOf<ChannelToast>(ChannelToast.TestSucceeded(null)), received)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "NotificationChannelsView"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "notificationChannels.refresh" })
        }

    private fun TestScope.collectToasts(vm: NotificationChannelsViewModel): List<ChannelToast> {
        val received = mutableListOf<ChannelToast>()
        backgroundScope.launch { vm.toasts.collect { received += it } }
        return received
    }

    private fun TestScope.viewModel(
        source: NotificationChannelsViewSource,
        logger: Logger = NoopLogger,
    ): NotificationChannelsViewModel = NotificationChannelsViewModel(source, logger, backgroundScope)
}
