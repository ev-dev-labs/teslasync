package io.teslasync.shared.core.presentation.notificationchannels

import io.teslasync.shared.core.data.repo.NotificationChannelsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.channelsKey
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Verifies the S8 [NotificationChannelsStore] folds the S7 [NotificationChannelsRepository] into a
 * shared, refreshable, webhook-filtered feed and routes each mutation/action to the right
 * repository call with the web-faithful invalidation behaviour (the webhook-test and signature
 * mutations invalidate NOTHING; only the explicit invalidate action refreshes the list) — using a
 * fake repository, so no network or cache is involved.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NotificationChannelsStoreTest {
    /**
     * Fake S7 port: the list read re-counts its collection per refresh (so a refresh is
     * observable) and emits Loading→Success with a deterministic mixed-kind list; every mutation
     * records its argument and succeeds.
     */
    private class FakeNotificationChannelsRepository : NotificationChannelsRepository {
        var collections: Int = 0
        val tested: MutableList<Triple<Long, String?, String?>> = mutableListOf()
        val previewed: MutableList<Pair<String, String>> = mutableListOf()

        override fun channels(): Flow<Resource<List<NotificationChannel>>> =
            flow {
                val n = collections + 1
                collections = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(
                    Resource.Success(
                        data =
                            listOf(
                                NotificationChannel.Discord(id = 1, name = "disc-$n"),
                                NotificationChannel.Webhook(id = 2, name = "wh-a-$n", url = "https://a"),
                                NotificationChannel.Slack(id = 3, name = "slack-$n"),
                                NotificationChannel.Webhook(id = 4, name = "wh-b-$n", url = "https://b"),
                            ),
                        fetchedAt = 1L,
                        stale = false,
                    ),
                )
            }

        override suspend fun testWebhookChannel(
            id: Long,
            title: String?,
            message: String?,
        ): Result<WebhookTestResult> {
            tested += Triple(id, title, message)
            return Result.success(WebhookTestResult(success = true, statusCode = 200, latencyMs = 12))
        }

        override suspend fun previewWebhookSignature(
            secret: String,
            body: String,
        ): Result<WebhookSignaturePreviewResult> {
            previewed += secret to body
            return Result.success(WebhookSignaturePreviewResult(signature = "sha256=deadbeef"))
        }
    }

    @Test
    fun readEmitsCacheThenNetworkFilteredToWebhookKind() =
        runTest {
            val store = NotificationChannelsStore(FakeNotificationChannelsRepository(), backgroundScope)
            val seen = mutableListOf<Resource<List<NotificationChannel.Webhook>>>()
            backgroundScope.launch { store.webhookChannels().collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            // Only the two webhook-kind rows survive the filter, in source order.
            assertEquals(listOf(2L, 4L), last.data.map { it.id })
            assertEquals(listOf("wh-a-1", "wh-b-1"), last.data.map { it.name })
        }

    @Test
    fun webhookFeedIsSharedAcrossObservers() =
        runTest {
            val store = NotificationChannelsStore(FakeNotificationChannelsRepository(), backgroundScope)
            assertSame(store.webhookChannels(), store.webhookChannels())
        }

    @Test
    fun invalidateRefetchesTheObservedList() =
        runTest {
            val repo = FakeNotificationChannelsRepository()
            val store = NotificationChannelsStore(repo, backgroundScope)
            backgroundScope.launch { store.webhookChannels().collect {} }
            runCurrent()
            assertEquals(1, repo.collections)

            store.invalidateWebhookChannels()
            runCurrent()

            // The web `useInvalidateWebhookChannels` re-fetches `notificationKeys.channels`.
            assertEquals(2, repo.collections)
        }

    @Test
    fun invalidateIsNoOpWhenNothingObserved() =
        runTest {
            val repo = FakeNotificationChannelsRepository()
            val store = NotificationChannelsStore(repo, backgroundScope)

            store.invalidateWebhookChannels()
            runCurrent()

            assertEquals(0, repo.collections, "no feed observed ⇒ no needless upstream restart")
        }

    @Test
    fun testWebhookChannelDelegatesAndDoesNotRefresh() =
        runTest {
            val repo = FakeNotificationChannelsRepository()
            val store = NotificationChannelsStore(repo, backgroundScope)
            backgroundScope.launch { store.webhookChannels().collect {} }
            runCurrent()
            assertEquals(1, repo.collections)

            val result = store.testWebhookChannel(2, title = "Hi", message = null)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(200, result.getOrThrow().statusCode)
            assertEquals(listOf(Triple<Long, String?, String?>(2L, "Hi", null)), repo.tested)
            // Web mutation invalidates NOTHING — the list must not re-fetch.
            assertEquals(1, repo.collections)
        }

    @Test
    fun previewSignatureDelegatesAndDoesNotRefresh() =
        runTest {
            val repo = FakeNotificationChannelsRepository()
            val store = NotificationChannelsStore(repo, backgroundScope)
            backgroundScope.launch { store.webhookChannels().collect {} }
            runCurrent()

            val result = store.previewWebhookSignature(secret = "s3cret", body = "{\"a\":1}")
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals("sha256=deadbeef", result.getOrThrow().signature)
            assertEquals(listOf("s3cret" to "{\"a\":1}"), repo.previewed)
            assertEquals(1, repo.collections)
        }

    @Test
    fun channelsKeyMatchesWebQueryKey() {
        // Compile-time + value anchor: the list feed key mirrors `notificationKeys.channels`.
        assertEquals("channels", channelsKey())
    }
}
