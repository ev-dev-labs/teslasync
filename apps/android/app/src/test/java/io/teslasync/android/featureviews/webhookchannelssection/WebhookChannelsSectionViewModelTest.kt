package io.teslasync.android.featureviews.webhookchannelssection

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel
import io.teslasync.shared.core.presentation.notificationchannels.WebhookSignaturePreviewResult
import io.teslasync.shared.core.presentation.notificationchannels.WebhookTestResult
import io.teslasync.shared.core.presentation.notifications.NotificationChannelInput
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [WebhookChannelsSectionViewModel] over a controllable fake [WebhookChannelsSectionSource], covering the
 * full cache-then-network state matrix the webhook list can be in (loading / content / empty / hard error +
 * retry / stale-offline + retry), every mutation's typed [WebhookToast] (toggle / delete), the inline per-row
 * test-result map (success / non-2xx / transport failure) + spinner tracking, the save + signature-preview
 * delegation, and the PII-safe `view.opened` + refresh diagnostics. Mirrors the web component's hook behaviour
 * (web/src/features/settings/components/WebhookChannelsSection.tsx).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WebhookChannelsSectionViewModelTest {
    private fun webhook(
        id: Long,
        name: String = "Hook",
        enabled: Boolean = true,
    ): NotificationChannel.Webhook =
        NotificationChannel.Webhook(id = id, name = name, enabled = enabled, url = "https://x/webhook", method = "POST")

    private val populated = listOf(webhook(1))

    private class FakeSource(
        var channelEmissions: List<Resource<List<NotificationChannel.Webhook>>>,
    ) : WebhookChannelsSectionSource {
        var toggleResult: Result<NotificationChannel> = Result.success(NotificationChannel.Webhook(id = 1))
        var deleteResult: Result<Unit> = Result.success(Unit)
        var testResult: Result<WebhookTestResult> = Result.success(WebhookTestResult(success = true, statusCode = 200, latencyMs = 50))
        var saveResult: Result<NotificationChannel> = Result.success(NotificationChannel.Webhook(id = 1))
        var previewResult: Result<WebhookSignaturePreviewResult> = Result.success(WebhookSignaturePreviewResult("sha256=abc"))
        val toggled = mutableListOf<Long>()
        val deleted = mutableListOf<Long>()
        val tested = mutableListOf<Long>()
        val saved = mutableListOf<NotificationChannelInput>()
        val previewed = mutableListOf<Pair<String, String>>()
        var invalidateCount = 0

        override fun webhookChannels(): Flow<Resource<List<NotificationChannel.Webhook>>> = flow { channelEmissions.forEach { emit(it) } }

        override fun invalidate() {
            invalidateCount++
        }

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

        override suspend fun testWebhookChannel(
            id: Long,
            title: String?,
            message: String?,
        ): Result<WebhookTestResult> {
            tested += id
            return testResult
        }

        override suspend fun previewWebhookSignature(
            secret: String,
            body: String,
        ): Result<WebhookSignaturePreviewResult> {
            previewed += secret to body
            return previewResult
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
            backgroundScope.launch { vm.webhookChannels.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.webhookChannels.value.phase)
        }

    @Test
    fun contentWhenWebhooksPresent() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.webhookChannels.collect {} }
            advanceUntilIdle()

            val state = vm.webhookChannels.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(populated, state.data)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun emptyWhenNoWebhooks() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(emptyList(), 100L, false))))
            backgroundScope.launch { vm.webhookChannels.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.webhookChannels.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(
                    listOf(Resource.Loading(null, null, false), Resource.Error(null, null, false, ApiError.Network())),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.webhookChannels.collect {} }
            advanceUntilIdle()

            val state = vm.webhookChannels.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCacheWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.webhookChannels.collect {} }
            advanceUntilIdle()
            assertEquals(populated, vm.webhookChannels.value.data)

            src.channelEmissions = listOf(Resource.Error(populated, 100L, true, ApiError.Timeout()))
            vm.retry()
            advanceUntilIdle()

            val state = vm.webhookChannels.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(populated, state.data)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun toggleEnabledRaisesDisabledToastAndRecordsCall() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.toggle(webhook(7, enabled = true))
            advanceUntilIdle()

            assertEquals(listOf(7L), src.toggled)
            assertEquals(listOf<WebhookToast>(WebhookToast.Disabled), received)
        }

    @Test
    fun toggleDisabledRaisesEnabledToast() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(populated, 100L, false))))
            val received = collectToasts(vm)

            vm.toggle(webhook(8, enabled = false))
            advanceUntilIdle()

            assertEquals(listOf<WebhookToast>(WebhookToast.Enabled), received)
        }

    @Test
    fun toggleFailureRaisesToggleFailedToast() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            src.toggleResult = Result.failure(ApiError.Network())
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.toggle(webhook(9, enabled = true))
            advanceUntilIdle()

            assertEquals(listOf<WebhookToast>(WebhookToast.ToggleFailed), received)
        }

    @Test
    fun deleteRaisesDeletedToastAndRecordsCall() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.delete(webhook(5))
            advanceUntilIdle()

            assertEquals(listOf(5L), src.deleted)
            assertEquals(listOf<WebhookToast>(WebhookToast.Deleted), received)
        }

    @Test
    fun deleteDropsInlineTestResult() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)

            vm.test(webhook(5))
            advanceUntilIdle()
            assertTrue(vm.testResults.value.containsKey(5L))

            vm.delete(webhook(5))
            advanceUntilIdle()
            assertFalse(vm.testResults.value.containsKey(5L))
        }

    @Test
    fun deleteFailureRaisesDeleteFailedToast() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            src.deleteResult = Result.failure(ApiError.Network())
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.delete(webhook(5))
            advanceUntilIdle()

            assertEquals(listOf<WebhookToast>(WebhookToast.DeleteFailed), received)
        }

    @Test
    fun testStoresStructuredResultAndClearsSpinner() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            src.testResult = Result.success(WebhookTestResult(success = true, statusCode = 200, latencyMs = 42, signature = "sha256=x"))
            val vm = viewModel(src)

            vm.test(webhook(3))
            advanceUntilIdle()

            assertEquals(listOf(3L), src.tested)
            val result = vm.testResults.value[3L]
            assertNotNull(result)
            assertTrue(result!!.success)
            assertEquals(200, result.statusCode)
            assertNull(vm.testingChannelId.value)
        }

    @Test
    fun testStoresNon2xxResultAsFailureWithoutThrowing() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            src.testResult = Result.success(WebhookTestResult(success = false, statusCode = 500, latencyMs = 12, error = "boom"))
            val vm = viewModel(src)

            vm.test(webhook(3))
            advanceUntilIdle()

            val result = vm.testResults.value[3L]
            assertNotNull(result)
            assertFalse(result!!.success)
            assertEquals(500, result.statusCode)
            assertEquals("boom", result.error)
        }

    @Test
    fun testTransportFailureSynthesizesFailureResult() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            src.testResult = Result.failure(ApiError.Network())
            val vm = viewModel(src)

            vm.test(webhook(3))
            advanceUntilIdle()

            val result = vm.testResults.value[3L]
            assertNotNull(result)
            assertFalse(result!!.success)
            assertEquals(0, result.statusCode)
            assertNotNull(result.error)
        }

    @Test
    fun saveDelegatesToSourceAndReturnsResult() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)
            val input = toWebhookSavePayload(WebhookFormState(name = "New", url = "https://x", method = WebhookHttpMethod.Post))

            val result = vm.save(input)

            assertTrue(result.isSuccess)
            assertEquals(listOf<NotificationChannelInput>(input), src.saved)
            assertTrue(src.invalidateCount >= 1)
        }

    @Test
    fun previewSignatureDelegatesToSourceAndReturnsResult() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            src.previewResult = Result.success(WebhookSignaturePreviewResult("sha256=deadbeef"))
            val vm = viewModel(src)

            val result = vm.previewSignature("s3cret", WEBHOOK_SAMPLE_BODY)

            assertTrue(result.isSuccess)
            assertEquals("sha256=deadbeef", result.getOrNull()?.signature)
            assertEquals(listOf("s3cret" to WEBHOOK_SAMPLE_BODY), src.previewed)
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
            assertEquals(mapOf("surface" to "WebhookChannelsSection"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticAndInvalidatesSource() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val src = FakeSource(emptyList())
            val vm = viewModel(src, logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "webhookChannels.refresh" })
            assertTrue(src.invalidateCount >= 1)
        }

    private fun TestScope.collectToasts(vm: WebhookChannelsSectionViewModel): List<WebhookToast> {
        val received = mutableListOf<WebhookToast>()
        backgroundScope.launch { vm.toasts.collect { received += it } }
        return received
    }

    private fun TestScope.viewModel(
        source: WebhookChannelsSectionSource,
        logger: Logger = NoopLogger,
    ): WebhookChannelsSectionViewModel = WebhookChannelsSectionViewModel(source, logger, backgroundScope)
}
