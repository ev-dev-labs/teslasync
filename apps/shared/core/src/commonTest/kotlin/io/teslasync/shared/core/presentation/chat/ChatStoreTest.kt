package io.teslasync.shared.core.presentation.chat

import io.teslasync.shared.core.data.repo.CHAT_SESSIONS_KEY
import io.teslasync.shared.core.data.repo.ChatRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.chatHistoryKey
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
 * Verifies the S8 [ChatStore] folds the S7 [ChatRepository] into shared, refreshable feeds,
 * reproduces the web `enabled: !!sessionId` history gate, and routes each mutation to the right
 * repository call + a sessions refresh — using a fake repository, so no network or cache is
 * involved.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChatStoreTest {
    /**
     * Fake S7 port: every read re-counts its collections per key (so a refresh is observable) and
     * emits Loading→Success with a single deterministic row; every mutation records its argument
     * and succeeds.
     */
    private class FakeChatRepository : ChatRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()
        val renamed: MutableList<Pair<String, String>> = mutableListOf()
        val deleted: MutableList<String> = mutableListOf()
        val sent: MutableList<SendChatMessageInput> = mutableListOf()

        override fun chatSessions(): Flow<Resource<List<ChatSessionInfo>>> =
            flow {
                val n = (collections[CHAT_SESSIONS_KEY] ?: 0) + 1
                collections[CHAT_SESSIONS_KEY] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = listOf(session("s$n")), fetchedAt = 1L, stale = false))
            }

        override fun chatHistory(sessionId: String): Flow<Resource<List<ChatMessage>>> =
            flow {
                val key = chatHistoryKey(sessionId)
                val n = (collections[key] ?: 0) + 1
                collections[key] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = listOf(message(n.toLong(), sessionId)), fetchedAt = 1L, stale = false))
            }

        override suspend fun renameChatSession(
            sessionId: String,
            title: String,
        ): Result<RenameSessionResult> {
            renamed += sessionId to title
            return Result.success(RenameSessionResult(sessionId, title.trim()))
        }

        override suspend fun deleteChatSession(sessionId: String): Result<Unit> {
            deleted += sessionId
            return Result.success(Unit)
        }

        override suspend fun sendChatMessage(input: SendChatMessageInput): Result<ChatResponse> {
            sent += input
            return Result.success(ChatResponse(response = "ok", sessionId = input.sessionId ?: "new"))
        }

        companion object {
            fun session(id: String): ChatSessionInfo = ChatSessionInfo(id = id, messageCount = 1)

            fun message(
                id: Long,
                sessionId: String,
            ): ChatMessage =
                ChatMessage(
                    id = id,
                    sessionId = sessionId,
                    role = "assistant",
                    content = "m$id",
                    createdAt = "2026-01-01T00:00:00Z",
                )
        }
    }

    @Test
    fun sessionsReadEmitsCacheThenNetwork() =
        runTest {
            val store = ChatStore(FakeChatRepository(), backgroundScope)
            val seen = mutableListOf<Resource<List<ChatSessionInfo>>>()
            backgroundScope.launch { store.chatSessions().collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals("s1", last.data.first().id)
        }

    @Test
    fun sessionsFeedIsASharedSingleton() =
        runTest {
            val store = ChatStore(FakeChatRepository(), backgroundScope)
            assertSame(store.chatSessions(), store.chatSessions())
        }

    @Test
    fun historyFetchesForANonBlankSessionAndSharesPerSession() =
        runTest {
            val repo = FakeChatRepository()
            val store = ChatStore(repo, backgroundScope)
            val seen = mutableListOf<Resource<List<ChatMessage>>>()
            backgroundScope.launch { store.chatHistory("abc").collect { seen += it } }
            runCurrent()

            assertEquals(1, repo.collections[chatHistoryKey("abc")])
            assertSame(store.chatHistory("abc"), store.chatHistory("abc"))
            assertTrue(store.chatHistory("abc") !== store.chatHistory("def"))
            assertEquals("abc", (seen.last() as Resource.Success).data.first().sessionId)
        }

    @Test
    fun historyIsDisabledForABlankSessionAndNeverFetches() =
        runTest {
            val repo = FakeChatRepository()
            val store = ChatStore(repo, backgroundScope)
            val feed = store.chatHistory("")
            backgroundScope.launch { feed.collect {} }
            runCurrent()

            // enabled: !!sessionId — a blank id collapses to the one disabled feed and never fetches.
            assertSame(feed, store.chatHistory(""))
            assertTrue(feed.value is Resource.Loading)
            assertTrue(repo.collections.isEmpty(), "blank session id ⇒ no upstream collection")
        }

    @Test
    fun renameDelegatesAndRefreshesSessions() =
        runTest {
            val repo = FakeChatRepository()
            val store = ChatStore(repo, backgroundScope)
            backgroundScope.launch { store.chatSessions().collect {} }
            runCurrent()
            assertEquals(1, repo.collections[CHAT_SESSIONS_KEY])

            val result = store.renameChatSession("s1", "  New title  ")
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf("s1" to "  New title  "), repo.renamed)
            // invalidate chatKeys.sessions(): the sessions feed re-fetches.
            assertEquals(2, repo.collections[CHAT_SESSIONS_KEY])
        }

    @Test
    fun deleteDelegatesAndRefreshesSessions() =
        runTest {
            val repo = FakeChatRepository()
            val store = ChatStore(repo, backgroundScope)
            backgroundScope.launch { store.chatSessions().collect {} }
            runCurrent()
            assertEquals(1, repo.collections[CHAT_SESSIONS_KEY])

            val result = store.deleteChatSession("s1")
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf("s1"), repo.deleted)
            assertEquals(2, repo.collections[CHAT_SESSIONS_KEY])
        }

    @Test
    fun sendChatMessageDelegatesWithoutTouchingTheSessionsFeed() =
        runTest {
            val repo = FakeChatRepository()
            val store = ChatStore(repo, backgroundScope)
            backgroundScope.launch { store.chatSessions().collect {} }
            runCurrent()
            assertEquals(1, repo.collections[CHAT_SESSIONS_KEY])

            val result = store.sendChatMessage(SendChatMessageInput(message = "hi", sessionId = "s1"))
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(SendChatMessageInput("hi", "s1")), repo.sent)
            // No cache interaction: the sessions feed is NOT refreshed by a send.
            assertEquals(1, repo.collections[CHAT_SESSIONS_KEY])
        }

    @Test
    fun refreshIsANoOpWhenNothingIsObserved() =
        runTest {
            val repo = FakeChatRepository()
            val store = ChatStore(repo, backgroundScope)

            store.refreshSessions()
            store.refreshHistory("abc")
            runCurrent()

            assertTrue(repo.collections.isEmpty(), "no feed observed ⇒ no needless upstream restart")
        }
}
