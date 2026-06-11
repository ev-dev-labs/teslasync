package io.teslasync.android.support

import android.content.Context
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.LiveStaleDataBanner
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray

/**
 * One generated A7 page parity unit, loaded from the androidTest asset extracted verbatim from
 * `apps/parity/parity-manifest.json` (kind = `page`). [states] is the subset of the web canonical
 * data states (`loading`/`empty`/`success`/`error`) that page's manifest record declares.
 */
data class LedgerPage(
    val id: String,
    val title: String,
    val states: List<String>,
)

/**
 * Loads the generated A7 page ledger packaged as an androidTest asset. The asset is the page slice
 * of the canonical parity manifest, so [PageStateContractTest] is data-driven over the real ledger
 * ids rather than a hand-picked sample — covering "all generated page state contracts" honestly.
 */
object ParityPageLedger {
    const val ASSET_PATH: String = "parity/android-page-ledger.json"

    fun load(context: Context): List<LedgerPage> {
        val text =
            context.assets
                .open(ASSET_PATH)
                .bufferedReader()
                .use { it.readText() }
        val array = JSONArray(text)
        return buildList {
            for (i in 0 until array.length()) {
                val unit = array.getJSONObject(i)
                val rawStates = unit.getJSONArray("states")
                val states = buildList { for (j in 0 until rawStates.length()) add(rawStates.getString(j)) }
                add(LedgerPage(id = unit.getString("id"), title = unit.optString("title"), states = states))
            }
        }
    }
}

/** Test tags the [PageStateContractHost] stamps so each rendered surface is asserted unambiguously. */
object PageStateTags {
    const val HOST = "page-state-host"
    const val LOADING = "page-state-loading"
    const val EMPTY = "page-state-empty"
    const val ERROR = "page-state-error"
    const val CONTENT = "page-state-content"
    const val STALE = "page-state-stale-banner"
}

/**
 * A fake shared state holder standing in for an A7 page's primary cache-then-network feed. The test
 * drives it through the shared-core [Resource] shapes; the host projects each via the real
 * [toUiState] mapper, so the contract under test is the production projection, not a stand-in.
 */
class FakePageFeed(
    initial: Resource<List<String>> = Resource.Loading(cached = null, fetchedAt = null, stale = false),
) {
    private val mutable = MutableStateFlow(initial)
    val flow: StateFlow<Resource<List<String>>> = mutable.asStateFlow()

    fun set(resource: Resource<List<String>>) {
        mutable.value = resource
    }
}

/**
 * The canonical page-state surface every A7 page renders, wired to a [FakePageFeed]. It switches on
 * the projected [io.teslasync.android.data.UiState] exactly as a real page must — a spinner while
 * loading, the shared empty/error surfaces, content when present, and an offline/"last known" banner
 * over still-visible cached data when stale. Each branch is wrapped in a tagged node (the shared
 * surfaces clear/merge their own semantics) so assertions never depend on localized copy.
 */
@Composable
fun PageStateContractHost(feed: FakePageFeed) {
    val resource by feed.flow.collectAsState()
    val state = remember(resource) { resource.toUiState() }
    Column(modifier = Modifier.testTag(PageStateTags.HOST)) {
        if (state.isOffline) {
            Column(modifier = Modifier.testTag(PageStateTags.STALE)) {
                LiveStaleDataBanner(onReconnect = {})
            }
        }
        when (state.phase) {
            UiPhase.Loading ->
                Column(modifier = Modifier.testTag(PageStateTags.LOADING)) {
                    Spinner(label = "Loading")
                }
            UiPhase.Empty ->
                Column(modifier = Modifier.testTag(PageStateTags.EMPTY)) {
                    EmptyState(message = "Nothing here yet", title = "Empty")
                }
            UiPhase.Error ->
                Column(modifier = Modifier.testTag(PageStateTags.ERROR)) {
                    ErrorDisplay(message = "Could not load", onRetry = {})
                }
            UiPhase.Content ->
                Column(modifier = Modifier.testTag(PageStateTags.CONTENT)) {
                    state.data?.forEach { BodyText(it) }
                }
        }
    }
}

/** Maps a web-canonical state name to the [Resource] shape that projects onto it via [toUiState]. */
fun resourceForState(state: String): Resource<List<String>> =
    when (state) {
        "loading" -> Resource.Loading(cached = null, fetchedAt = null, stale = false)
        "empty" -> Resource.Success(data = emptyList(), fetchedAt = 1L, stale = false)
        "success" -> Resource.Success(data = listOf("row-1", "row-2"), fetchedAt = 1L, stale = false)
        "error" -> Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())
        else -> error("Unsupported ledger state: $state")
    }

/** The universal cached/stale ("offline / last known") contract every page must render honestly. */
fun staleResource(): Resource<List<String>> =
    Resource.Error(cached = listOf("last-known-row"), fetchedAt = 1L, stale = true, error = ApiError.Network())

/** The test tag a given canonical state must resolve to in [PageStateContractHost]. */
fun expectedTagForState(state: String): String =
    when (state) {
        "loading" -> PageStateTags.LOADING
        "empty" -> PageStateTags.EMPTY
        "success" -> PageStateTags.CONTENT
        "error" -> PageStateTags.ERROR
        else -> error("Unsupported ledger state: $state")
    }
