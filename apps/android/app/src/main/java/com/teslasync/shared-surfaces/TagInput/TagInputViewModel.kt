// UI-thread-free state holder backing the TagInput surface — the native port of the state the web component
// owns (web/src/components/forms/TagInput.tsx: the `pending` + `error` `useState`, the working `value` list,
// the `tryAddOne` / `commitText` / `commitAll` reducers, the `removeAt` / Backspace handlers, and the
// `useAnnouncer` polite announcements). It binds the seed list through the shared [TagListSource] (no HTTP
// touches the view, ADR-002), runs the commit/remove reducers via the pure [TagInputProjection], and emits
// the one PII-safe `view.opened` diagnostic (P1/S11). The view never performs HTTP — it only collects [state]
// and forwards the field's actions.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/TagInput) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.taginput

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * State holder for the free-text tag field.
 *
 * The seed list is folded from the shared [TagListSource] through the data layer's `Resource → UiState`
 * contract, so the surface renders the real loading / empty / error / stale / offline lifecycle. On top of it
 * the holder owns the local editing state — [setPending] mirrors the web `handleInputChange` (mid-string
 * separator → commit-up-to-last-separator), [commitPending] the Enter/blur `commitAll`, [onPasted] the paste
 * handler, [removeAt] / [removeLast] the chip remove + Backspace-on-empty — each running the pure
 * [TagInputProjection] reducers and notifying the host through [onTagsChange] (web `onChange`). The seed is
 * adopted once on first resolution (and re-adopted on [retry], where the error surface hid the field so no
 * edit is lost); a stale [refresh] re-fetches the freshness envelope WITHOUT clobbering local edits.
 * [onViewOpened] emits the single PII-safe `view.opened` diagnostic.
 *
 * @param source the seed-list seam (a static source in the controlled case, a host feed, or a fake in tests).
 * @param config the parsing knobs (separators / lowercase / maxTags / disabled).
 * @param validate the optional per-tag validator (web `validateTag`); returns a message to reject, else null.
 * @param onTagsChange notified with the next list whenever a tag is added or removed (web `onChange`).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + the slug-only events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TagInputViewModel(
    private val source: TagListSource,
    private val config: TagInputConfig = TagInputConfig(),
    private val validate: ((String) -> String?)? = null,
    private val onTagsChange: (List<String>) -> Unit = {},
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val commitChars: Set<Char> = config.separators + setOf('\r', '\n')

    private val seedUi: StateFlow<UiState<List<String>>> =
        refreshTrigger.flatMapLatest { source.tags() }.asUiState { it.isEmpty() }

    private val editingState = MutableStateFlow(TagEditing())
    private val mutableState = MutableStateFlow(TagInputState.loading(config))

    /** The live, render-ready field state the view collects; `.value` is always the latest folded snapshot. */
    val state: StateFlow<TagInputState> = mutableState.asStateFlow()

    private var seeded = false
    private var viewOpenedRecorded = false

    init {
        stateScope.launch {
            combine(seedUi, editingState) { seed, editing ->
                TagInputProjection.fold(seed, editing, config)
            }.collect { mutableState.value = it }
        }
        stateScope.launch {
            seedUi.collect { adoptSeed(it) }
        }
    }

    // ── Editing actions (web component handlers) ───────────────────────────────

    /**
     * Web `handleInputChange`: if the new [text] contains a separator (or CR/LF), commit everything up to and
     * including the LAST separator and keep the trailing remainder as the new pending text; otherwise just
     * store the pending text and clear any stale validator error as the user keeps typing.
     */
    fun setPending(text: String) {
        when {
            text.any { it in commitChars } -> {
                val outcome = TagInputProjection.commitText(text, editingState.value.tags, config, validate, consumeLast = false)
                applyOutcome(outcome)
                editingState.update { it.copy(pending = outcome.remainder) }
            }
            else -> editingState.update { it.copy(pending = text, error = null) }
        }
    }

    /** Web `commitAll(pending)` (Enter / blur / IME Done): force-commit the pending text as one or more tags. */
    fun commitPending() {
        val pending = editingState.value.pending
        if (pending.isBlank()) {
            editingState.update { it.copy(pending = "", error = null) }
            return
        }
        val outcome = TagInputProjection.commitText(pending, editingState.value.tags, config, validate, consumeLast = true)
        applyOutcome(outcome)
        editingState.update { it.copy(pending = outcome.remainder) }
    }

    /** Web `handlePaste`: prepend the pending text and force-commit the whole clipboard payload as tags. */
    fun onPasted(text: String) {
        if (text.isEmpty()) return
        val combined = editingState.value.pending + text
        val outcome = TagInputProjection.commitText(combined, editingState.value.tags, config, validate, consumeLast = true)
        applyOutcome(outcome)
        editingState.update { it.copy(pending = outcome.remainder) }
    }

    /** Web `removeAt(idx)`: drop the chip at [index], clear any error, and announce the removal. */
    fun removeAt(index: Int) {
        if (config.disabled) return
        val current = editingState.value.tags
        if (index !in current.indices) return
        val removed = current[index]
        val next = current.toMutableList().apply { removeAt(index) }
        editingState.update { it.copy(tags = next, error = null, announcement = TagAnnouncement.Removed(removed)) }
        onTagsChange(next)
        TagInputDiagnostics.recordRemoved(logger)
    }

    /** Web Backspace-on-empty-input: remove the trailing chip. */
    fun removeLast() {
        val current = editingState.value.tags
        if (current.isNotEmpty()) removeAt(current.lastIndex)
    }

    // ── Lifecycle / freshness ──────────────────────────────────────────────────

    /** Re-fetches the seed after a hard error (web `refetch`); resets adoption so the fresh list is taken. */
    fun retry() {
        TagInputDiagnostics.recordRefresh(logger)
        seeded = false
        refreshTrigger.update { it + 1 }
    }

    /** Re-fetches the seed for its freshness envelope (stale auto-refresh) WITHOUT clobbering local edits. */
    fun refresh() {
        refreshTrigger.update { it + 1 }
    }

    /** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        TagInputDiagnostics.recordViewOpened(logger)
    }

    // ── Internals ──────────────────────────────────────────────────────────────

    private fun applyOutcome(outcome: TagCommitOutcome) {
        val changed = outcome.committed > 0
        editingState.update { current ->
            current.copy(
                tags = outcome.tags,
                error = outcome.error,
                announcement = outcome.announcement ?: current.announcement,
            )
        }
        if (changed) {
            onTagsChange(outcome.tags)
            TagInputDiagnostics.recordAdded(logger)
        }
    }

    private fun adoptSeed(seed: UiState<List<String>>) {
        val data = seed.data
        if (seeded || data == null) return
        seeded = true
        editingState.value = TagEditing(tags = data)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: TagListSource,
            config: TagInputConfig,
            validate: ((String) -> String?)?,
            onTagsChange: (List<String>) -> Unit,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { TagInputViewModel(source, config, validate, onTagsChange, logger) }
            }
    }
}
