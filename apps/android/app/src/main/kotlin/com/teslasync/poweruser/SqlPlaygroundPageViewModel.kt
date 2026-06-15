// UI-thread-free state holder backing the SqlPlaygroundPage power-user surface — the native port of the web page's
// `useState(sql)` + `useState(runMessage)` + `handleRun`/`handleClear` composition
// (web/src/features/power-user/pages/SqlPlaygroundPage.tsx). It owns the in-memory query string + the latest Run
// reduction as an immutable [SqlPlaygroundUiState], exposes the prompt-edit + run + clear actions plus the PII-safe
// `view.opened` diagnostic, and performs NO HTTP (the web page has no browser SQL-execution endpoint; Run only
// surfaces a deterministic help message). The screen never mutates state directly — it only collects [state] and
// calls [onSqlChange] / [onRun] / [onClear] / [recordViewOpened].
//
// The query string lives here (not in remembered composable state) so it survives recomposition + configuration
// changes — the native analogue of the web localStorage `ai.sqlPlayground.draft` persistence, hoisted into the
// lifecycle-scoped holder per ADR-002.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/poweruser) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.poweruser.sqlplayground

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * @param logger the single sanctioned redacting logger (ADR-016); receives the `view.opened` event carrying only
 *   the non-PII surface slug (never the query text).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class SqlPlaygroundPageViewModel(
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(SqlPlaygroundUiState())
    private var viewOpenedRecorded = false

    /**
     * The live success surface: the in-memory query string (web `sql`), the latest Run reduction (web
     * `runMessage`), and the by-name-sorted curated catalog (web `sortedTables`). The render boundary draws every
     * field; there is no remote feed, so no loading / empty / error projection is required.
     */
    val state: StateFlow<SqlPlaygroundUiState> = mutableState.asStateFlow()

    /**
     * Updates the in-memory query string (web `setSql`). Leaves the prior Run message intact, matching the web
     * page (typing does not clear `runMessage` — only Clear / a fresh Run / an AI-draft apply does).
     */
    fun onSqlChange(value: String) {
        if (mutableState.value.sql == value) return
        mutableState.update { it.copy(sql = value) }
    }

    /**
     * Reduces a Run press (web `handleRun`): a blank query surfaces the runEmpty help, a non-blank query surfaces
     * the runUnavailable help. No query is ever executed — there is no browser SQL-execution endpoint.
     */
    fun onRun() {
        mutableState.update { it.copy(runOutcome = runOutcomeFor(it.sql)) }
    }

    /** Clears the editor and the Run message (web `handleClear`: `setSql('')` + `setRunMessage('')`). */
    fun onClear() {
        if (mutableState.value.sql.isEmpty() && mutableState.value.runOutcome == RunOutcome.None) return
        mutableState.update { it.copy(sql = "", runOutcome = RunOutcome.None) }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no query text, so a diagnostics line can never leak the operator's SQL. Call from the composable's
     * first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordSqlPlaygroundPageOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] the host uses to construct this surface's ViewModel. */
        fun factory(logger: Logger): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { SqlPlaygroundPageViewModel(logger) }
            }
    }
}
