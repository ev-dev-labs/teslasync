package io.teslasync.shared.core.presentation.alertmessagehelpers

import io.teslasync.shared.core.data.repo.AlertMessageHelpersRepository
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Verifies the S8 [AlertMessageHelpersStore] folds the S7 [AlertMessageHelpersRepository] into
 * shared, refreshable feeds and routes the preview action straight through — using a fake
 * repository, so no network or cache is involved. Mirrors the web `useAlertMessageHelpers` hooks:
 * two reads keyed by snake_case params, one POST mutation, plus the `enabled` gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AlertMessageHelpersStoreTest {
    /**
     * Fake S7 port: every read re-counts its collections (so a refresh is observable) and emits
     * Loading→Success; the preview records its body and returns a programmable result.
     */
    private class FakeAlertMessageHelpersRepository : AlertMessageHelpersRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()
        val previewedBodies: MutableList<JsonObject> = mutableListOf()
        var previewResult: Result<JsonElement> = Result.success(JsonPrimitive("preview"))

        private fun feed(label: String): Flow<Resource<JsonElement>> =
            flow {
                val n = (collections[label] ?: 0) + 1
                collections[label] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = JsonPrimitive("$label#$n"), fetchedAt = 1L, stale = false))
            }

        override fun messagePresets(kind: String?): Flow<Resource<JsonElement>> = feed("presets:${kind ?: ""}")

        override fun messagePlaceholders( // parity:allow web-hook parity method name (ADR-014), not a stub
            kind: String?,
            signalName: String?,
            op: String?,
            metricId: String?,
        ): Flow<Resource<JsonElement>> = feed("fields:${kind ?: ""}:${signalName ?: ""}:${op ?: ""}:${metricId ?: ""}")

        override suspend fun messagePreview(body: JsonObject): Result<JsonElement> {
            previewedBodies += body
            return previewResult
        }
    }

    @Test
    fun readEmitsCacheThenNetwork() =
        runTest {
            val store = AlertMessageHelpersStore(FakeAlertMessageHelpersRepository(), backgroundScope)
            val seen = mutableListOf<Resource<JsonElement>>()
            backgroundScope.launch { store.messagePresets("signal").collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals("presets:signal#1", last.data.toString().trim('"'))
        }

    @Test
    fun sameFeedIsSharedAcrossCallers() =
        runTest {
            val store = AlertMessageHelpersStore(FakeAlertMessageHelpersRepository(), backgroundScope)
            assertSame(store.messagePresets("signal"), store.messagePresets("signal"))
            assertSame(
                store.fieldCatalog(kind = "signal", signalName = "battery_level"),
                store.fieldCatalog(kind = "signal", signalName = "battery_level"),
            )
        }

    @Test
    fun parameterizedReadsTargetTheirOwnKeys() =
        runTest {
            val repo = FakeAlertMessageHelpersRepository()
            val store = AlertMessageHelpersStore(repo, backgroundScope)
            backgroundScope.launch { store.messagePresets(null).collect {} }
            backgroundScope.launch { store.messagePresets("computed_metric").collect {} }
            backgroundScope.launch { store.fieldCatalog(kind = "signal", signalName = "speed").collect {} }
            backgroundScope.launch { store.fieldCatalog(metricId = "soc-7d").collect {} }
            runCurrent()

            assertEquals(1, repo.collections["presets:"])
            assertEquals(1, repo.collections["presets:computed_metric"])
            assertEquals(1, repo.collections["fields:signal:speed::"])
            assertEquals(1, repo.collections["fields::::soc-7d"])
            // Distinct params are distinct feeds.
            assertTrue(store.messagePresets("signal") !== store.messagePresets("computed_metric"))
        }

    @Test
    fun blankParamsCollapseToTheUniversalKey() =
        runTest {
            val repo = FakeAlertMessageHelpersRepository()
            val store = AlertMessageHelpersStore(repo, backgroundScope)
            // null and "" must address the same feed (web `kind ?? ''` / truthiness).
            assertSame(store.messagePresets(null), store.messagePresets(""))
            assertSame(
                store.fieldCatalog(kind = null, signalName = ""),
                store.fieldCatalog(kind = "", signalName = null),
            )
        }

    @Test
    fun refreshReFetchesTheObservedFeed() =
        runTest {
            val repo = FakeAlertMessageHelpersRepository()
            val store = AlertMessageHelpersStore(repo, backgroundScope)
            backgroundScope.launch { store.messagePresets("signal").collect {} }
            backgroundScope.launch { store.fieldCatalog(kind = "signal", op = "lt").collect {} }
            runCurrent()
            assertEquals(1, repo.collections["presets:signal"])
            assertEquals(1, repo.collections["fields:signal::lt:"])

            store.refreshMessagePresets("signal")
            store.refreshFieldCatalog(kind = "signal", op = "lt")
            runCurrent()

            assertEquals(2, repo.collections["presets:signal"], "refresh re-collects the presets feed")
            assertEquals(2, repo.collections["fields:signal::lt:"], "refresh re-collects the field-catalog feed")
        }

    @Test
    fun refreshIsNoOpForAnUnobservedFeed() =
        runTest {
            val repo = FakeAlertMessageHelpersRepository()
            val store = AlertMessageHelpersStore(repo, backgroundScope)

            store.refreshMessagePresets("signal")
            runCurrent()

            assertEquals(null, repo.collections["presets:signal"])
        }

    @Test
    fun disabledFieldCatalogFeedNeverFetchesAndStaysLoading() =
        runTest {
            val repo = FakeAlertMessageHelpersRepository()
            val store = AlertMessageHelpersStore(repo, backgroundScope)

            val seen = mutableListOf<Resource<JsonElement>>()
            val feed = store.fieldCatalog(kind = "signal", enabled = false)
            backgroundScope.launch { feed.collect { seen += it } }
            runCurrent()

            // enabled:false ⇒ no repository call, and the feed stays at the initial Loading slot.
            assertEquals(null, repo.collections["fields:signal:::"])
            assertTrue(seen.all { it is Resource.Loading })
            // The disabled feed is stable across calls (so the UI binds once).
            assertSame(feed, store.fieldCatalog(kind = "signal", enabled = false))
        }

    @Test
    fun previewDelegatesBodyAndReturnsResult() =
        runTest {
            val repo = FakeAlertMessageHelpersRepository()
            val expected: JsonElement =
                buildJsonObject {
                    put("title", "Low battery")
                    put("body", "SOC 12%")
                }
            repo.previewResult = Result.success(expected)
            val store = AlertMessageHelpersStore(repo, backgroundScope)

            val draft =
                buildJsonObject {
                    put("kind", "signal")
                    put("signal_name", "battery_level")
                }
            val result = store.messagePreview(draft)

            assertEquals(listOf(draft), repo.previewedBodies)
            assertTrue(result.isSuccess)
            assertSame(expected, result.getOrNull())
        }

    @Test
    fun previewPropagatesFailure() =
        runTest {
            val repo = FakeAlertMessageHelpersRepository()
            val boom = IllegalStateException("render failed")
            repo.previewResult = Result.failure(boom)
            val store = AlertMessageHelpersStore(repo, backgroundScope)

            val result = store.messagePreview(JsonObject(emptyMap()))

            assertTrue(result.isFailure)
            assertSame(boom, result.exceptionOrNull())
        }

    // Thin aliases so the autocomplete-catalog API resource name appears in exactly one place.
    private fun AlertMessageHelpersStore.fieldCatalog(
        kind: String? = null,
        signalName: String? = null,
        op: String? = null,
        metricId: String? = null,
        enabled: Boolean = true,
    ): StateFlow<Resource<JsonElement>> =
        messagePlaceholders(kind, signalName, op, metricId, enabled) // parity:allow API method name (ADR-014), not a stub

    private fun AlertMessageHelpersStore.refreshFieldCatalog(
        kind: String? = null,
        signalName: String? = null,
        op: String? = null,
        metricId: String? = null,
    ): Unit = refreshMessagePlaceholders(kind, signalName, op, metricId) // parity:allow API method name (ADR-014), not a stub
}
