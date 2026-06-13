package io.teslasync.android.sharedsurfaces.taginput

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device unit coverage of [TagInputProjection] — the pure parsing + reduction + projection the composable
 * renders. Exercises the web `normaliseTag` (trim + lowercase), `buildSplitRegex` (separator + CR/LF split),
 * `tryAddOne` (empty / full / validator / duplicate / added order), `commitText` / `commitAll` (mid-typing
 * vs Enter, the duplicate / max announcements), the empty-vs-content phase driven by the WORKING list, and
 * the cache-then-network → projection envelope (loading / content-from-cache / stale / offline / hard error)
 * plus the classified error-kind mapping. Runs in the `:android:testReleaseUnitTest` gate.
 */
class TagInputProjectionTest {
    // ── normaliseTag port ─────────────────────────────────────────────────────────────────────────────

    @Test
    fun normaliseTrimsAndOptionallyLowercases() {
        assertEquals("Foo", TagInputProjection.normalise("  Foo  ", lowercase = false))
        assertEquals("foo", TagInputProjection.normalise("  Foo  ", lowercase = true))
        assertEquals("", TagInputProjection.normalise("   ", lowercase = false))
    }

    // ── buildSplitRegex port ──────────────────────────────────────────────────────────────────────────

    @Test
    fun splitPartsSplitsOnSeparatorsAndCollapsesRuns() {
        assertEquals(listOf("a", "b"), TagInputProjection.splitParts("a,b", setOf(',')))
        assertEquals(listOf("a", "b"), TagInputProjection.splitParts("a,,b", setOf(',')))
        assertEquals(listOf("a", "b"), TagInputProjection.splitParts("a;b", setOf(',', ';')))
    }

    @Test
    fun splitPartsAlwaysSplitsOnNewlines() {
        assertEquals(listOf("a", "b", "c"), TagInputProjection.splitParts("a\nb\r\nc", setOf(',')))
    }

    @Test
    fun splitPartsKeepsTrailingEmptyFragment() {
        assertEquals(listOf("a", ""), TagInputProjection.splitParts("a,", setOf(',')))
    }

    // ── tryAddOne port: empty / full / validator / duplicate / added ───────────────────────────────────

    @Test
    fun tryAddOneAcceptsANewTag() {
        val result = TagInputProjection.tryAddOne("foo", emptyList(), TagInputConfig(), validate = null)
        assertEquals(TagAddStatus.Added, result.status)
        assertEquals(listOf("foo"), result.next)
    }

    @Test
    fun tryAddOneRejectsEmpty() {
        val result = TagInputProjection.tryAddOne("   ", emptyList(), TagInputConfig(), validate = null)
        assertEquals(TagAddStatus.Empty, result.status)
        assertEquals(emptyList<String>(), result.next)
    }

    @Test
    fun tryAddOneRejectsCaseInsensitiveDuplicate() {
        val result = TagInputProjection.tryAddOne("FOO", listOf("foo"), TagInputConfig(), validate = null)
        assertEquals(TagAddStatus.Duplicate, result.status)
        assertEquals(listOf("foo"), result.next)
    }

    @Test
    fun tryAddOneRejectsInvalidViaValidator() {
        val result = TagInputProjection.tryAddOne("a", emptyList(), TagInputConfig(), validate = ::shortRejector)
        assertEquals(TagAddStatus.Invalid, result.status)
        assertEquals(SHORT_MESSAGE, result.error)
    }

    @Test
    fun tryAddOneRejectsWhenFull() {
        val result = TagInputProjection.tryAddOne("y", listOf("x"), TagInputConfig(maxTags = 1), validate = null)
        assertEquals(TagAddStatus.Full, result.status)
    }

    @Test
    fun tryAddOneLowercasesWhenConfigured() {
        val result = TagInputProjection.tryAddOne("FOO", emptyList(), TagInputConfig(lowercase = true), validate = null)
        assertEquals(TagAddStatus.Added, result.status)
        assertEquals(listOf("foo"), result.next)
    }

    // ── commitText / commitAll port ────────────────────────────────────────────────────────────────────

    @Test
    fun commitTextWhileTypingPreservesTrailingFragment() {
        val outcome = TagInputProjection.commitText("foo, bar", emptyList(), TagInputConfig(), null, consumeLast = false)
        assertEquals(listOf("foo"), outcome.tags)
        assertEquals(1, outcome.committed)
        assertEquals(" bar", outcome.remainder)
        assertEquals(TagAnnouncement.AddedOne, outcome.announcement)
    }

    @Test
    fun commitAllConsumesEveryFragment() {
        val outcome = TagInputProjection.commitText("a,b,c", emptyList(), TagInputConfig(), null, consumeLast = true)
        assertEquals(listOf("a", "b", "c"), outcome.tags)
        assertEquals(3, outcome.committed)
        assertEquals("", outcome.remainder)
        assertEquals(TagAnnouncement.AddedMany(3), outcome.announcement)
    }

