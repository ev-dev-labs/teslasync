// The data port the AISettings feature view binds to (P1/S8 state-holder seam) — the native analogue of the
// web component's settings/AI hook composition (web/src/api/hooks/useSettings.ts +
// web/src/api/hooks/useAiSettings.ts + web/src/api/hooks/useAiUsage.ts →
// web/src/features/settings/components/AISettings.tsx). The view never performs HTTP itself; a shared adapter
// (the S8 SettingsStore / AiUsageStore / AiSettingsStore, or the S7 repositories) or a test fake drives this.
// Cache-then-network freshness is preserved end to end (ADR-013): every read emission's cached/stale/error
// flags flow through unchanged so the view-model can render the full state matrix.
//
// `InvalidPackageDeclaration`/`filename`/`MatchingDeclarationName` are suppressed: the mandated surface
// directory (com/teslasync/feature-views/AISettings) cannot form a valid Kotlin package and the file hosts the
// seam plus its bindings, mirroring the sibling surfaces.
@file:Suppress("InvalidPackageDeclaration", "ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.featureviews.aisettings

import io.teslasync.shared.core.data.repo.AiSettingsRepository
import io.teslasync.shared.core.data.repo.AiUsageRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SettingsRepository
import io.teslasync.shared.core.presentation.aisettings.AiSettingsStore
import io.teslasync.shared.core.presentation.aiusage.AiUsageStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * The single seam the [AISettingsViewModel] depends on so it binds to an abstraction (real adapter ↔ test
 * fake), never to a concrete store or the network. The reads ([settings], [usageToday]) are the
 * cache-then-network feeds the web `useSettings` / `useAiUsageToday` hooks serve; [saveAiSettings] mirrors the
 * web `useSaveAiSettings` non-throwing mutation (partial-merge over the cached document). No HTTP touches the
 * view.
 */
interface AISettingsViewSource {
    /** Stream the cache-then-network `/settings` document (web `useSettings`, `GET /settings`). */
    fun settings(): Flow<Resource<JsonElement>>

    /** Stream the cache-then-network today's-usage document (web `useAiUsageToday`, `GET /ai/usage/today`). */
    fun usageToday(): Flow<Resource<JsonElement>>

    /** Save an AI-settings [patch] (web `useSaveAiSettings`); shallow-merges over the cached document. */
    suspend fun saveAiSettings(patch: JsonObject): Result<JsonElement>
}

/**
 * Binds the surface to the shared **S8** holders — the memoized, multi-observer feeds every Settings/AI
 * surface shares app-wide (web `useSettings` / `useAiUsageToday`). The save routes through [AiSettingsStore]
 * so it invalidates exactly what the web `useSaveAiSettings` mutation does (the settings document); the
 * view-model additionally restarts its own read collection after a successful save so the new mode is
 * reflected regardless of which binding the host wired. No HTTP touches the view — the stores (S7/S8) own it.
 */
fun aiSettingsViewSource(
    settingsStore: SettingsStore,
    aiUsageStore: AiUsageStore,
    aiSettingsStore: AiSettingsStore,
): AISettingsViewSource =
    object : AISettingsViewSource {
        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()

        override fun usageToday(): Flow<Resource<JsonElement>> = aiUsageStore.today()

        override suspend fun saveAiSettings(patch: JsonObject): Result<JsonElement> = aiSettingsStore.saveAiSettings(patch)
    }

/**
 * Binds the surface directly to the shared **S7** repositories. Each [settings]/[usageToday] call starts a
 * NEW cache-then-network collection, so the view-model's refresh/retry trigger a genuine re-fetch (the web
 * `refetch()` behaviour) — the binding to use when a host does not share a single app-wide store. The
 * view-model restarts its read collection after a successful save to reflect the write.
 */
fun aiSettingsViewSource(
    settingsRepository: SettingsRepository,
    aiUsageRepository: AiUsageRepository,
    aiSettingsRepository: AiSettingsRepository,
): AISettingsViewSource =
    object : AISettingsViewSource {
        override fun settings(): Flow<Resource<JsonElement>> = settingsRepository.settings()

        override fun usageToday(): Flow<Resource<JsonElement>> = aiUsageRepository.today()

        override suspend fun saveAiSettings(patch: JsonObject): Result<JsonElement> = aiSettingsRepository.saveAiSettings(patch)
    }
