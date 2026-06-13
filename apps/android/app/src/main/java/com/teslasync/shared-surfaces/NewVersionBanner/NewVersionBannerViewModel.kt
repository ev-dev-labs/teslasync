// UI-thread-free state holder backing the NewVersionBanner surface — the native port of the reads + actions behind
// the web component (web/src/components/feedback/NewVersionBanner.tsx) and its `useVersionWatcher` hook
// (web/src/hooks/useVersionWatcher.ts). It binds the shared Settings version feed (P1/S8) through
// [NewVersionBannerSource] and exposes:
//   • [state] — the deployment identity (deploy fingerprint) as cache-then-network [UiState] (loading / content /
//     stale / offline / error), the leg that raises the surface's loading + error + freshness states;
//   • [watcher] — the boot-vs-latest deployment watcher (web `useVersionWatcher`: bootVersion captured once,
//     latestVersion tracked, newVersionAvailable on divergence);
//   • [dismissedVersion] — the identity the user deferred via "Later" (web sessionStorage, here session-scoped to
//     the ViewModel — the faithful native analogue of a per-tab dismissal that resets on a fresh start);
//   • [reload] — re-baseline the watcher onto the new deployment and re-fetch (web `window.location.reload()`);
//   • [later] — defer the active identity (web `handleLater` / sessionStorage write);
//   • [refresh] — re-collect the version feed (the error-retry / stale auto-refresh affordance);
//   • [recordViewOpened] — the one-shot PII-safe `view.opened` diagnostic (P1/S11).
// The view never performs HTTP and never touches persistence — it only collects the flows and calls the actions.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/NewVersionBanner) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.newversionbanner

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * State holder backing the Compose `NewVersionBanner` surface — the Android port of the web `NewVersionBanner`'s
 * `useVersionWatcher` + `useTranslation` composition.
 *
 * The deployment identity is projected onto a lifecycle-aware [state] [UiState] (collected only while the surface
 * is on-screen) for the loading / error / stale / offline chrome, and folded continuously into the [watcher] (the
 * web boot-vs-latest watcher) so a redeploy is detected even before the UI subscribes. [later] defers the active
 * identity (web `handleLater`), [reload] re-baselines the watcher and re-fetches (web `window.location.reload()`),
 * [refresh] re-collects the feed (error-retry + stale auto-refresh), and [recordViewOpened] emits the P1/S11
 * `view.opened` event exactly once per surface open. The view-model owns no networking and no persistence — it
 * only projects the source's feed and forwards the surface's actions.
 *
 * @param source the deployment-identity seam (a shared-Settings adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + the action events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NewVersionBannerViewModel(
    source: NewVersionBannerSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network identity feed (the manual refetch affordance), exactly
    // as the dashboard VersionInfoWidget re-collects the shared Settings feed it shares with this surface.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    private val versionFeed: Flow<Resource<String>> = refreshTrigger.flatMapLatest { source.deployVersion() }

    /**
     * The deployment identity as cache-then-network UI state (loading / content / stale / offline / error). A blank
     * fingerprint — no identity reported at all — is treated as empty so the surface resolves to its up-to-date
     * panel rather than presenting a bogus version.
     */
    val state: StateFlow<UiState<String>> = versionFeed.asUiState(isEmpty = { it.isBlank() })

    private val mutableWatcher = MutableStateFlow(VersionWatcherState.Initial)

    /**
     * The boot-vs-latest deployment watcher (web `useVersionWatcher`). Folded from the same identity feed: the
     * first known fingerprint seeds `bootVersion`, every known fingerprint updates `latestVersion`, and a
     * divergence flips `newVersionAvailable`. Owned here (not [state]) so the boot identity is captured for the
     * surface's lifetime even across feed refreshes.
     */
    val watcher: StateFlow<VersionWatcherState> = mutableWatcher.asStateFlow()

    private val mutableDismissedVersion = MutableStateFlow<String?>(null)

    /**
     * The identity the user deferred via [later] (web sessionStorage dismissal). Session-scoped to this holder —
     * it survives recomposition / config changes but resets on a fresh process, the faithful native analogue of
     * the web's per-tab `sessionStorage` dismissal.
     */
    val dismissedVersion: StateFlow<String?> = mutableDismissedVersion.asStateFlow()

    init {
        // Continuously fold the identity feed into the watcher (web boot-capture + latest-tracking). Runs for the
        // holder's lifetime so a redeploy is observed even while the UI is not subscribed to [state].
        launch {
            versionFeed.collect { resource ->
                val known = resource.latestKnownVersion()
                mutableWatcher.update { VersionWatch.fold(it, known) }
                // Web reset effect: a deferral does NOT carry forward to a newer deployment — clear it so the
                // banner re-surfaces for the next version (web resets the dismissal when latestVersion changes).
                val dismissed = mutableDismissedVersion.value
                if (dismissed != null && known != null && known != dismissed) {
                    mutableDismissedVersion.value = null
                }
            }
        }
    }

    /**
     * Web `window.location.reload()`: re-baseline the watcher onto the current deployment (so the banner clears —
     * the client is now "on" the new version) and re-fetch the identity feed. Logs a PII-safe, slug-only event.
     * A host may additionally recreate the surface (e.g. an Activity recreate) via the composable's `onReload` hook.
     */
    fun reload() {
        logger.info(EVENT_RELOAD, mapOf(FIELD_SURFACE to NewVersionBannerRegistration.SLUG))
        mutableWatcher.update { it.rebaselined() }
        mutableDismissedVersion.value = null
        refreshTrigger.update { it + 1 }
    }

    /**
     * Web `handleLater`: defer the active deployment identity (sessionStorage write), flipping the surface to the
     * deferred resolved panel. A no-op when no identity is known yet. Logs a PII-safe, slug-only event.
     */
    fun later() {
        val target = mutableWatcher.value.latestVersion ?: return
        logger.info(EVENT_LATER, mapOf(FIELD_SURFACE to NewVersionBannerRegistration.SLUG))
        mutableDismissedVersion.value = target
    }

    /**
     * Re-collects the cache-then-network identity feed — the hard-error surface's retry and the stale surface's
     * auto-refresh (web `useVersionWatcher`'s poll). Because the shared Settings feed is collected with
     * `WhileSubscribed`, this restarts a cache-then-network fetch when the shared upstream had gone idle and
     * replays the last-known identity otherwise. Logs a PII-safe, slug-only event.
     */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf(FIELD_SURFACE to NewVersionBannerRegistration.SLUG))
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no deployment identity and no version string, so a diagnostics line can never leak the server's
     * build details. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordNewVersionOpened(logger)
    }

    companion object {
        private const val EVENT_RELOAD = "newVersion.reload"
        private const val EVENT_LATER = "newVersion.later"
        private const val EVENT_REFRESH = "newVersion.refresh"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: NewVersionBannerSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { NewVersionBannerViewModel(source, logger) }
            }
    }
}