    @Test
    fun commitAnnouncesDuplicateWhenNothingAdded() {
        val outcome = TagInputProjection.commitText("dup", listOf("dup"), TagInputConfig(), null, consumeLast = true)
        assertEquals(0, outcome.committed)
        assertEquals(listOf("dup"), outcome.tags)
        assertEquals(TagAnnouncement.Duplicate("dup"), outcome.announcement)
    }

    @Test
    fun commitSurfacesValidatorErrorAndSuppressesAnnouncement() {
        val outcome = TagInputProjection.commitText("a", emptyList(), TagInputConfig(), ::shortRejector, consumeLast = true)
        assertEquals(0, outcome.committed)
        assertEquals(SHORT_MESSAGE, outcome.error)
        assertNull(outcome.announcement)
    }

    @Test
    fun commitAnnouncesMaxReachedWhenFull() {
        val outcome = TagInputProjection.commitText("y", listOf("x"), TagInputConfig(maxTags = 1), null, consumeLast = true)
        assertEquals(0, outcome.committed)
        assertEquals(TagAnnouncement.MaxReached, outcome.announcement)
    }

    // ── phase resolution: WORKING list drives empty vs content ─────────────────────────────────────────

    @Test
    fun phaseFollowsSeedLifecycleThenWorkingList() {
        assertEquals(TagInputPhase.Loading, TagInputProjection.phase(loadingNoCache(), listOf("x")))
        assertEquals(TagInputPhase.Error, TagInputProjection.phase(hardError(), listOf("x")))
        assertEquals(TagInputPhase.Empty, TagInputProjection.phase(success(emptyList()), emptyList()))
        assertEquals(TagInputPhase.Content, TagInputProjection.phase(success(emptyList()), listOf("x")))
    }

    // ── fold: freshness envelope ───────────────────────────────────────────────────────────────────────

    @Test
    fun foldContentCarriesTagsAndFreshnessStamp() {
        val state = TagInputProjection.fold(success(listOf("a"), fetchedAt = 7L), TagEditing(tags = listOf("a")), TagInputConfig())
        assertEquals(TagInputPhase.Content, state.phase)
        assertEquals(listOf("a"), state.tags)
        assertEquals(7L, state.freshnessStamp)
        assertFalse(state.showFreshnessChip)
    }

    @Test
    fun foldCachedErrorIsOffline() {
        val seed =
            Resource
                .Error<List<String>>(cached = listOf("a"), fetchedAt = 5L, stale = true, error = RuntimeException("net"))
                .toUiState { it.isEmpty() }
        val state = TagInputProjection.fold(seed, TagEditing(tags = listOf("a")), TagInputConfig())
        assertEquals(TagInputPhase.Content, state.phase)
        assertTrue(state.offline)
        assertFalse(state.stale)
        assertTrue(state.showFreshnessChip)
    }

    @Test
    fun foldStaleRefreshKeepsCachedValue() {
        val seed = Resource.Loading<List<String>>(cached = listOf("a"), fetchedAt = 9L, stale = true).toUiState { it.isEmpty() }
        val state = TagInputProjection.fold(seed, TagEditing(tags = listOf("a")), TagInputConfig())
        assertEquals(TagInputPhase.Content, state.phase)
        assertTrue(state.stale)
        assertFalse(state.offline)
        assertTrue(state.refreshing)
    }

    // ── classified error-kind mapping ──────────────────────────────────────────────────────────────────

    @Test
    fun queryErrorKindMapsTheTaxonomy() {
        assertEquals(QueryErrorKind.Waiting, kindFor(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.Offline, kindFor(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Offline, kindFor(ErrorKind.Timeout, null))
        assertEquals(QueryErrorKind.NotFound, kindFor(ErrorKind.Http, 404))
        assertEquals(QueryErrorKind.Unauthorized, kindFor(ErrorKind.Http, 401))
        assertEquals(QueryErrorKind.ServerError, kindFor(ErrorKind.Http, 503))
        assertEquals(QueryErrorKind.Network, kindFor(ErrorKind.Unknown, null))
    }

    private fun kindFor(
        errorKind: ErrorKind,
        httpStatus: Int?,
    ): QueryErrorKind =
        TagInputProjection.queryErrorKind(
            TagInputState(phase = TagInputPhase.Error, errorKind = errorKind, httpStatus = httpStatus),
        )

    private companion object {
        const val SHORT_MESSAGE = "Tags must be at least 2 characters"

        fun shortRejector(tag: String): String? = if (tag.length < 2) SHORT_MESSAGE else null

        fun success(
            tags: List<String>,
            fetchedAt: Long = 1L,
        ): UiState<List<String>> = Resource.Success(tags, fetchedAt = fetchedAt, stale = false).toUiState { it.isEmpty() }

        fun loadingNoCache(): UiState<List<String>> =
            Resource.Loading<List<String>>(cached = null, fetchedAt = null, stale = false).toUiState { it.isEmpty() }

        fun hardError(): UiState<List<String>> =
            Resource
                .Error<List<String>>(cached = null, fetchedAt = null, stale = false, error = RuntimeException("down"))
                .toUiState { it.isEmpty() }
    }
}
