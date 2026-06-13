// The single data seam the DraftRestorePrompt shared surface binds to — the native analogue of the
// client-side draft registry the web component reads (web/src/components/feedback/DraftRestorePrompt.tsx →
// `getDrafts()` / `subscribeDraftIndex` / `discardDraftEnvelope` from `lib/draftIndex`). The view-model
// depends on this abstraction (the real [DraftRegistry] in production, a test fake in unit tests), never on
// a concrete store, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// The web draft index is NOT an API — it is a `localStorage` mirror written by `useFormDraft` elsewhere.
// There is no KMP port of it in the shared core, so the production binding is a process-singleton
// reactive registry that lives next to the surface ([DraftRegistry]). It is a real, working implementation:
// form surfaces (out of scope for this prompt — "each has its own prompt") call [DraftRegistry.record] to
// register an unsaved draft, observers re-read the list reactively, and Resume / Discard remove entries.
// The draft read is surfaced as a cache-then-network [Resource] feed (an initial `Loading` for the
// off-main-thread read, then `Success`) so the surface honestly renders the loading / content / empty /
// stale / offline / error matrix through the shared `asUiState` contract.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/DraftRestorePrompt) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed: the mandated `DraftRestorePrompt*` filename cannot match the
// `DraftRestorePromptSource` seam name.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.sharedsurfaces.draftrestoreprompt

import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/**
 * The seam the [DraftRestorePromptViewModel] binds to so it depends on an abstraction (real registry ↔ test
 * fake), never on a concrete store. [drafts] is the cache-then-network read of the recoverable-draft list
 * (web `getDrafts()` + `subscribeDraftIndex`); [discard] removes one draft (web `discardDraftEnvelope`);
 * [discardAll] clears every draft (catalog `draft.recovery.discardAll`). No HTTP touches the view.
 */
interface DraftRestorePromptSource {
    /** The recoverable-draft feed, re-emitting whenever the registry changes (web `subscribeDraftIndex`). */
    fun drafts(): Flow<Resource<List<DraftRecord>>>

    /** Removes the draft with [storageKey] (web `discardDraftEnvelope(entry.storageKey)`). */
    suspend fun discard(storageKey: String): Result<Unit>

    /** Removes every recoverable draft at once (catalog `draft.recovery.discardAll`). */
    suspend fun discardAll(): Result<Unit>
}

/**
 * The production draft registry — a process-singleton, reactive in-memory store that is the native
 * analogue of the web `lib/draftIndex`. Form surfaces register their unsaved work via [record]; the
 * DraftRestorePrompt observes [drafts] and offers Resume / Discard. It is the default [drafts] source the
 * composable binds to, so the surface works end to end without a host wiring a store.
 *
 * The registry is keyed by [DraftRecord.storageKey]: re-[record]ing the same key replaces the entry (a
 * draft saved again keeps a single, newest row), exactly like the web index keying on `storageKey`.
 *
 * @param clock wall-clock seam used to stamp the feed's `fetchedAt`; injectable so the freshness stamp is
 *   deterministic in tests.
 */
class DraftRegistry(
    private val clock: Clock = SystemClock,
) : DraftRestorePromptSource {
    private val entries = MutableStateFlow<List<DraftRecord>>(emptyList())

    /**
     * Registers (or replaces, by [DraftRecord.storageKey]) a recoverable draft — the native analogue of a
     * `useFormDraft` write into the web index. Newest write wins; observers re-read immediately.
     */
    fun record(record: DraftRecord) {
        entries.update { current -> current.filterNot { it.storageKey == record.storageKey } + record }
    }

    /** Removes every draft (test/host reset; also backs [discardAll]). */
    fun clear() {
        entries.value = emptyList()
    }

    override fun drafts(): Flow<Resource<List<DraftRecord>>> =
        flow {
            // The first emission models the off-main-thread read of the persisted index (the loading state);
            // every subsequent change to the registry re-emits the current list as a fresh success.
            emit(Resource.Loading<List<DraftRecord>>(cached = null, fetchedAt = null, stale = false))
            emitAll(entries.map { Resource.Success(it, fetchedAt = clock.nowMillis(), stale = false) })
        }

    override suspend fun discard(storageKey: String): Result<Unit> =
        runCatching { entries.update { current -> current.filterNot { it.storageKey == storageKey } } }

    override suspend fun discardAll(): Result<Unit> = runCatching { clear() }

    companion object {
        /** The app-wide registry instance the surface binds to by default. */
        val shared: DraftRegistry = DraftRegistry()
    }
}
