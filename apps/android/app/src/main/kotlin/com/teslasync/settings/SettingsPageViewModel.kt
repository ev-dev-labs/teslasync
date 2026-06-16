// The state holder backing the SettingsPage surface (P1/S8) — the native counterpart of the web page's
// single data hook (web/src/features/settings/pages/SettingsPage.tsx: `const { isLoading } = useSettings()`).
// It projects the shared settings-document feed onto the lifecycle-aware [UiState] surface via
// [BaseFeedViewModel.asUiState], so the composable receives the page-level loading → success state the web
// `PageContainer loading={isLoading}` overlay drives. The document itself is never treated as structurally
// empty (a settings blob always decodes), so the phase only ever flips between Loading and Content — exactly
// the two states the parity manifest declares for this page. This holder performs no HTTP; it only collects
// the injected [SettingsPageSource].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/settings)
// diverges from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.settings.page

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/**
 * @param source the P1/S8 data seam (the shared Settings holder in production ↔ a test fake); the view
 *   never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives the `view.opened` event.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class SettingsPageViewModel(
    source: SettingsPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /**
     * The settings-document feed as a lifecycle-aware [UiState]: Loading on a cold start with nothing
     * cached (the `PageContainer` spinner), then Content once the document is replayed from cache or
     * fetched (the rendered page). `isEmpty = { false }` keeps the document out of the Empty phase — a
     * settings blob is never structurally empty — so the surface is the declared loading → success pair.
     */
    val state: StateFlow<UiState<JsonElement>> =
        source.settings().asUiState(isEmpty = { false })

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordSettingsPageOpened(logger)
    }
}
