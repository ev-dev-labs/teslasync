// UI-thread-free state holder backing the VersionSegment shared surface — the native port of the reads behind
// the web component (web/src/components/layout/status-bar/VersionSegment.tsx). It binds the three feeds through
// [VersionSegmentSource] and exposes:
//   • [state]       — the version provenance as cache-then-network [UiState] (loading / content / empty / stale
//                     / offline / error), the leg that drives the About modal's lifecycle chrome;
//   • [updateCheck] — the resolved update view (web `useUpdateCheck`), folded to its latest-known value so a
//                     loading/failed feed never fabricates an update;
//   • [changelog]   — the unseen-changelog summary (web `useChangelog`), a snapshot re-read on demand so the dot
//                     clears once the changelog is viewed;
//   • [buildVersion] / [buildSha] — the build-time identity (web `BUILD_VERSION` / `BUILD_SHA`) used as the
//                     fallback when the server provenance does not carry app_version / SHA.
// It exposes the refresh action plus the one-shot PII-safe `view.opened` diagnostic (P1/S11). The view never
// performs HTTP and never touches persistence — it only collects the flows and calls [refresh] /
// [refreshChangelog] / [recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/VersionSegment) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.versionsegment

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
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * State holder backing the Compose `VersionSegment` surface — the Android port of the web `VersionSegment`'s
 * `useVersionInfo` + `useUpdateCheck` + `useChangelog` + `useTranslation` composition.
 *
 * The provenance feed is projected onto a lifecycle-aware [state] (collected only while the surface is
 * on-screen), the update feed onto [updateCheck] (folded to its latest-known value), and the changelog summary
 * onto a re-readable [changelog] snapshot. [refresh] re-collects the provenance + update feeds and re-reads the
 * changelog (the error-retry + stale auto-refresh affordance), [refreshChangelog] re-reads only the changelog
 * summary (after the modal opens / the changelog is viewed), and [recordViewOpened] emits the P1/S11
 * `view.opened` event exactly once per surface open. The view-model owns no networking and no persistence — it
 * only projects the source's feeds and forwards the surface's actions.
 *
 * @param source the three-feed seam (a shared-layer adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param buildVersion the build-time version fallback (web `BUILD_VERSION`); injectable for tests.
 * @param buildSha the build-time short SHA fallback (web `BUILD_SHA`); injectable for tests.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VersionSegmentViewModel(
    private val source: VersionSegmentSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    val buildVersion: String = DEV_VERSION,
    val buildSha: String = DEV_VERSION,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects both cache-then-network feeds (the manual refetch affordance), exactly as
    // the dashboard VersionInfoWidget re-collects the shared Settings feed it shares with this surface.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    private val versionFeed: Flow<Resource<JsonElement>> = refreshTrigger.flatMapLatest { source.versionInfo() }

    /**
     * The version provenance as cache-then-network UI state (loading / content / empty / stale / offline /
     * error) — the leg that drives the About modal's lifecycle chrome. The build identity is always rendered, so
     * the surface is never blank; empty mirrors the web `version.data == null` guard (a decoded /system/version
     * is always an object, so empty is a defensive fallback the stateless renderer still honours).
     */
    val state: StateFlow<UiState<JsonElement>> =
        versionFeed.asUiState(isEmpty = { VersionSegmentProjection.parseVersion(it) == null })

    /**
     * The resolved update-check view (web `useUpdateCheck`), folded to its latest-known value so a still-loading
     * or failed update feed resolves to [UpdateCheckInfo.None] ("no update") rather than fabricating an update.
     */
    val updateCheck: StateFlow<UpdateCheckInfo> =
        refreshTrigger
            .flatMapLatest { source.updateCheck() }
            .map { it.latestKnownUpdate() }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STATE_STOP_TIMEOUT_MS),
                initialValue = UpdateCheckInfo.None,
            )

    private val mutableChangelog = MutableStateFlow(ChangelogStatus.None)

    /**
     * The unseen-changelog summary (web `useChangelog` → `hasUnseen` / `newEntries.length`). Seeded at
     * construction and re-read via [refreshChangelog] so the dot + tooltip hint track the acknowledgement as it
     * advances — the native analogue of the web useSyncExternalStore re-render once the seen-version changes.
     */
    val changelog: StateFlow<ChangelogStatus> = mutableChangelog.asStateFlow()

    init {
        refreshChangelog()
    }

    /** Re-reads the unseen-changelog summary from the source (after the modal opens / the changelog is viewed). */
    fun refreshChangelog() {
        mutableChangelog.value = source.changelogStatus()
    }

    /**
     * Re-runs the cache-then-network provenance + update loads and re-reads the changelog summary — the web
     * `refetch()` affordance plus the error-surface retry / stale auto-refresh. Logs a PII-safe, slug-only event.
     */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf(FIELD_SURFACE to VersionSegmentRegistration.SLUG))
        refreshChangelog()
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no version, build SHA, or update tag, so a diagnostics line can never leak the server's build
     * details. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordVersionSegmentOpened(logger)
    }

    companion object {
        private const val EVENT_REFRESH = "versionSegment.refresh"

        // Keep the update feed's upstream alive briefly across config changes / fast re-subscribes.
        private const val STATE_STOP_TIMEOUT_MS = 5_000L

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: VersionSegmentSource,
            logger: Logger,
            buildVersion: String = DEV_VERSION,
            buildSha: String = DEV_VERSION,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer {
                    VersionSegmentViewModel(source, logger, buildVersion = buildVersion, buildSha = buildSha)
                }
            }
    }
}
